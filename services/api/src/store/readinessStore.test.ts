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
    ])).toEqual({ upload: { expected: 3, settled: 2, failed: 1, cancelled: 0, closed: false }, manifestReady: false });
  });
});

describe("settleProject (emulator)", () => {
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
