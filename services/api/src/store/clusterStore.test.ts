import { describe, expect, it } from "vitest";
import { adminDb } from "../firebase/admin.js";
import type { MediaFacts, QualityFacts } from "../domain/media.js";
import { runProjectPass } from "./clusterStore.js";
import { closeSession, createProject, openSession } from "./projectStore.js";

const media = (localTime: string | null): MediaFacts => ({ kind: "photo", width: 4, height: 3, durationSec: null, localTime, timeSource: localTime ? "exif" : "none", gps: null, camera: null });
const quality = (sharpness: number, dHash: string): QualityFacts => ({ sharpness, exposure: 120, blurry: false, dHash });

type Spec = { localTime: string | null; status?: "ingested" | "failed"; sharpness?: number; dHash?: string };

async function seedProject(specs: Spec[], options: { closeSession?: boolean } = {}) {
  const userId = `u-${crypto.randomUUID()}`;
  const project = await createProject(adminDb, { userId, mode: "memory", now: 1 });
  await adminDb.doc(`projects/${project.id}`).update({ status: "processing" });
  const { session, entries } = await openSession(adminDb, {
    userId,
    projectId: project.id,
    entries: specs.map((_, i) => ({ fileName: `a${i}.jpg`, contentType: "image/jpeg", sizeBytes: 10 })),
    now: 1,
  });
  for (const [i, spec] of specs.entries()) {
    const assetId = entries[i].assetId;
    await adminDb.doc(`projects/${project.id}/uploadSessions/${session.id}/entries/${assetId}`).update({ outcome: "finalized", generation: "1" });
    await adminDb.doc(`projects/${project.id}/assets/${assetId}`).set({
      id: assetId, projectId: project.id, userId, status: spec.status ?? "ingested", generation: "1", createdAt: 100 + i,
      ...(spec.status === "failed" ? {} : { media: media(spec.localTime), quality: quality(spec.sharpness ?? 50, spec.dHash ?? "0000000000000000") }),
    });
  }
  if (options.closeSession !== false) await closeSession(adminDb, { userId, projectId: project.id, sessionId: session.id });
  return { projectId: project.id, assetIds: entries.map((e) => e.assetId) };
}

const projectDoc = async (projectId: string) => (await adminDb.doc(`projects/${projectId}`).get()).data() ?? {};
const asset = async (projectId: string, id: string) => (await adminDb.doc(`projects/${projectId}/assets/${id}`).get()).data() ?? {};
const events = async (projectId: string) => (await adminDb.collection(`projects/${projectId}/events`).get()).docs.map((d) => d.data());

