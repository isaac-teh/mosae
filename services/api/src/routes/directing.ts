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
import { getOwnedProject, type Project } from "../store/projectStore.js";

const DEFAULT_TARGET_SEC = 60;

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
      pinnedInputs: { intent, constraints: input.constraints, targetSec: DEFAULT_TARGET_SEC },
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
      const parsed = ProposalConstraintsSchema.safeParse({
        ...source.constraints,
        deselectedMomentIds: req.body?.deselectedMomentIds,
        mustIncludeMomentIds: req.body?.mustIncludeMomentIds,
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

  return router;
}
