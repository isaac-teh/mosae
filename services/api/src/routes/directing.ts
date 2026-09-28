import {
  ProposalConstraintsSchema,
  StoryIntentSchema,
  type ProposalConstraints,
  type StoryIntent,
} from "@mosae/contracts";
import { Router, type RequestHandler, type Response } from "express";
import type { Firestore } from "firebase-admin/firestore";
import { requireUser } from "../auth/requireUser.js";
import { isValidId } from "../domain/ids.js";
import { newOutboxTask } from "../domain/outbox.js";
import {
  acceptProposal,
  DirectingStoreError,
  nextProposalVersion,
  readProposal,
  reviseConstraints,
  saveIntent,
} from "../store/directingStore.js";
import { assignFaceCharacter, getProjectFaces } from "../store/understandStore.js";
import { getOwnedProject, type Project } from "../store/projectStore.js";
import { photoRoles } from "../cast/prominence.js";
import { chooseFocus } from "../cast/focus.js";
import type { Cast, CastPerson } from "../cast/types.js";
import { z } from "zod";
import type { PhotoAnalysis } from "../domain/understanding.js";

type DirectingProject = Project & { currentProposalId?: string | null };

export type QueuePlanInput = {
  userId: string;
  projectId: string;
  storyIntentId: string;
  parentProposalId: string | null;
  minimumVersion: number;
  constraints: ProposalConstraints;
  waitForReady: boolean;
  createdAt: number;
  intent?: Pick<StoryIntent, "text" | "focus">;
};

export type QueuedPlanJob = {
  id: string;
  proposalId: string;
  version: number;
  status: "queued" | "waiting_for_ready";
};

export type QueuePlan = (input: QueuePlanInput) => Promise<QueuedPlanJob>;

function storedIntent(value: FirebaseFirestore.DocumentData | undefined): StoryIntent | null {
  if (!value) return null;
  const { createdAt: _createdAt, ...candidate } = value;
  const parsed = StoryIntentSchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}

/** Atomically creates a version-pinned plan job and its dispatch record. */
export async function createPlanJob(db: Firestore, input: QueuePlanInput): Promise<QueuedPlanJob> {
  const projectRef = db.collection("projects").doc(input.projectId);
  const jobRef = projectRef.collection("jobs").doc();
  const proposalId = projectRef.collection("storyProposals").doc().id;

  return db.runTransaction(async (transaction) => {
    const projectSnap = await transaction.get(projectRef);
    if (!projectSnap.exists || projectSnap.get("userId") !== input.userId) {
      throw new DirectingStoreError("not_found");
    }
    const status = projectSnap.get("status") as Project["status"];
    if (status === "collecting" || status === "failed") throw new DirectingStoreError("invalid_job");
    if (input.parentProposalId !== null && projectSnap.get("currentProposalId") !== input.parentProposalId) {
      throw new DirectingStoreError("stale_proposal");
    }

    const intentRef = projectRef.collection("storyIntents").doc(input.storyIntentId);
    const intent = input.intent ?? storedIntent((await transaction.get(intentRef)).data());
    if (!intent) throw new DirectingStoreError("invalid_intent");

    let currentVersion = 0;
    const currentProposalId = projectSnap.get("currentProposalId") as string | null | undefined;
    if (currentProposalId) {
      const currentSnap = await transaction.get(projectRef.collection("storyProposals").doc(currentProposalId));
      currentVersion = Number(currentSnap.get("version") ?? 0);
    }
    const version = nextProposalVersion(projectSnap.get("proposalVersionCounter"), currentVersion, input.minimumVersion);

    const waitForReady = status === "processing";
    const jobStatus = waitForReady ? "waiting_for_ready" : "queued";
    const outbox = newOutboxTask({
      projectId: input.projectId,
      subjectKind: "job",
      subjectId: jobRef.id,
      generation: String(version),
      stage: "plan",
      now: input.createdAt,
    });
    transaction.create(jobRef, {
      id: jobRef.id,
      type: "plan",
      projectId: input.projectId,
      proposalId,
      storyIntentId: input.storyIntentId,
      parentProposalId: input.parentProposalId,
      version,
      status: jobStatus,
      waitForReady,
      attempts: 0,
      leaseUntil: null,
      progress: null,
      pinnedInputs: { intent, constraints: input.constraints },
      createdAt: input.createdAt,
      updatedAt: input.createdAt,
    });
    transaction.create(projectRef.collection("taskOutbox").doc(outbox.id), outbox);
    transaction.update(projectRef, { proposalVersionCounter: version });
    return { id: jobRef.id, proposalId, version, status: jobStatus };
  });
}

