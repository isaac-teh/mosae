import { describe, it, expect, vi } from "vitest";
import { adminDb } from "../firebase/admin.js";
import { buildOriginalPath } from "../domain/ids.js";
import { createProject, openSession } from "./projectStore.js";
import { startStoragePoller, type StorageObject } from "./storagePoller.js";

const BUCKET = "demo-mosae.appspot.com";

async function setup() {
  const userId = `u-${crypto.randomUUID()}`;
  const project = await createProject(adminDb, { userId, mode: "memory", now: 1 });
  const { session, entries } = await openSession(adminDb, {
    userId,
    projectId: project.id,
    entries: [{ fileName: "a.jpg", contentType: "image/jpeg", sizeBytes: 100 }],
    now: 1,
  });
  const entry = entries[0];
  const objectName = buildOriginalPath({ userId, projectId: project.id, sessionId: session.id, assetId: entry.assetId });
  return { userId, project, session, entry, objectName };
}

const waitFor = async (check: () => Promise<boolean>, timeoutMs = 5000): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("timed out waiting for condition");
};

describe("startStoragePoller (emulator)", () => {
  it("finalizes a listed upload and reports it accepted", async () => {
    const { project, entry, objectName } = await setup();
    const object: StorageObject = { name: objectName, generation: "1001", sizeBytes: 100, contentType: "image/jpeg" };
    const onAccepted = vi.fn().mockResolvedValue(undefined);

    const stop = startStoragePoller(
      { db: adminDb, bucketName: BUCKET, listUploads: async () => [object], onAccepted, now: () => 10 },
      20,
    );
    try {
      await waitFor(async () => {
        const asset = await adminDb.doc(`projects/${project.id}/assets/${entry.assetId}`).get();
        return asset.get("status") === "uploaded";
      });
      expect(onAccepted).toHaveBeenCalled();
    } finally {
      stop();
    }
  });

  it("does not re-finalize the same object generation on a later poll", async () => {
    const { project, entry, objectName } = await setup();
    const object: StorageObject = { name: objectName, generation: "2002", sizeBytes: 100, contentType: "image/jpeg" };
    const onAccepted = vi.fn().mockResolvedValue(undefined);

    const stop = startStoragePoller(
      { db: adminDb, bucketName: BUCKET, listUploads: async () => [object], onAccepted, now: () => 10 },
      15,
    );
    try {
      await waitFor(async () => {
        const asset = await adminDb.doc(`projects/${project.id}/assets/${entry.assetId}`).get();
        return asset.get("status") === "uploaded";
      });
      // Let a couple more poll cycles run.
      await new Promise((resolve) => setTimeout(resolve, 80));
      const tasks = await adminDb.collection(`projects/${project.id}/taskOutbox`).get();
      expect(tasks.size).toBe(1);
      expect(onAccepted).toHaveBeenCalledTimes(1);
    } finally {
      stop();
    }
  });

  it("leaves an unregistered object un-seen so a later poll can retry it", async () => {
    const object: StorageObject = { name: "uploads/u1/p1/s1/a1/original", generation: "1", sizeBytes: 10, contentType: "image/jpeg" };
    const listUploads = vi.fn().mockResolvedValue([object]);
    const onAccepted = vi.fn().mockResolvedValue(undefined);

    const stop = startStoragePoller({ db: adminDb, bucketName: BUCKET, listUploads, onAccepted, now: () => 10 }, 15);
    try {
      await waitFor(async () => listUploads.mock.calls.length >= 3);
    } finally {
      stop();
    }
    expect(onAccepted).not.toHaveBeenCalled();
  });

  it("stops polling once stop() is called", async () => {
    const listUploads = vi.fn().mockResolvedValue([]);
    const stop = startStoragePoller({ db: adminDb, bucketName: BUCKET, listUploads, onAccepted: vi.fn(), now: () => 10 }, 15);
    await waitFor(async () => listUploads.mock.calls.length >= 1);
    stop();
    const callsAtStop = listUploads.mock.calls.length;
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(listUploads.mock.calls.length).toBe(callsAtStop);
  });
});
