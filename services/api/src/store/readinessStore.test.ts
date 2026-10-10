import { describe, it, expect } from "vitest";
import { adminDb } from "../firebase/admin.js";
import { closeSession, createProject, openSession, recordClientOutcome } from "./projectStore.js";
import { gatherFacts, gatherSummaryUpload, settleProject } from "./readinessStore.js";

async function seed(count: number) {
  const userId = `u-${crypto.randomUUID()}`;
  const project = await createProject(adminDb, { userId, mode: "memory", now: 1 });
  const { session, entries } = await openSession(adminDb, {
    userId,
    projectId: project.id,
    entries: Array.from({ length: count }, (_, i) => ({ fileName: `a${i}.jpg`, contentType: "image/jpeg", sizeBytes: 10 })),
    now: 1,
  });
  return { userId, projectId: project.id, sessionId: session.id, assetIds: entries.map((e) => e.assetId) };
}

const asset = (projectId: string, assetId: string) => adminDb.collection(`projects/${projectId}/assets`).doc(assetId);
const entry = (projectId: string, sessionId: string, assetId: string) =>
  adminDb.doc(`projects/${projectId}/uploadSessions/${sessionId}/entries/${assetId}`);

async function finalizeAndIngest(s: Awaited<ReturnType<typeof seed>>, assetId: string, status: "understood" | "failed" | "uploaded") {
  await entry(s.projectId, s.sessionId, assetId).update({ outcome: "finalized", generation: "1" });
  await asset(s.projectId, assetId).set({ id: assetId, status });
}

describe("gatherFacts (emulator)", () => {
  it("counts sessions, pending entries and asset states", async () => {
    const s = await seed(3);
    await finalizeAndIngest(s, s.assetIds[0], "understood");
    await finalizeAndIngest(s, s.assetIds[1], "failed");
    const facts = await gatherFacts(adminDb, s.projectId);
    expect(facts).toEqual({ sessions: 1, openSessions: 1, pendingEntries: 1, assets: 2, ingested: 1, failed: 1 });
    expect(await gatherSummaryUpload(adminDb, s.projectId, [
      { id: s.assetIds[0], status: "understood" }, { id: s.assetIds[1], status: "failed" },
    ])).toMatchObject({ upload: { expected: 3, settled: 2, uploaded: 2, failed: 0, failedAssetIds: [], failedEntries: [], pendingEntries: [{ assetId: s.assetIds[2], sessionId: s.sessionId }], processingFailed: 1, cancelled: 0, closed: false }, manifestReady: false, excludedAssetIds: [] });
  });

  it("retires a failed manifest count only after its explicitly linked replacement finalizes", async () => {
    const s = await seed(1);
    const failedId = s.assetIds[0]!;
    await recordClientOutcome(adminDb, { userId: s.userId, projectId: s.projectId, sessionId: s.sessionId, assetId: failedId, event: { kind: "failed", reason: "storage/unknown" } });
    const replacement = await openSession(adminDb, { userId: s.userId, projectId: s.projectId, entries: [{ fileName: "retry.jpg", contentType: "image/jpeg", sizeBytes: 10, replacesAssetId: failedId, replacesSessionId: s.sessionId }], now: 2 });
    const replacementId = replacement.entries[0]!.assetId;
    await entry(s.projectId, replacement.session.id, replacementId).update({ outcome: "finalized", generation: "1" });
    await asset(s.projectId, replacementId).set({ id: replacementId, status: "understood" });
    expect(await gatherSummaryUpload(adminDb, s.projectId, [{ id: replacementId, status: "understood" }])).toMatchObject({ upload: { expected: 1, settled: 1, uploaded: 1, failed: 0, failedAssetIds: [], failedEntries: [] }, excludedAssetIds: [failedId] });
  });

  it("reports finalized transfers as uploaded even when later processing fails", async () => {
    const s = await seed(1);
    await finalizeAndIngest(s, s.assetIds[0]!, "failed");
    const result = await gatherSummaryUpload(adminDb, s.projectId, [{ id: s.assetIds[0], status: "failed" }]);
    expect(result.upload).toMatchObject({ expected: 1, settled: 1, uploaded: 1, failed: 0, processingFailed: 1, failedEntries: [] });
    expect(result.upload.failedAssetIds).toEqual([]);
  });

  it("recovers old-shape manifest failures and pending entries without changing logical expected counts", async () => {
    const userId = `u-${crypto.randomUUID()}`;
    const project = await createProject(adminDb, { userId, mode: "memory", now: 1 });
    const session = await adminDb.collection(`projects/${project.id}/uploadSessions`).add({ id: "legacy-session", projectId: project.id, userId, closed: true, createdAt: 1 });
    const failedRef = session.collection("entries").doc("legacy-failed");
    const pendingRef = session.collection("entries").doc("legacy-pending");
    await failedRef.set({ assetId: "legacy-failed", fileName: "bad.jpg", contentType: "image/jpeg", sizeBytes: 10, outcome: "failed", generation: null, failureReason: "storage/unknown" });
    await pendingRef.set({ assetId: "legacy-pending", fileName: "unknown.jpg", contentType: "image/jpeg", sizeBytes: 10, outcome: "pending", generation: null, failureReason: null });
    const failedReplacement = await openSession(adminDb, { userId, projectId: project.id, entries: [{ fileName: "retry.jpg", contentType: "image/jpeg", sizeBytes: 10, replacesAssetId: "legacy-failed", replacesSessionId: session.id }], now: 2 });
    const pendingReplacement = await openSession(adminDb, { userId, projectId: project.id, entries: [{ fileName: "resume.jpg", contentType: "image/jpeg", sizeBytes: 10, replacesAssetId: "legacy-pending", replacesSessionId: session.id }], now: 3 });
    const entries = [failedReplacement.entries[0]!, pendingReplacement.entries[0]!];
    for (const item of entries) await entry(project.id, item.sessionId!, item.assetId).update({ outcome: "finalized", generation: "1" });
    await adminDb.doc(`projects/${project.id}/uploadSessions/${pendingReplacement.session.id}/entries/${entries[1]!.assetId}`).update({ outcome: "finalized", generation: "1" });
    await asset(project.id, entries[0]!.assetId).set({ id: entries[0]!.assetId, status: "understood" });
    await asset(project.id, entries[1]!.assetId).set({ id: entries[1]!.assetId, status: "understood" });
    const summary = await gatherSummaryUpload(adminDb, project.id, entries.map((item) => ({ id: item.assetId, status: "understood" })));
    expect(summary.upload).toMatchObject({ expected: 2, settled: 2, uploaded: 2, failed: 0, failedEntries: [] });
    expect((await failedRef.get()).get("replacementSuccessorId")).toBe(entries[0]!.assetId);
    expect((await pendingRef.get()).data()).toMatchObject({ outcome: "cancelled", replacementSuccessorId: entries[1]!.assetId });
  });
});