/**
 * Queues a plan job and drains the outbox behind it. The dev runner executes
 * the plan in-process, so awaiting that drain would hold POST /story-intents
 * open for the whole bounded run: the client would attach to an already
 * succeeded job and never see the progress UI. Pass `defer` there, exactly as
 * the readiness dispatch does, and keep awaiting the cheap Cloud Tasks handoff
 * everywhere else.
 */
export function createQueuePlan(deps: {
  createJob: (input: QueuePlanInput) => Promise<QueuedPlanJob>;
  dispatch: () => Promise<unknown>;
  defer?: ((run: () => void) => void) | null;
  onDispatchError?: (error: unknown) => void;
}): QueuePlan {
  const report = deps.onDispatchError ?? ((error: unknown) => console.error("plan dispatch failed", error));
  return async (input) => {
    const job = await deps.createJob(input);
    if (deps.defer) deps.defer(() => { void deps.dispatch().catch(report); });
    else await deps.dispatch();
    return job;
  };
}

const STATUS: Record<DirectingStoreError["code"], number> = {
  invalid_intent: 400,
  invalid_job: 409,
  invalid_proposal: 422,
  not_found: 404,
  stale_proposal: 409,
  invalid_face: 400,
  invalid_assignment: 400,
};

function handleError(res: Response, error: unknown): void {
  if (error instanceof DirectingStoreError) {
    res.status(STATUS[error.code]).json({ error: error.code });
    return;
  }
  console.error("directing route failed", error);
  res.status(500).json({ error: "internal" });
}

function planningReadiness(project: Project): { waitForReady: boolean } | { error: string; reason: string } {
  if (project.status === "collecting") {
    return { error: "project_collecting", reason: "Finish adding media before planning a story." };
  }
  if (project.status === "failed") {
    return { error: "project_failed", reason: "This project has no usable media to plan." };
  }
  return { waitForReady: project.status === "processing" };
}

