import { describe, it, expect, vi } from "vitest";
import { adminDb } from "../firebase/admin.js";
import { buildOriginalPath } from "../domain/ids.js";
import { DISPATCH_LEASE_MS } from "../domain/outbox.js";
import { createProject, openSession } from "./projectStore.js";
import { recordFinalize } from "./finalizeStore.js";
import { claimDue } from "./outboxStore.js";
import { dispatchDue } from "../outbox/dispatcher.js";
import { InMemoryTaskQueue } from "../queue/taskQueue.js";

const BUCKET = "demo-mosae.appspot.com";

async function acceptedUpload(now: number) {
  const userId = `u-${crypto.randomUUID()}`;
  const project = await createProject(adminDb, { userId, mode: "memory", now });
  const { session, entries } = await openSession(adminDb, {
    userId,
    projectId: project.id,
    entries: [{ fileName: "a.jpg", contentType: "image/jpeg", sizeBytes: 10 }],
    now,
  });
  const objectName = buildOriginalPath({ userId, projectId: project.id, sessionId: session.id, assetId: entries[0].assetId });
  await recordFinalize(adminDb, BUCKET, { bucket: BUCKET, objectName, generation: "5", sizeBytes: 10, contentType: "image/jpeg", now });
  return project.id;
}

async function taskState(projectId: string) {
  const snap = await adminDb.collection(`projects/${projectId}/taskOutbox`).get();
  return snap.docs[0].data();
}

async function taskId(projectId: string) {
  const snap = await adminDb.collection(`projects/${projectId}/taskOutbox`).get();
  return snap.docs[0].id;
}

describe("dispatchDue (emulator)", () => {
  it("enqueues pending tasks once and marks them delivered", async () => {
    const projectId = await acceptedUpload(1);
    const queue = new InMemoryTaskQueue();
    await dispatchDue(adminDb, queue, 100, 1000);
    expect(queue.tasks.filter((t) => t.body.projectId === projectId)).toHaveLength(1);
    expect(queue.tasks.find((t) => t.body.projectId === projectId)?.path).toBe("/tasks/ingest");
    expect(queue.tasks.find((t) => t.body.projectId === projectId)?.body).toMatchObject({ subjectKind: "asset" });
    expect(await taskState(projectId)).toMatchObject({ state: "delivered" });

    await dispatchDue(adminDb, queue, 200, 1000);
    expect(queue.tasks.filter((t) => t.body.projectId === projectId)).toHaveLength(1);
  });

  it("returns a task to pending when the queue fails, then delivers on the next run", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const projectId = await acceptedUpload(1);
    const queue = new InMemoryTaskQueue();
    queue.failOnce(await taskId(projectId), new Error("queue unavailable"));
    const first = await dispatchDue(adminDb, queue, 100, 1000);
    expect(first.failed).toBe(1);
    expect(error).toHaveBeenCalledWith("outbox dispatch failed", expect.any(String), expect.any(Error));
    expect(await taskState(projectId)).toMatchObject({ state: "pending", lastError: "queue unavailable" });

    await dispatchDue(adminDb, queue, 200, 1000);
    expect(await taskState(projectId)).toMatchObject({ state: "delivered" });
    error.mockRestore();
  });

  it("recovers a task claimed by a crashed dispatcher after its lease expires", async () => {
    const projectId = await acceptedUpload(1);
    const claimed = await claimDue(adminDb, 100, 1000);
    expect(claimed.some((t) => t.projectId === projectId)).toBe(true);

    const queue = new InMemoryTaskQueue();
    await dispatchDue(adminDb, queue, 150, 1000);
    expect(await taskState(projectId)).toMatchObject({ state: "dispatching" });

    await dispatchDue(adminDb, queue, 100 + DISPATCH_LEASE_MS + 1, 1000);
    expect(await taskState(projectId)).toMatchObject({ state: "delivered", attempts: 2 });
  });
});
