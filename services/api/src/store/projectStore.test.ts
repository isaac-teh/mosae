import { describe, it, expect } from "vitest";
import { adminDb } from "../firebase/admin.js";
import {
  addEntries,
  closeSession,
  createProject,
  getOwnedProject,
  openSession,
  recordClientOutcome,
  StoreError,
} from "./projectStore.js";

const photo = { fileName: "IMG_1.jpg", contentType: "image/jpeg", sizeBytes: 2048 };
const video = { fileName: "clip.mov", contentType: "video/quicktime", sizeBytes: 9000 };

async function newProject(userId = `u-${crypto.randomUUID()}`) {
  return createProject(adminDb, { userId, mode: "memory", now: 1 });
}

describe("projectStore (emulator)", () => {
  it("creates a project readable only by its owner", async () => {
    const project = await newProject("owner-1");
    expect(await getOwnedProject(adminDb, "owner-1", project.id)).toMatchObject({ userId: "owner-1", status: "collecting" });
    expect(await getOwnedProject(adminDb, "someone-else", project.id)).toBeNull();
  });

  it("opens a session with pending manifest entries", async () => {
    const project = await newProject();
    const { session, entries } = await openSession(adminDb, {
      userId: project.userId,
      projectId: project.id,
      entries: [photo, video],
      now: 5,
    });
    expect(session.closed).toBe(false);
    expect(entries).toHaveLength(2);
    expect(entries.every((e) => e.outcome === "pending" && e.generation === null)).toBe(true);
    const stored = await adminDb.collection(`projects/${project.id}/uploadSessions/${session.id}/entries`).get();
    expect(stored.size).toBe(2);
  });

  it("rejects invalid entries and foreign projects", async () => {
    const project = await newProject();
    await expect(
      openSession(adminDb, { userId: project.userId, projectId: project.id, entries: [{ ...photo, contentType: "text/plain" }], now: 1 }),
    ).rejects.toMatchObject({ code: "invalid_entry" });
    await expect(
      openSession(adminDb, { userId: "intruder", projectId: project.id, entries: [photo], now: 1 }),
    ).rejects.toMatchObject({ code: "not_found" });
  });

  it("rejects more than 500 entries", async () => {
    const project = await newProject();
    await expect(openSession(adminDb, { userId: project.userId, projectId: project.id, entries: Array.from({ length: 501 }, () => photo), now: 1 })).rejects.toMatchObject({ code: "too_many_entries" });
  });

  it("blocks new entries after close without finalizing pending ones", async () => {
    const project = await newProject();
    const { session } = await openSession(adminDb, { userId: project.userId, projectId: project.id, entries: [photo], now: 1 });
    const closed = await closeSession(adminDb, { userId: project.userId, projectId: project.id, sessionId: session.id });
    expect(closed.closed).toBe(true);
    await expect(
      addEntries(adminDb, { userId: project.userId, projectId: project.id, sessionId: session.id, entries: [video] }),
    ).rejects.toBeInstanceOf(StoreError);
    const entries = await adminDb.collection(`projects/${project.id}/uploadSessions/${session.id}/entries`).get();
    expect(entries.docs.map((d) => d.get("outcome"))).toEqual(["pending"]);
  });

  it("records client cancellation and failure without regressing", async () => {
    const project = await newProject();
    const { session, entries } = await openSession(adminDb, {
      userId: project.userId,
      projectId: project.id,
      entries: [photo, video],
      now: 1,
    });
    const ref = { userId: project.userId, projectId: project.id, sessionId: session.id };
    const cancelled = await recordClientOutcome(adminDb, { ...ref, assetId: entries[0].assetId, event: { kind: "cancelled" } });
    expect(cancelled.outcome).toBe("cancelled");
    const failed = await recordClientOutcome(adminDb, { ...ref, assetId: entries[1].assetId, event: { kind: "failed", reason: "network" } });
    expect(failed).toMatchObject({ outcome: "failed", failureReason: "network" });
    const still = await recordClientOutcome(adminDb, { ...ref, assetId: entries[1].assetId, event: { kind: "cancelled" } });
    expect(still.outcome).toBe("failed");
  });

  it("validates replacement targets as failed or cancelled entries owned by this project", async () => {
    const project = await newProject();
    const otherProject = await newProject();
    const original = await openSession(adminDb, { userId: project.userId, projectId: project.id, entries: [photo], now: 1 });
    const foreign = await openSession(adminDb, { userId: otherProject.userId, projectId: otherProject.id, entries: [photo], now: 1 });
    const replace = (assetId: string, sessionId: string) => openSession(adminDb, { userId: project.userId, projectId: project.id, entries: [{ ...photo, replacesAssetId: assetId, replacesSessionId: sessionId }], now: 2 });
    await expect(replace("missing", original.session.id)).rejects.toMatchObject({ code: "invalid_replacement" });
    await expect(replace(foreign.entries[0]!.assetId, foreign.session.id)).rejects.toMatchObject({ code: "invalid_replacement" });
    await expect(replace(original.entries[0]!.assetId, original.session.id)).rejects.toMatchObject({ code: "invalid_replacement" });
    await closeSession(adminDb, { userId: project.userId, projectId: project.id, sessionId: original.session.id });
    await adminDb.doc(`projects/${project.id}/uploadSessions/${original.session.id}/entries/${original.entries[0]!.assetId}`).update({ outcome: "finalized", generation: "1" });
    await adminDb.doc(`projects/${project.id}/assets/${original.entries[0]!.assetId}`).set({ id: original.entries[0]!.assetId, status: "failed" });
    await expect(replace(original.entries[0]!.assetId, original.session.id)).rejects.toMatchObject({ code: "invalid_replacement" });
  });

  it("atomically allows only one replacement successor for a failed entry", async () => {
    const project = await newProject();
    const original = await openSession(adminDb, { userId: project.userId, projectId: project.id, entries: [photo], now: 1 });
    await recordClientOutcome(adminDb, { userId: project.userId, projectId: project.id, sessionId: original.session.id, assetId: original.entries[0]!.assetId, event: { kind: "failed", reason: "storage/unknown" } });
    const createReplacement = () => openSession(adminDb, { userId: project.userId, projectId: project.id, entries: [{ ...photo, replacesAssetId: original.entries[0]!.assetId, replacesSessionId: original.session.id }], now: 2 });
    const outcomes = await Promise.allSettled([createReplacement(), createReplacement()]);
    expect(outcomes.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter((result) => result.status === "rejected")).toHaveLength(1);
    const rejected = outcomes.find((result): result is PromiseRejectedResult => result.status === "rejected");
    expect(rejected?.reason).toMatchObject({ code: "replacement_conflict" });
  });

  it("preserves one logical slot across repeated failed replacements", async () => {
    const project = await newProject();
    const original = await openSession(adminDb, { userId: project.userId, projectId: project.id, entries: [photo], now: 1 });
    await recordClientOutcome(adminDb, { userId: project.userId, projectId: project.id, sessionId: original.session.id, assetId: original.entries[0]!.assetId, event: { kind: "failed", reason: "storage/unknown" } });
    const replacement = await openSession(adminDb, { userId: project.userId, projectId: project.id, entries: [{ ...photo, replacesAssetId: original.entries[0]!.assetId, replacesSessionId: original.session.id }], now: 2 });
    await recordClientOutcome(adminDb, { userId: project.userId, projectId: project.id, sessionId: replacement.session.id, assetId: replacement.entries[0]!.assetId, event: { kind: "failed", reason: "storage/unknown" } });
    const successor = await openSession(adminDb, { userId: project.userId, projectId: project.id, entries: [{ ...photo, replacesAssetId: replacement.entries[0]!.assetId, replacesSessionId: replacement.session.id }], now: 3 });
    expect(successor.entries[0]).toMatchObject({ replacementOf: replacement.entries[0]!.assetId, logicalAssetId: original.entries[0]!.assetId });
    const target = await adminDb.doc(`projects/${project.id}/uploadSessions/${replacement.session.id}/entries/${replacement.entries[0]!.assetId}`).get();
    expect(target.get("replacementSuccessorId")).toBe(successor.entries[0]!.assetId);
  });

  it("allows recovery of a pending entry only after its session is closed", async () => {
    const project = await newProject();
    const abandoned = await openSession(adminDb, { userId: project.userId, projectId: project.id, entries: [photo], now: 1 });
    const next = () => openSession(adminDb, { userId: project.userId, projectId: project.id, entries: [{ ...photo, replacesAssetId: abandoned.entries[0]!.assetId, replacesSessionId: abandoned.session.id }], now: 2 });
    await expect(next()).rejects.toMatchObject({ code: "invalid_replacement" });
    await closeSession(adminDb, { userId: project.userId, projectId: project.id, sessionId: abandoned.session.id });
    const replacement = await next();
    const old = await adminDb.doc(`projects/${project.id}/uploadSessions/${abandoned.session.id}/entries/${abandoned.entries[0]!.assetId}`).get();
    expect(old.data()).toMatchObject({ outcome: "cancelled", replacementSuccessorId: replacement.entries[0]!.assetId });
  });
});