export function directingRouter(deps: {
  db: Firestore;
  now?: () => number;
  newId?: () => string;
  auth?: RequestHandler;
  queuePlan?: QueuePlan;
}): Router {
  const now = deps.now ?? Date.now;
  const newId = deps.newId ?? (() => deps.db.collection("_ids").doc().id);
  const queuePlan: QueuePlan = deps.queuePlan ?? ((input) => createPlanJob(deps.db, input));
  const router = Router();
  router.use(deps.auth ?? requireUser());
  for (const name of ["projectId", "proposalId"]) {
    router.param(name, (_req, res, next, value: string) => {
      if (!isValidId(value)) {
        res.status(404).json({ error: "not_found" });
        return;
      }
      next();
    });
  }

  const ownedProject = async (userId: string, projectId: string): Promise<DirectingProject | null> =>
    getOwnedProject(deps.db, userId, projectId) as Promise<DirectingProject | null>;

  router.post("/:projectId/story-intents", async (req, res) => {
    const userId: string = res.locals.userId;
    const { projectId } = req.params;
    try {
      const project = await ownedProject(userId, projectId);
      if (!project) {
        res.status(404).json({ error: "not_found" });
        return;
      }
      const readiness = planningReadiness(project);
      if ("error" in readiness) {
        res.status(409).json(readiness);
        return;
      }
      const parsed = StoryIntentSchema.safeParse({
        schemaVersion: 1,
        id: newId(),
        projectId,
        version: 1,
        text: req.body?.text,
        focus: req.body?.focus ?? [],
      });
      if (!parsed.success || (req.body?.projectId !== undefined && req.body.projectId !== projectId)) {
        res.status(400).json({ error: "invalid_intent" });
        return;
      }
      const intent = await saveIntent(deps.db, { userId, intent: parsed.data, createdAt: now() });
      const job = await queuePlan({
        userId,
        projectId,
        storyIntentId: intent.id,
        parentProposalId: null,
        minimumVersion: 1,
        constraints: { excludedShotIds: [], deselectedMomentIds: [], mustIncludeMomentIds: [], feedback: [] },
        waitForReady: readiness.waitForReady,
        createdAt: now(),
        intent: { text: intent.text, focus: intent.focus },
      });
      res.status(202).json({ intent, job });
    } catch (error) {
      handleError(res, error);
    }
  });

  router.patch("/:projectId/proposals/:proposalId/constraints", async (req, res) => {
    const userId: string = res.locals.userId;
    const { projectId, proposalId } = req.params;
    try {
      if (!(await ownedProject(userId, projectId))) {
        res.status(404).json({ error: "not_found" });
        return;
      }
      const source = await readProposal(deps.db, { userId, projectId, proposalId });
      if (!source) {
        res.status(404).json({ error: "not_found" });
        return;
      }
      // Every field is a partial update: an absent key keeps what the proposal
      // already carries. The picker patches only `focusCharacterIds`, and the
      // moment screens only the two moment lists, so neither wipes the other.
      const parsed = ProposalConstraintsSchema.safeParse({
        ...source.constraints,
        deselectedMomentIds: req.body?.deselectedMomentIds ?? source.constraints.deselectedMomentIds,
        mustIncludeMomentIds: req.body?.mustIncludeMomentIds ?? source.constraints.mustIncludeMomentIds,
        focusCharacterIds: req.body?.focusCharacterIds ?? source.constraints.focusCharacterIds,
      });
      if (!parsed.success) {
        res.status(400).json({ error: "invalid_constraints" });
        return;
      }
      const proposal = await reviseConstraints(deps.db, {
        userId,
        projectId,
        proposalId,
        constraints: parsed.data,
        createdAt: now(),
      });
      res.status(201).json({ proposal });
    } catch (error) {
      handleError(res, error);
    }
  });

  router.post("/:projectId/proposals/:proposalId/feedback", async (req, res) => {
    const userId: string = res.locals.userId;
    const { projectId, proposalId } = req.params;
    try {
      const project = await ownedProject(userId, projectId);
      if (!project) {
        res.status(404).json({ error: "not_found" });
        return;
      }
      const feedback = typeof req.body?.feedback === "string" ? req.body.feedback.trim() : "";
      if (!feedback) {
        res.status(400).json({ error: "invalid_feedback" });
        return;
      }
      if (project.currentProposalId !== proposalId) {
        res.status(409).json({ error: "stale_proposal" });
        return;
      }
      const source = await readProposal(deps.db, { userId, projectId, proposalId });
      if (!source) {
        res.status(404).json({ error: "not_found" });
        return;
      }
      const constraints = ProposalConstraintsSchema.parse({
        ...source.constraints,
        feedback: [...source.constraints.feedback, feedback],
      });
      const readiness = planningReadiness(project);
      if ("error" in readiness) {
        res.status(409).json(readiness);
        return;
      }
      const job = await queuePlan({
        userId,
        projectId,
        storyIntentId: source.storyIntentId,
        parentProposalId: source.id,
        minimumVersion: source.version + 1,
        constraints,
        waitForReady: readiness.waitForReady,
        createdAt: now(),
      });
      res.status(202).json({ job });
    } catch (error) {
      handleError(res, error);
    }
  });

  router.post("/:projectId/proposals/:proposalId/accept", async (req, res) => {
    const userId: string = res.locals.userId;
    const { projectId, proposalId } = req.params;
    try {
      if (!(await ownedProject(userId, projectId))) {
        res.status(404).json({ error: "not_found" });
        return;
      }
      const proposal = await acceptProposal(deps.db, { userId, projectId, proposalId });
      res.json({ proposal });
    } catch (error) {
      handleError(res, error);
    }
  });

  // Character picker: read every photo-face in the project, grouped by shot.
  router.get("/:projectId/characters", async (req, res) => {
    const { projectId } = req.params;
    try {
      if (!(await ownedProject(res.locals.userId, projectId))) {
        res.status(404).json({ error: "not_found" });
        return;
      }
      const shots = await getProjectFaces(deps.db, projectId);
      res.json({
        shots: shots.map((s) => ({
          shotId: s.shotId,
          assetId: s.assetId,
          faces: (s.analysis?.faces ?? []).map((f) => ({
            faceId: f.faceId,
            // Normalised [ymin, xmin, ymax, xmax]; the picker crops with it.
            bbox: f.bbox,
            characterId: f.characterId ?? null,
            name: f.name ?? null,
            role: f.role ?? null,
          })),
        })),
      });
    } catch (error) {
      handleError(res, error);
    }
  });

  router.get("/:projectId/cast", async (req, res) => {
    const { projectId } = req.params;
    try {
      if (!(await ownedProject(res.locals.userId, projectId))) {
        res.status(404).json({ error: "not_found" });
        return;
      }
      const snap = await deps.db.doc(`projects/${projectId}/cast/current`).get();
      if (!snap.exists) { res.status(404).json({ error: "not_found" }); return; }
      res.json({ cast: snap.data() });
    } catch (error) {
      handleError(res, error);
    }
  });

  router.put("/:projectId/cast", async (req, res) => {
    const { projectId } = req.params;
    try {
      if (!(await ownedProject(res.locals.userId, projectId))) {
        res.status(404).json({ error: "not_found" });
        return;
      }
      const personSchema = z.strictObject({
        personId: z.string().min(1), name: z.string().optional(),
        role: z.enum(["parent", "child", "other"]), excluded: z.boolean().optional(),
      });
      const bodySchema = z.strictObject({
        people: z.array(personSchema), focus: z.array(z.string().min(1)),
        moves: z.array(z.strictObject({ faceId: z.string().min(1), personId: z.string().min(1) })).optional(),
      });
      const parsed = bodySchema.safeParse(req.body);
      if (!parsed.success) { res.status(400).json({ error: "invalid_cast" }); return; }
      const currentRef = deps.db.doc(`projects/${projectId}/cast/current`);
      const currentSnap = await currentRef.get();
      if (!currentSnap.exists) { res.status(404).json({ error: "not_found" }); return; }
      const current = currentSnap.data() as Cast;
      const validId = (id: string) => current.people.some((person) => person.personId === id) || id.startsWith("p-");
      const { people, moves = [] } = parsed.data;
      let { focus } = parsed.data;
      if ([...people.map((person) => person.personId), ...focus, ...moves.map((move) => move.personId)].some((id) => !validId(id)) ||
          focus.some((id) => people.some((person) => person.personId === id && person.excluded)) ||
          new Set(people.map((person) => person.personId)).size !== people.length || new Set(focus).size !== focus.length) {
        res.status(400).json({ error: "invalid_cast" }); return;
      }

      const shots = await getProjectFaces(deps.db, projectId);
      const faceLookup = new Map<string, { shotIndex: number; faceIndex: number }>();
      shots.forEach((shot, shotIndex) => (shot.analysis?.faces ?? []).forEach((face, faceIndex) => faceLookup.set(face.faceId, { shotIndex, faceIndex })));
      if (moves.some((move) => !faceLookup.has(move.faceId))) { res.status(400).json({ error: "invalid_cast" }); return; }
      const moved = new Map(moves.map((move) => [move.faceId, move.personId]));
      const personInputs = new Map(people.map((person) => [person.personId, person]));
      const peopleById = new Map<string, CastPerson>();
      const subjectsByShot = shots.map((shot) => photoRoles((shot.analysis?.faces ?? []).map((face) => face.bbox)));
      const facesByShot: NonNullable<PhotoAnalysis["faces"]>[] = shots.map((shot, shotIndex) => (shot.analysis?.faces ?? []).map((face, faceIndex) => {
        const personId = moved.get(face.faceId) ?? face.characterId;
        const { characterId: _characterId, name: _name, role: _role, ...faceFields } = face;
        const input = personId ? personInputs.get(personId) : undefined;
        if (personId && input) {
          const base = current.people.find((person) => person.personId === personId);
          const person = peopleById.get(personId) ?? {
            ...(base ?? { personId, ageBand: input.role === "child" ? "child" : "adult", confidence: "low" }),
            ...input, appearances: 0, subjectCount: 0, faceIds: [],
          } as CastPerson;
          person.appearances += 1;
          if (subjectsByShot[shotIndex]?.[faceIndex] === "subject") person.subjectCount += 1;
          person.faceIds.push(face.faceId);
          peopleById.set(personId, person);
        }
        if (!personId) return faceFields;
        const displayName = input?.name ?? current.people.find((person) => person.personId === personId)?.name;
        return { ...faceFields, characterId: personId, ...(displayName !== undefined ? { name: displayName } : {}), role: focus.includes(personId) ? "MAIN" as const : "SUPPORTING" as const };
      }));
      const batch = deps.db.batch();
      shots.forEach((shot, index) => {
        const analysis = shot.analysis;
        if (!analysis) return;
        batch.update(deps.db.doc(`projects/${projectId}/shots/${shot.shotId}`), { analysis: { ...analysis, faces: facesByShot[index] } });
      });
      const nextPeople = people.map((person) => peopleById.get(person.personId) ?? {
        ...current.people.find((old) => old.personId === person.personId), ...person,
        appearances: 0, subjectCount: 0, faceIds: [],
      } as CastPerson);
      const core = nextPeople.map((person) => person.personId);
      if (focus.length === 0) focus = chooseFocus(nextPeople, core);
      for (const shotFaces of facesByShot) for (const face of shotFaces) {
        if (face.characterId) face.role = focus.includes(face.characterId) ? "MAIN" : "SUPPORTING";
      }
      const cast: Cast = {
        people: nextPeople, core, focus, source: current.source, confirmed: true,
      };
      batch.set(currentRef, cast);
      await batch.commit();
      res.json({ cast });
    } catch (error) {
      handleError(res, error);
    }
  });

  // Character picker: assign a character to one stored face.
  router.post("/:projectId/shots/:shotId/characters", async (req, res) => {
    const userId: string = res.locals.userId;
    const { projectId, shotId } = req.params;
    try {
      if (!(await ownedProject(userId, projectId))) {
        res.status(404).json({ error: "not_found" });
        return;
      }
      const body = req.body ?? {};
      const faceId = typeof body.faceId === "string" ? body.faceId.trim() : "";
      if (!faceId) {
        res.status(400).json({ error: "invalid_assignment" });
        return;
      }
      const name = typeof body.name === "string" ? body.name.trim() : undefined;
      // `null` means "no role", the shape the GET route above emits for an
      // unassigned face; only a non-empty value that is not a role is invalid.
      if (body.role !== undefined && body.role !== null && body.role !== "MAIN" && body.role !== "SUPPORTING") {
        res.status(400).json({ error: "invalid_assignment" });
        return;
      }
      const role = body.role === "MAIN" || body.role === "SUPPORTING" ? body.role : undefined;
      if (name !== undefined && name.length === 0) {
        res.status(400).json({ error: "invalid_assignment" });
        return;
      }
      const face = await assignFaceCharacter(deps.db, {
        userId,
        projectId,
        shotId,
        assignment: { faceId, name, role },
      });
      res.status(201).json({ face });
    } catch (error) {
      handleError(res, error);
    }
  });

  return router;
}
