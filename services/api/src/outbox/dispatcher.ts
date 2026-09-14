import type { Firestore } from "firebase-admin/firestore";
import type { OutboxTask } from "../domain/outbox.js";
import { claimDue, completeDispatch, failDispatch } from "../store/outboxStore.js";
import type { QueuedTask, TaskQueue } from "../queue/taskQueue.js";

function toQueued(task: OutboxTask): QueuedTask {
  return {
    name: task.id,
    path: task.stage === "ingest" ? "/tasks/ingest" : "/tasks/understand",
    body: { projectId: task.projectId, assetId: task.assetId, generation: task.generation, workKey: task.workKey },
  };
}

export async function dispatchDue(
  db: Firestore,
  queue: TaskQueue,
  now: number,
  limit = 100,
): Promise<{ delivered: number; failed: number }> {
  const tasks = await claimDue(db, now, limit);
  let delivered = 0;
  let failed = 0;
  for (const task of tasks) {
    try {
      await queue.enqueue(toQueued(task));
      await completeDispatch(db, task, now);
      delivered += 1;
    } catch (error) {
      console.error("outbox dispatch failed", task.workKey, error);
      await failDispatch(db, task, now, error instanceof Error ? error.message : String(error));
      failed += 1;
    }
  }
  return { delivered, failed };
}