describe("settleProject (emulator)", () => {
  it("publishes owner-readable readiness facts whenever a settle check runs", async () => {
    const s = await seed(1);
    await settleProject(adminDb, s.projectId, 5);
    const snapshot = await adminDb.doc(`projects/${s.projectId}/readiness/summary`).get();
    expect(snapshot.data()).toMatchObject({ sessions: 1, openSessions: 1, pendingEntries: 1, assets: 0, ingested: 0, failed: 0, settled: false, updatedAt: 5 });
  });

  it("does not settle while the session is open", async () => {
    const s = await seed(2);
    await finalizeAndIngest(s, s.assetIds[0], "understood");
    await finalizeAndIngest(s, s.assetIds[1], "understood");
    const result = await settleProject(adminDb, s.projectId, 5);
    expect(result).toMatchObject({ settled: false, enqueued: false, outcome: null });
  });

  it("does not settle while an asset is still uploaded but not ingested", async () => {
    const s = await seed(2);
    await finalizeAndIngest(s, s.assetIds[0], "understood");
    await finalizeAndIngest(s, s.assetIds[1], "uploaded");
    await closeSession(adminDb, { userId: s.userId, projectId: s.projectId, sessionId: s.sessionId });
    expect((await settleProject(adminDb, s.projectId, 5)).settled).toBe(false);
  });

  it("settles a closed session whose assets all ingested, and enqueues one cluster task", async () => {
    const s = await seed(2);
    await finalizeAndIngest(s, s.assetIds[0], "understood");
    await finalizeAndIngest(s, s.assetIds[1], "understood");
    await closeSession(adminDb, { userId: s.userId, projectId: s.projectId, sessionId: s.sessionId });

    const result = await settleProject(adminDb, s.projectId, 5);
    expect(result).toMatchObject({ settled: true, enqueued: true, outcome: "ready" });

    const tasks = await adminDb.collection(`projects/${s.projectId}/taskOutbox`).get();
    expect(tasks.size).toBe(1);
    expect(tasks.docs[0].data()).toMatchObject({ stage: "cluster", subjectKind: "project", subjectId: s.projectId, generation: "2", state: "pending" });
  });

  it("is idempotent: a second settle reports settled but enqueues nothing", async () => {
    const s = await seed(1);
    await finalizeAndIngest(s, s.assetIds[0], "understood");
    await closeSession(adminDb, { userId: s.userId, projectId: s.projectId, sessionId: s.sessionId });
    expect((await settleProject(adminDb, s.projectId, 5)).enqueued).toBe(true);
    const again = await settleProject(adminDb, s.projectId, 6);
    expect(again).toMatchObject({ settled: true, enqueued: false });
    expect((await adminDb.collection(`projects/${s.projectId}/taskOutbox`).get()).size).toBe(1);
  });

  it("reports ready_with_errors when one asset failed", async () => {
    const s = await seed(2);
    await finalizeAndIngest(s, s.assetIds[0], "understood");
    await finalizeAndIngest(s, s.assetIds[1], "failed");
    await closeSession(adminDb, { userId: s.userId, projectId: s.projectId, sessionId: s.sessionId });
    expect(await settleProject(adminDb, s.projectId, 5)).toMatchObject({ settled: true, outcome: "ready_with_errors" });
  });

  it("settles a project whose uploads were all cancelled as failed, with generation 0", async () => {
    const s = await seed(2);
    for (const assetId of s.assetIds) {
      await recordClientOutcome(adminDb, { userId: s.userId, projectId: s.projectId, sessionId: s.sessionId, assetId, event: { kind: "cancelled" } });
    }
    await closeSession(adminDb, { userId: s.userId, projectId: s.projectId, sessionId: s.sessionId });
    const result = await settleProject(adminDb, s.projectId, 5);
    expect(result).toMatchObject({ settled: true, enqueued: true, outcome: "failed" });
    const tasks = await adminDb.collection(`projects/${s.projectId}/taskOutbox`).get();
    expect(tasks.docs[0].data()).toMatchObject({ generation: "0" });
  });
});
