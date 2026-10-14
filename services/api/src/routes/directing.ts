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
import { leaveOutShots } from "../cast/leaveOut.js";
import type { Cast, CastPerson } from "../cast/types.js";
import { reconcileConfirmedFaces } from "../cast/reconcileConfirmedFaces.js";
import { z } from "zod";
import { FlowMutationRequestSchema } from "@mosae/contracts";
import type { PhotoAnalysis } from "../domain/understanding.js";
import { cosine } from "../cast/clusterFaces.js";
import { FACE_RECONCILE_THRESHOLD } from "../config.js";
import { buildDerivativePath } from "../domain/ids.js";
import { getStorage } from "firebase-admin/storage";
import { getAdminApp } from "../firebase/admin.js";
import { firebaseThumbnailUrlStore } from "../ingest/objectStore.js";

const momentThumbnailUrlCache = new Map<string, { url: string; expiresAt: number }>();
async function cachedThumbnailUrl(store: { signedReadUrl(path: string, expiresAt: number): Promise<string> }, path: string, now: number): Promise<string> {
  const cached = momentThumbnailUrlCache.get(path);
  if (cached && cached.expiresAt > now + 30_000) return cached.url;
  const expiresAt = now + 5 * 60 * 1000;
  const url = await store.signedReadUrl(path, expiresAt);
  momentThumbnailUrlCache.set(path, { url, expiresAt });
  if (momentThumbnailUrlCache.size > 1000) momentThumbnailUrlCache.delete(momentThumbnailUrlCache.keys().next().value!);
  return url;
}
import type { ThumbnailUrlStore } from "../ingest/objectStore.js";
import { FlowStoreError, mutateFlow, readFlow } from "../store/flowStore.js";

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
  thumbnails?: ThumbnailUrlStore;
}): Router {
  const now = deps.now ?? Date.now;
  const newId = deps.newId ?? (() => deps.db.collection("_ids").doc().id);
  const queuePlan: QueuePlan = deps.queuePlan ?? ((input) => createPlanJob(deps.db, input));
  const router = Router();
  router.use(deps.auth ?? requireUser());
  for (const name of ["projectId", "proposalId", "momentId"]) {
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

  router.get("/:projectId/flow", async (req, res) => {
    try { res.json({ flow: await readFlow(deps.db, res.locals.userId, req.params.projectId) }); }
    catch (error) { if (error instanceof FlowStoreError) { res.status(error.code === "not_found" ? 404 : 400).json({ error: error.code }); return; } handleError(res, error); }
  });

  router.post("/:projectId/flow/actions", async (req, res) => {
    const body = FlowMutationRequestSchema.safeParse(req.body);
    if (!body.success) { res.status(400).json({ error: "invalid_action" }); return; }
    try { res.json({ flow: await mutateFlow(deps.db, { userId: res.locals.userId, projectId: req.params.projectId, ...body.data }) }); }
    catch (error) { if (error instanceof FlowStoreError) { res.status(error.code === "not_found" ? 404 : 400).json({ error: error.code }); return; } handleError(res, error); }
  });

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
        excludedShotIds: req.body?.excludedShotIds ?? source.constraints.excludedShotIds,
        deselectedMomentIds: req.body?.deselectedMomentIds ?? source.constraints.deselectedMomentIds,
        mustIncludeMomentIds: req.body?.mustIncludeMomentIds ?? source.constraints.mustIncludeMomentIds,
        ...((req.body?.focusCharacterIds ?? source.constraints.focusCharacterIds) !== undefined
          ? { focusCharacterIds: req.body?.focusCharacterIds ?? source.constraints.focusCharacterIds } : {}),
        ...((req.body?.hiddenShotIds ?? source.constraints.hiddenShotIds) !== undefined
          ? { hiddenShotIds: req.body?.hiddenShotIds ?? source.constraints.hiddenShotIds } : {}),
        ...((req.body?.momentOrder ?? source.constraints.momentOrder) !== undefined
          ? { momentOrder: req.body?.momentOrder ?? source.constraints.momentOrder } : {}),
        ...((req.body?.photoSwaps ?? source.constraints.photoSwaps) !== undefined
          ? { photoSwaps: req.body?.photoSwaps ?? source.constraints.photoSwaps } : {}),
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

  router.get("/:projectId/proposals/:proposalId/moments/:momentId/alternatives", async (req, res) => {
    const userId: string = res.locals.userId;
    const { projectId, proposalId, momentId } = req.params;
    try {
      if (!(await ownedProject(userId, projectId))) {
        res.status(404).json({ error: "not_found" });
        return;
      }
      const proposal = await readProposal(deps.db, { userId, projectId, proposalId });
      const moment = proposal?.moments.find((candidate) => candidate.id === momentId);
      if (!proposal || !moment) {
        res.status(404).json({ error: "not_found" });
        return;
      }
      const project = deps.db.collection("projects").doc(projectId);
      const [baseShot, shotSnaps, assetSnaps] = await Promise.all([
        project.collection("shots").doc(moment.shotId).get(),
        project.collection("shots").get(),
        project.collection("assets").get(),
      ]);
      if (!baseShot.exists) {
        res.status(404).json({ error: "not_found" });
        return;
      }
      const assets = new Map(assetSnaps.docs.map((doc) => [doc.id, doc.data()]));
      const baseAsset = assets.get(baseShot.get("assetId") as string);
      const eventId = baseAsset?.eventId;
      if (typeof eventId !== "string" || !eventId) {
        res.json({ shots: [] });
        return;
      }
      const urlStore = deps.thumbnails ?? firebaseThumbnailUrlStore(getStorage(getAdminApp()).bucket());
      const shots = [];
      for (const shot of shotSnaps.docs) {
        if (shot.id === moment.shotId) continue;
        const asset = assets.get(shot.get("assetId") as string);
        if (!asset || asset.generation !== shot.get("assetGeneration") || asset.eventId !== eventId) continue;
        const path = asset.derivatives?.thumbPath;
        const generation = typeof path === "string" ? path.split("/")[4] : undefined;
        if (!generation || path !== buildDerivativePath({ userId, projectId, assetId: asset.id, generation }, "thumb.jpg")) continue;
        const thumbUrl = await urlStore.signedReadUrl(path, now() + 5 * 60 * 1000);
        shots.push({ shotId: shot.id, thumbUrl, kind: shot.get("mediaType") === "video" ? "video" : "photo" });
      }
      res.json({ shots });
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
      res.json({ cast: snap.exists ? snap.data() : null });
    } catch (error) {
      handleError(res, error);
    }
  });

  router.get("/:projectId/moments", async (req, res) => {
    const { projectId } = req.params;
    try {
      if (!(await ownedProject(res.locals.userId, projectId))) { res.status(404).json({ error: "not_found" }); return; }
      const project = deps.db.collection("projects").doc(projectId);
      const [shotDocs, assetDocs, castSnap] = await Promise.all([
        project.collection("shots").get(), project.collection("assets").get(),
        project.collection("cast").doc("current").get(),
      ]);
      const assets = new Map(assetDocs.docs.map((doc) => [doc.id, doc.data()]));
      const cast = castSnap.exists ? castSnap.data() as Cast : null;
      const captures = shotDocs.docs.map((doc) => {
        const assetId = doc.get("assetId") as string;
        const asset = assets.get(assetId);
        const day = typeof asset?.media?.localTime === "string" ? asset.media.localTime.slice(0, 10) : "undated";
        return { doc, assetId, asset, day };
      }).filter(({ asset, doc, assetId }) => {
        const path = asset?.derivatives?.thumbPath;
        const generation = typeof path === "string" ? path.split("/")[4] : undefined;
        return asset && asset.generation === doc.get("assetGeneration") && Boolean(generation) && path === buildDerivativePath({ userId: res.locals.userId, projectId, assetId, generation: generation! }, "thumb.jpg");
      });
      const dayIndexes = new Map([...new Set(captures.map(({ day }) => day))].sort().map((day, index) => [day, index + 1]));
      captures.sort((a, b) => (dayIndexes.get(a.day) ?? 1) - (dayIndexes.get(b.day) ?? 1) || Number(a.doc.get("index") ?? 0) - Number(b.doc.get("index") ?? 0));
      const urlStore = deps.thumbnails ?? firebaseThumbnailUrlStore(getStorage(getAdminApp()).bucket());
      const moments = await Promise.all(captures.map(async ({ doc, assetId, asset, day }) => {
        const path = asset!.derivatives!.thumbPath as string;
        const faceIds = ((doc.get("analysis") as PhotoAnalysis | undefined)?.faces ?? []).filter((face) => face.prominence !== "background").map((face) => face.characterId).filter((id): id is string => Boolean(id));
        const people = new Set(faceIds);
        for (const person of cast?.people ?? []) {
          if ((person.removedShots ?? []).includes(doc.id)) people.delete(person.personId);
          if ((person.manualShots ?? []).includes(doc.id) && !(person.removedShots ?? []).includes(doc.id)) people.add(person.personId);
        }
        return {
          shotId: doc.id, thumbnailUrl: await cachedThumbnailUrl(urlStore, path, now()),
          kind: doc.get("mediaType") === "video" ? "video" as const : "photo" as const,
          durationSec: typeof asset!.media?.durationSec === "number" ? asset!.media.durationSec : null,
          dayIndex: dayIndexes.get(day) ?? 1, personIds: [...people], assetId,
        };
      }));
      res.json({ moments });
    } catch (error) { handleError(res, error); }
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
        addShots: z.array(z.string().min(1)).optional(), removeShots: z.array(z.string().min(1)).optional(),
      });
      const bodySchema = z.strictObject({
        people: z.array(personSchema), focus: z.array(z.string().min(1)),
        moves: z.array(z.strictObject({ faceId: z.string().min(1), personId: z.string().min(1).nullable() })).optional(),
        merges: z.array(z.strictObject({ fromPersonId: z.string().min(1), toPersonId: z.string().min(1) })).optional(),
        reconcilePersonId: z.string().min(1).optional(),
        reconcilePendingPersonIds: z.array(z.string().min(1)).optional(),
        /** The current plan: when given, the cast's leave-out and focus are applied to it straight away. */
        proposalId: z.string().min(1).optional(),
      });
      const parsed = bodySchema.safeParse(req.body);
      if (!parsed.success) { res.status(400).json({ error: "invalid_cast" }); return; }
      const currentRef = deps.db.doc(`projects/${projectId}/cast/current`);
      const currentSnap = await currentRef.get();
      const current = (currentSnap.exists ? currentSnap.data() : { people: [], core: [], focus: [], source: "none" }) as Cast;
      const validId = (id: string) => /^[\w:.-]+$/.test(id) && (current.people.some((person) => person.personId === id) || id.startsWith("p-"));
      const { people, moves = [], merges = [], reconcilePersonId, reconcilePendingPersonIds = [] } = parsed.data;
      let { focus } = parsed.data;
      const mergeTargets = new Map(merges.map(({ fromPersonId, toPersonId }) => [fromPersonId, toPersonId]));
      if ([...people.map((person) => person.personId), ...focus, ...moves.flatMap((move) => move.personId ? [move.personId] : []), ...merges.flatMap((merge) => [merge.fromPersonId, merge.toPersonId])].some((id) => !validId(id)) ||
          merges.some(({ fromPersonId, toPersonId }) => fromPersonId === toPersonId || !current.people.some((person) => person.personId === fromPersonId) || !people.some((person) => person.personId === toPersonId) || people.some((person) => person.personId === fromPersonId)) ||
          (reconcilePersonId !== undefined && !people.some((person) => person.personId === reconcilePersonId)) ||
          new Set(merges.map(({ fromPersonId }) => fromPersonId)).size !== merges.length ||
          focus.some((id) => people.some((person) => person.personId === id && person.excluded)) ||
          new Set(people.map((person) => person.personId)).size !== people.length || new Set(focus).size !== focus.length) {
        res.status(400).json({ error: "invalid_cast" }); return;
      }

      const shots = await getProjectFaces(deps.db, projectId);
      const allShotDocs = await deps.db.collection("projects").doc(projectId).collection("shots").get();
      const validShotIds = new Set(allShotDocs.docs.map((doc) => doc.id));
      if (people.some((person) => [...(person.addShots ?? []), ...(person.removeShots ?? [])].some((shotId) => !validShotIds.has(shotId)))) {
        res.status(400).json({ error: "invalid_cast" }); return;
      }
      const faceLookup = new Map<string, { shotIndex: number; faceIndex: number }>();
      shots.forEach((shot, shotIndex) => (shot.analysis?.faces ?? []).forEach((face, faceIndex) => faceLookup.set(face.faceId, { shotIndex, faceIndex })));
      if (moves.some((move) => !faceLookup.has(move.faceId))) { res.status(400).json({ error: "invalid_cast" }); return; }
      const moved = new Map(moves.map((move) => [move.faceId, move.personId]));
      const personInputs = new Map(people.map((person) => [person.personId, person]));
      const manuallyTaggedByShot = new Map<string, string[]>();
      if (reconcilePersonId) for (const person of people) {
        const existing = current.people.find((entry) => entry.personId === person.personId);
        const manualShots = new Set(existing?.manualShots ?? []);
        for (const shotId of person.removeShots ?? []) manualShots.delete(shotId);
        for (const shotId of person.addShots ?? []) manualShots.add(shotId);
        for (const shotId of manualShots) manuallyTaggedByShot.set(shotId, [...(manuallyTaggedByShot.get(shotId) ?? []), person.personId]);
      }
      const reconciliationFaces = reconcilePersonId ? allShotDocs.docs.flatMap((doc) => {
        const data = doc.data();
        const analysis = data.analysis as PhotoAnalysis | undefined;
        const storedVectors = data.faceEmbeddings as Record<string, { toArray?: () => number[] } | number[]> | undefined;
        return (analysis?.faces ?? []).flatMap((face) => {
          const value = storedVectors?.[face.faceId];
          const vector = Array.isArray(value) ? value : value?.toArray?.();
          if (!vector) return [];
          return [{ faceId: face.faceId, shotId: doc.id, vector, modelVersion: (data.faceEmbeddingModel as string | undefined) ?? "gemini-embedding-2", characterId: moved.has(face.faceId) ? moved.get(face.faceId) ?? undefined : face.characterId }];
        });
      }) : [];
      // A gallery tag marks the photo as belonging to that person. In a group
      // photo, use its detected face that best matches the person's existing
      // confirmed references; treating every face as a reference would merge
      // siblings into one another. Never infer a gallery reference from a photo
      // that already contains a reference face for that same identity.
      const galleryReferences: typeof reconciliationFaces = [];
      for (const [shotId, owners] of manuallyTaggedByShot) for (const owner of owners) {
        const references = reconciliationFaces.filter((face) => face.characterId === owner && face.shotId !== shotId);
        if (!references.length) continue;
        const candidate = reconciliationFaces.filter((face) => face.shotId === shotId)
          .map((face) => ({ face, score: Math.max(...references.map((reference) => cosine(face.vector, reference.vector))) }))
          .sort((a, b) => b.score - a.score)[0];
        const threshold = candidate?.face.modelVersion === "gemini-embedding-2" ? 0.86 : FACE_RECONCILE_THRESHOLD;
        if (candidate && candidate.score >= threshold) galleryReferences.push({ ...candidate.face, faceId: `${candidate.face.faceId}:gallery:${owner}`, characterId: owner });
      }
      reconciliationFaces.push(...galleryReferences);
      const knownPendingPersonIds = reconcilePendingPersonIds.filter((id) => current.people.some((person) => person.personId === id) && id !== reconcilePersonId);
      const reconciliation = reconcilePersonId ? reconcileConfirmedFaces(reconciliationFaces, reconcilePersonId, undefined, new Set(knownPendingPersonIds)) : new Map<string, string>();
      const removedShotOwners = new Map<string, Set<string>>();
      for (const person of people) for (const shotId of person.removeShots ?? []) {
        const owners = removedShotOwners.get(shotId) ?? new Set<string>();
        owners.add(person.personId);
        removedShotOwners.set(shotId, owners);
      }
      const peopleById = new Map<string, CastPerson>();
      const subjectsByShot = shots.map((shot) => photoRoles((shot.analysis?.faces ?? []).map((face) => face.bbox)));
      const facesByShot: NonNullable<PhotoAnalysis["faces"]>[] = shots.map((shot, shotIndex) => (shot.analysis?.faces ?? []).map((face, faceIndex) => {
        const originalId = moved.has(face.faceId) ? moved.get(face.faceId) ?? undefined : reconciliation.get(face.faceId) ?? face.characterId;
        const mappedPersonId = originalId ? mergeTargets.get(originalId) ?? originalId : undefined;
        const personId = mappedPersonId && !removedShotOwners.get(shot.shotId)?.has(mappedPersonId) ? mappedPersonId : undefined;
        const { characterId: _characterId, name: _name, role: _role, ...faceFields } = face;
        const input = personId ? personInputs.get(personId) : undefined;
        if (personId && input) {
          const base = current.people.find((person) => person.personId === personId);
          const person = peopleById.get(personId) ?? {
            ...(base ?? { personId, ageBand: input.role === "child" ? "child" : "adult", confidence: "low" }),
            ...input, excluded: input.excluded ?? false, appearances: 0, subjectCount: 0, faceIds: [],
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
      const nextPeople = people.map((person) => {
        const base = current.people.find((old) => old.personId === person.personId);
        const priorManual = new Set(base?.manualShots ?? []);
        const removed = new Set(base?.removedShots ?? []);
        for (const shotId of person.removeShots ?? []) { priorManual.delete(shotId); removed.add(shotId); }
        for (const shotId of person.addShots ?? []) { priorManual.add(shotId); removed.delete(shotId); }
        const manualShots = [...priorManual];
        return {
          ...(peopleById.get(person.personId) ?? base), ...person,
          ageBand: peopleById.get(person.personId)?.ageBand ?? base?.ageBand ?? "adult",
          confidence: peopleById.get(person.personId)?.confidence ?? base?.confidence ?? "low",
          manualShots, removedShots: [...removed],
          excluded: person.excluded ?? false, appearances: (peopleById.get(person.personId)?.appearances ?? 0) + manualShots.length,
          subjectCount: (peopleById.get(person.personId)?.subjectCount ?? 0) + manualShots.length, faceIds: peopleById.get(person.personId)?.faceIds ?? [],
        } as CastPerson;
      });
      const core = nextPeople.map((person) => person.personId);
      focus = focus.map((id) => mergeTargets.get(id) ?? id).filter((id, index, all) => all.indexOf(id) === index);
      if (focus.length === 0) focus = chooseFocus(nextPeople, core);
      for (const shotFaces of facesByShot) for (const face of shotFaces) {
        if (face.characterId) face.role = focus.includes(face.characterId) ? "MAIN" : "SUPPORTING";
      }
      const cast: Cast = {
        people: nextPeople, core, focus, source: current.source, confirmed: true,
      };
      batch.set(currentRef, cast);
      await batch.commit();
      if (!parsed.data.proposalId) { res.json({ cast }); return; }

      // Apply the confirmed cast to the plan already on screen without asking
      // the model again: photos now left out are deselected, photos no longer
      // left out come back, and the reasons travel with the new version.
      const source = await readProposal(deps.db, { userId: res.locals.userId, projectId, proposalId: parsed.data.proposalId });
      if (!source) { res.status(404).json({ error: "not_found" }); return; }
      const assetSnapshots = await deps.db.collection("projects").doc(projectId).collection("assets").get();
      const qualityByAsset = new Map(assetSnapshots.docs.map((doc) => [doc.id, doc.data()]));
      const leftOut = leaveOutShots(
        shots.map((shot, index) => ({
          shotId: shot.shotId,
          blurry: qualityByAsset.get(shot.assetId)?.quality?.blurry ?? false,
          dupOf: qualityByAsset.get(shot.assetId)?.dupOf ?? null,
          faces: (facesByShot[index] ?? []).map((face) => ({ bbox: face.bbox, personId: face.characterId ?? null, stranger: face.stranger ?? false })),
          manualPersonIds: cast.people.filter((person) => (person.manualShots ?? []).includes(shot.shotId) && !(person.removedShots ?? []).includes(shot.shotId)).map((person) => person.personId),
        })),
        cast,
        source.constraints.hiddenShotIds ?? [],
      );
      const momentsFor = (shotIds: Set<string>) => source.moments.filter((moment) => shotIds.has(moment.shotId)).map((moment) => moment.id);
      const previouslyLeftOut = new Set(momentsFor(new Set((source.leftOut ?? []).map((item) => item.shotId))));
      const nowLeftOut = momentsFor(new Set(leftOut.map((item) => item.shotId)));
      const deselectedMomentIds = [...new Set([
        ...source.constraints.deselectedMomentIds.filter((id) => !previouslyLeftOut.has(id)),
        ...nowLeftOut,
      ])];
      const proposal = await reviseConstraints(deps.db, {
        userId: res.locals.userId, projectId, proposalId: source.id,
        constraints: {
          ...source.constraints,
          deselectedMomentIds,
          mustIncludeMomentIds: source.constraints.mustIncludeMomentIds.filter((id) => !nowLeftOut.includes(id)),
          focusCharacterIds: cast.focus,
        },
        leftOut,
        createdAt: now(),
      });
      res.json({ cast, proposalId: proposal.id });
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