describe("runProjectPass (emulator)", () => {
  it("clusters two days into events, links assets to them and marks the project ready", async () => {
    const { projectId, assetIds } = await seedProject([
      { localTime: "2026-05-03T09:00:00", dHash: "0000000000000001" },
      { localTime: "2026-05-03T09:30:00", dHash: "ffff000000000000" },
      { localTime: "2026-05-04T19:00:00", dHash: "00ff00ff00ff00ff" },
    ]);
    const result = await runProjectPass(adminDb, projectId, 500);
    expect(result).toEqual({ status: "ready", events: 2, duplicates: 0 });

    const stored = await events(projectId);
    expect(stored.map((e) => [e.id, e.dayIndex, e.label, e.assetCount])).toEqual(expect.arrayContaining([
      ["e001", 1, "Day 1, morning", 2],
      ["e002", 2, "Day 2, evening", 1],
    ]));
    expect((await asset(projectId, assetIds[0])).eventId).toBe("e001");
    expect((await asset(projectId, assetIds[2])).eventId).toBe("e002");
    expect(await projectDoc(projectId)).toMatchObject({ status: "ready", eventCount: 2, dateRange: { start: "2026-05-03", end: "2026-05-04" }, readyAt: 500 });
  });

  it("links a burst of near-identical photos to the sharpest one", async () => {
    const same = "00ff00ff00ff00ff";
    const { projectId, assetIds } = await seedProject([
      { localTime: "2026-05-03T09:00:00", dHash: same, sharpness: 40 },
      { localTime: "2026-05-03T09:00:03", dHash: same, sharpness: 95 },
      { localTime: "2026-05-03T09:00:06", dHash: same, sharpness: 60 },
    ]);
    const result = await runProjectPass(adminDb, projectId, 500);
    expect(result).toMatchObject({ status: "ready", duplicates: 2 });
    expect((await asset(projectId, assetIds[1])).dupOf).toBeNull();
    expect((await asset(projectId, assetIds[0])).dupOf).toBe(assetIds[1]);
    expect((await asset(projectId, assetIds[2])).dupOf).toBe(assetIds[1]);
  });

  it("puts media with no capture time in an undated event", async () => {
    const { projectId, assetIds } = await seedProject([{ localTime: "2026-05-03T09:00:00" }, { localTime: null }]);
    await runProjectPass(adminDb, projectId, 500);
    expect((await asset(projectId, assetIds[1])).eventId).toBe("undated");
    expect(await projectDoc(projectId)).toMatchObject({ dateRange: { start: "2026-05-03", end: "2026-05-03" } });
  });

  it("marks the project ready_with_errors and leaves a failed asset unclustered", async () => {
    const { projectId, assetIds } = await seedProject([{ localTime: "2026-05-03T09:00:00" }, { localTime: null, status: "failed" }]);
    expect(await runProjectPass(adminDb, projectId, 500)).toMatchObject({ status: "ready_with_errors" });
    expect((await asset(projectId, assetIds[1])).eventId).toBeUndefined();
    expect(await projectDoc(projectId)).toMatchObject({ status: "ready_with_errors" });
  });

  it("marks a project with nothing usable failed and records no events", async () => {
    const { projectId } = await seedProject([{ localTime: null, status: "failed" }, { localTime: null, status: "failed" }]);
    expect(await runProjectPass(adminDb, projectId, 500)).toEqual({ status: "failed", events: 0, duplicates: 0 });
    expect(await projectDoc(projectId)).toMatchObject({ status: "failed", eventCount: 0, dateRange: null });
    expect(await events(projectId)).toEqual([]);
  });

  it("skips a project that has not settled and leaves it untouched", async () => {
    const { projectId } = await seedProject([{ localTime: "2026-05-03T09:00:00" }], { closeSession: false });
    expect(await runProjectPass(adminDb, projectId, 500)).toEqual({ status: "skipped" });
    expect(await projectDoc(projectId)).toMatchObject({ status: "processing" });
    expect(await events(projectId)).toEqual([]);
  });

  it("does not touch a project with an unexpired cluster lease", async () => {
    const { projectId } = await seedProject([{ localTime: "2026-05-03T09:00:00" }]);
    await adminDb.doc(`projects/${projectId}`).update({ clusterLease: { ownerId: "other", expiresAt: 501 } });
    expect(await runProjectPass(adminDb, projectId, 500)).toEqual({ status: "skipped" });
    expect(await events(projectId)).toEqual([]);
    expect(await projectDoc(projectId)).toMatchObject({ status: "processing", clusterLease: { ownerId: "other" } });
  });

  it("takes an expired lease and clears its lease after publishing", async () => {
    const { projectId } = await seedProject([{ localTime: "2026-05-03T09:00:00" }]);
    await adminDb.doc(`projects/${projectId}`).update({ clusterLease: { ownerId: "other", expiresAt: 499 } });
    await runProjectPass(adminDb, projectId, 500);
    expect((await projectDoc(projectId)).clusterLease).toBeUndefined();
  });

  it("is idempotent: running twice leaves the same events, not doubled ones", async () => {
    const { projectId } = await seedProject([{ localTime: "2026-05-03T09:00:00" }, { localTime: "2026-05-03T20:00:00" }]);
    await runProjectPass(adminDb, projectId, 500);
    await runProjectPass(adminDb, projectId, 600);
    expect(await events(projectId)).toHaveLength(2);
    expect(await projectDoc(projectId)).toMatchObject({ readyAt: 600 });
  });

  it("removes stale events while retaining the rebuilt event set and published project state", async () => {
    const { projectId } = await seedProject([
      { localTime: "2026-05-03T09:00:00" },
      { localTime: "2026-05-04T19:00:00" },
    ]);
    await adminDb.doc(`projects/${projectId}/events/e999`).set({ id: "e999", label: "stale", assetCount: 99 });
    await expect(runProjectPass(adminDb, projectId, 500)).resolves.toEqual({ status: "ready", events: 2, duplicates: 0 });
    expect((await adminDb.doc(`projects/${projectId}/events/e999`).get()).exists).toBe(false);
    expect((await events(projectId)).map((event) => [event.id, event.assetCount])).toEqual(expect.arrayContaining([["e001", 1], ["e002", 1]]));
    expect(await projectDoc(projectId)).toMatchObject({ status: "ready", eventCount: 2, readyAt: 500 });
  });

  it("leaves an exact, lease-free event set when two passes start together", async () => {
    const { projectId } = await seedProject([
      { localTime: "2026-05-03T09:00:00" },
      { localTime: "2026-05-04T19:00:00" },
    ]);
    const results = await Promise.all([runProjectPass(adminDb, projectId, 500), runProjectPass(adminDb, projectId, 500)]);
    expect(results.some((result) => result.status !== "skipped")).toBe(true);
    expect((await events(projectId)).map((event) => event.id).sort()).toEqual(["e001", "e002"]);
    expect(await projectDoc(projectId)).toMatchObject({ status: "ready", eventCount: 2 });
    expect((await projectDoc(projectId)).clusterLease).toBeUndefined();
  });
});
