import express from "express";
import type { RequestHandler } from "express";
import request from "supertest";
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
    const res = await request(await buildApp("summary-owner")).get(`/api/projects/${id}/summary`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ total: 1, photos: 1, days: 1, places: ["Tokyo"], country: "Japan", processed: { ingested: 1, understood: 1, faces: 1 }, ready: { summary: true, faces: true, plan: false } });
  });
  it("returns 404 to another user", async () => {
    const id = await seed("summary-owner");
    expect((await request(await buildApp("summary-other")).get(`/api/projects/${id}/summary`)).status).toBe(404);
  });
  it("returns 404 for an unknown project", async () => {
    expect((await request(await buildApp("summary-owner")).get(`/api/projects/summary-missing-${crypto.randomUUID()}/summary`)).status).toBe(404);
  });
});
