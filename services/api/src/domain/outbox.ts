import { PIPELINE_VERSION, workKey, type Stage, type SubjectKind } from "./ids.js";

export const DISPATCH_LEASE_MS = 60_000;

export type OutboxState = "pending" | "dispatching" | "delivered";

export type OutboxTask = {
  id: string;
  projectId: string;
  subjectKind: SubjectKind;
  subjectId: string;
  generation: string;
  stage: Stage;
  pipelineVersion: number;
  workKey: string;
  state: OutboxState;
  attempts: number;
  leaseUntil: number | null;
  lastError: string | null;
  createdAt: number;
  updatedAt: number;
};

export function newOutboxTask(input: {
  projectId: string;
  subjectKind: SubjectKind;
  subjectId: string;
  generation: string;
  stage: Stage;
  now: number;
}): OutboxTask {
  const key = workKey({ ...input, pipelineVersion: PIPELINE_VERSION });
  return {
    id: key.replaceAll(":", "_"),
    projectId: input.projectId,
    subjectKind: input.subjectKind,
    subjectId: input.subjectId,
    generation: input.generation,
    stage: input.stage,
    pipelineVersion: PIPELINE_VERSION,
    workKey: key,
    state: "pending",
    attempts: 0,
    leaseUntil: null,
    lastError: null,
    createdAt: input.now,
    updatedAt: input.now,
  };
}

export function claimForDispatch(task: OutboxTask, now: number, leaseMs: number): OutboxTask | null {
  if (task.state === "delivered") return null;
  if (task.state === "dispatching" && task.leaseUntil !== null && task.leaseUntil >= now) return null;
  return { ...task, state: "dispatching", attempts: task.attempts + 1, leaseUntil: now + leaseMs, updatedAt: now };
}

export function markDelivered(task: OutboxTask, now: number): OutboxTask {
  return { ...task, state: "delivered", leaseUntil: null, lastError: null, updatedAt: now };
}

export function releaseAfterError(task: OutboxTask, now: number, error: string): OutboxTask {
  return { ...task, state: "pending", leaseUntil: null, lastError: error, updatedAt: now };
}
