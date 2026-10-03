import express from "express";
import type { RequestHandler } from "express";
import request from "supertest";
import { listeningServer } from "../test/listeningServer.js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { adminDb } from "../firebase/admin.js";

function auth(userId: string): RequestHandler { return (_req, res, next) => { res.locals.userId = userId; next(); }; }
async function buildApp(userId: string) {
  const app = express(); app.use(express.json());
  app.use("/api/projects", (await import("./summary.js")).summaryRouter({ db: adminDb, auth: auth(userId) }));
  return app;
}
async function seed(userId: string) {
  const id = `summary-${crypto.randomUUID()}`;
  await adminDb.doc(`projects/${id}`).set({ id, userId, status: "ready" });
  return id;
}

describe("project summary route", () => {
  beforeEach(() => vi.resetAllMocks());
  it("returns the owner's summary", async () => {
    const id = await seed("summary-owner");
    await adminDb.doc(`projects/${id}/assets/a`).set({ status: "understood", media: { kind: "photo", localTime: "2026-10-21T10:00:00" }, place: { name: "Tokyo", country: "Japan" } });
    await adminDb.doc(`projects/${id}/shots/s`).set({ id: "s", assetId: "a", index: 0, analysis: { kind: "photo", faces: [] } });
    const res = await request(await listeningServer(await buildApp("summary-owner"))).get(`/api/projects/${id}/summary`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ assetStatuses: [{ assetId: "a", kind: "photo", status: "understood" }], total: 1, photos: 1, days: 1, places: ["Tokyo"], country: "Japan", processed: { ingested: 1, understood: 1, faces: 1 }, ready: { summary: true, faces: true, plan: false, story: true } });
  });
  it("returns 404 to another user", async () => {
    const id = await seed("summary-owner");
    expect((await request(await listeningServer(await buildApp("summary-other"))).get(`/api/projects/${id}/summary`)).status).toBe(404);
  });
  it("returns 404 for an unknown project", async () => {
    expect((await request(await listeningServer(await buildApp("summary-owner"))).get(`/api/projects/summary-missing-${crypto.randomUUID()}/summary`)).status).toBe(404);
  });
});


describe("manifest story readiness (emulator)", () => {
  it("keeps one understood file out of twelve pending from becoming ready, then invalidates readiness on a new session", async () => {
    const id = await seed("manifest-owner");
    const session = adminDb.doc(`projects/${id}/uploadSessions/first`);
    await session.set({ closed: false });
    for (let i = 0; i < 12; i++) await session.collection("entries").doc(`a${i}`).set({ outcome: i === 0 ? "finalized" : "pending" });
    await adminDb.doc(`projects/${id}/assets/a0`).set({ status: "understood", media: { kind: "photo" } });
    const server = await listeningServer(await buildApp("manifest-owner"));
    const summary = async () => (await request(server).get(`/api/projects/${id}/summary`)).body;
    expect(await summary()).toMatchObject({ upload: { expected: 12, settled: 1, closed: false }, ready: { story: false } });
    for (let i = 1; i < 12; i++) {
      await session.collection("entries").doc(`a${i}`).update({ outcome: "finalized" });
      await adminDb.doc(`projects/${id}/assets/a${i}`).set({ status: "understood", media: { kind: "photo" } });
    }
    await session.update({ closed: true });
    expect(await summary()).toMatchObject({ upload: { expected: 12, settled: 12, closed: true }, ready: { story: true } });
    await adminDb.doc(`projects/${id}/uploadSessions/second`).set({ closed: false });
    expect(await summary()).toMatchObject({ upload: { closed: false }, ready: { story: false } });
  });
  it("counts failed and cancelled files as settled without counting them as ingested", async () => {
    const id = await seed("partial-owner");
    const session = adminDb.doc(`projects/${id}/uploadSessions/first`);
    await session.set({ closed: true });
    for (const [name, outcome] of [["good", "finalized"], ["bad", "finalized"], ["upload-failed", "failed"], ["cancelled", "cancelled"]]) await session.collection("entries").doc(name).set({ outcome });
    await adminDb.doc(`projects/${id}/assets/good`).set({ status: "understood", media: { kind: "photo" } });
    await adminDb.doc(`projects/${id}/assets/bad`).set({ status: "failed", media: { kind: "photo" } });
    const server = await listeningServer(await buildApp("partial-owner"));
    const summary = async () => (await request(server).get(`/api/projects/${id}/summary`)).body;
    expect(await summary()).toMatchObject({ upload: { expected: 4, settled: 4, failed: 2, cancelled: 1, closed: true }, processed: { ingested: 1, understood: 1 }, ready: { story: true } });
    await adminDb.doc(`projects/${id}/assets/good`).update({ status: "failed" });
    expect(await summary()).toMatchObject({ ready: { story: false } });
  });
  it("requires an understood nonempty legacy catalog and ready processing", async () => {
    const id = await seed("legacy-owner");
    const server = await listeningServer(await buildApp("legacy-owner"));
    const summary = async () => (await request(server).get(`/api/projects/${id}/summary`)).body;
    expect(await summary()).toMatchObject({ ready: { story: false } });
    await adminDb.doc(`projects/${id}/assets/good`).set({ status: "understood", media: { kind: "photo" } });
    expect(await summary()).toMatchObject({ ready: { story: true } });
    await adminDb.doc(`projects/${id}`).update({ status: "processing" });
    expect(await summary()).toMatchObject({ ready: { story: false } });
  });
  it("does not treat a finalized entry with a missing asset as ready", async () => {
    const id = await seed("missing-owner");
    await adminDb.doc(`projects/${id}/assets/good`).set({ status: "understood", media: { kind: "photo" } });
    await adminDb.doc(`projects/${id}/uploadSessions/first`).set({ closed: true });
    await adminDb.doc(`projects/${id}/uploadSessions/first/entries/missing`).set({ outcome: "finalized" });
    const response = await request(await listeningServer(await buildApp("missing-owner"))).get(`/api/projects/${id}/summary`);
    expect(response.body).toMatchObject({ upload: { expected: 1, settled: 1, closed: true }, ready: { story: false } });
  });
});


it.each(["failed", "cancelled"])("excludes understood asset backed by %s manifest outcome", async (outcome) => {
  const id = await seed("excluded-owner");
  await adminDb.doc(`projects/${id}/uploadSessions/first`).set({ closed: true });
  await adminDb.doc(`projects/${id}/uploadSessions/first/entries/excluded`).set({ outcome });
  await adminDb.doc(`projects/${id}/assets/excluded`).set({ status: "understood", media: { kind: "photo" } });
  const server = await listeningServer(await buildApp("excluded-owner"));
  const summary = async () => (await request(server).get(`/api/projects/${id}/summary`)).body;
  expect(await summary()).toMatchObject({ upload: { expected: 1, settled: 1, closed: true }, processed: { ingested: 0, understood: 0 }, ready: { story: false } });
  await adminDb.doc(`projects/${id}/uploadSessions/first/entries/good`).set({ outcome: "finalized" });
  await adminDb.doc(`projects/${id}/assets/good`).set({ status: "understood", media: { kind: "photo" } });
  expect(await summary()).toMatchObject({ processed: { ingested: 1, understood: 1 }, ready: { story: true } });
});
