import { describe, it, expect } from "vitest";
import { adminDb } from "../firebase/admin.js";
import { buildOriginalPath } from "../domain/ids.js";
import { createProject, openSession } from "./projectStore.js";
import { recordFinalize } from "./finalizeStore.js";

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
  const event = { bucket: BUCKET, objectName, generation: "1001", sizeBytes: 100, contentType: "image/jpeg", now: 10 };
  return { userId, project, session, entry, event };
}

describe("recordFinalize (emulator)", () => {
  it("accepts a registered upload and atomically writes asset and outbox task", async () => {
    const { project, entry, event } = await setup();
    const result = await recordFinalize(adminDb, BUCKET, event);
    expect(result).toMatchObject({ kind: "accepted", assetId: entry.assetId });

    const asset = await adminDb.doc(`projects/${project.id}/assets/${entry.assetId}`).get();
    expect(asset.data()).toMatchObject({ status: "uploaded", generation: "1001", pipelineVersion: 1 });

    const tasks = await adminDb.collection(`projects/${project.id}/taskOutbox`).get();
    expect(tasks.size).toBe(1);
    expect(tasks.docs[0].data()).toMatchObject({ stage: "ingest", state: "pending", generation: "1001" });
  });

  it("is idempotent for duplicate finalize events", async () => {
    const { project, event } = await setup();
    await recordFinalize(adminDb, BUCKET, event);
    expect(await recordFinalize(adminDb, BUCKET, event)).toEqual({ kind: "duplicate" });
    const tasks = await adminDb.collection(`projects/${project.id}/taskOutbox`).get();
    expect(tasks.size).toBe(1);
  });

  it("ignores proxies and renders, and rejects other buckets", async () => {
    const { event } = await setup();
    expect(await recordFinalize(adminDb, BUCKET, { ...event, objectName: event.objectName.replace("original", "thumb.jpg") })).toEqual({ kind: "ignored_path" });
    expect(await recordFinalize(adminDb, "other-bucket", event)).toEqual({ kind: "wrong_bucket" });
  });

  it("rejects unregistered uploads and ownership mismatches", async () => {
    const { event, userId } = await setup();
    expect(await recordFinalize(adminDb, BUCKET, { ...event, objectName: event.objectName.replace(/[^/]+\/original$/, "unknownAsset/original") })).toEqual({ kind: "unregistered" });
    expect(await recordFinalize(adminDb, BUCKET, { ...event, objectName: event.objectName.replace(userId, "intruder") })).toEqual({ kind: "unregistered" });
  });

  it("fails the entry on size mismatch and writes no task", async () => {
    const { project, session, entry, event } = await setup();
    expect(await recordFinalize(adminDb, BUCKET, { ...event, sizeBytes: 99 })).toEqual({ kind: "rejected", reason: "size_mismatch" });
    const stored = await adminDb.doc(`projects/${project.id}/uploadSessions/${session.id}/entries/${entry.assetId}`).get();
    expect(stored.data()).toMatchObject({ outcome: "failed", failureReason: "size_mismatch" });
    expect((await adminDb.collection(`projects/${project.id}/taskOutbox`).get()).size).toBe(0);
  });

  it("treats a newer generation after ingest as stale", async () => {
    const { project, entry, event } = await setup();
    await recordFinalize(adminDb, BUCKET, event);
    await adminDb.doc(`projects/${project.id}/assets/${entry.assetId}`).update({ status: "ingested" });
    expect(await recordFinalize(adminDb, BUCKET, { ...event, generation: "2002" })).toEqual({ kind: "stale" });
  });
});
