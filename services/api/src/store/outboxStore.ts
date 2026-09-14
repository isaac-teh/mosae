import type { Firestore } from "firebase-admin/firestore";
import {
  claimForDispatch,
  markDelivered,
  releaseAfterError,
  DISPATCH_LEASE_MS,
  type OutboxTask,
} from "../domain/outbox.js";

const taskRef = (db: Firestore, task: OutboxTask) =>
  db.collection("projects").doc(task.projectId).collection("taskOutbox").doc(task.id);

export async function claimDue(db: Firestore, now: number, limit: number): Promise<OutboxTask[]> {
  const candidates = await db
    .collectionGroup("taskOutbox")
    .where("state", "in", ["pending", "dispatching"])
    .orderBy("updatedAt")
    .limit(limit)
    .get();

  const claimed: OutboxTask[] = [];
  for (const doc of candidates.docs) {
    const task = await db.runTransaction(async (tx) => {
      const fresh = await tx.get(doc.ref);
      if (!fresh.exists) return null;
      const next = claimForDispatch(fresh.data() as OutboxTask, now, DISPATCH_LEASE_MS);
      if (next) tx.set(doc.ref, next);
      return next;
    });
    if (task) claimed.push(task);
  }
  return claimed;
}

async function updateIfSameAttempt(db: Firestore, task: OutboxTask, next: OutboxTask): Promise<void> {
  const ref = taskRef(db, task);
  await db.runTransaction(async (tx) => {
    const fresh = await tx.get(ref);
    if (!fresh.exists) return;
    const stored = fresh.data() as OutboxTask;
    if (stored.state !== "dispatching" || stored.attempts !== task.attempts) return;
    tx.set(ref, next);
  });
}

export function completeDispatch(db: Firestore, task: OutboxTask, now: number): Promise<void> {
  return updateIfSameAttempt(db, task, markDelivered(task, now));
}

export function failDispatch(db: Firestore, task: OutboxTask, now: number, error: string): Promise<void> {
  return updateIfSameAttempt(db, task, releaseAfterError(task, now, error));
}
