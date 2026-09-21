import { describe, it, expect, vi } from "vitest";
import express from "express";
import request from "supertest";
import type { Firestore } from "firebase-admin/firestore";

vi.mock("../outbox/dispatcher.js", () => ({
  dispatchDue: vi.fn().mockResolvedValue({ delivered: 3, failed: 1 }),
}));
const { dispatchDue } = await import("../outbox/dispatcher.js");
const { internalRouter } = await import("./internal.js");
const { InMemoryTaskQueue } = await import("../queue/taskQueue.js");
const db = {} as Firestore;
const pass: express.RequestHandler = (_req, _res, next) => next();
function buildApp({
  ingest = vi.fn().mockResolvedValue("ingested"),
}: {
  ingest?: (task: { projectId: string; assetId: string; generation: string }) => Promise<unknown>;
} = {}) {
  const app = express();
  app.use(express.json());
  app.use(
    "/",
    internalRouter({
      db,
      queue: new InMemoryTaskQueue(),
      now: () => 9,
      auth: pass,
      ingest,
    }),
  );
  return app;
}
describe("internal routes", () => {
  it("runs the outbox dispatcher", async () => {
    const res = await request(buildApp()).post("/internal/dispatch-outbox");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ delivered: 3, failed: 1 });
    expect(dispatchDue).toHaveBeenCalledWith(
      db,
      expect.any(InMemoryTaskQueue),
      9,
    );
  });
  it("runs ingest for a well-formed asset task and acknowledges it", async () => {
    const ingest = vi.fn().mockResolvedValue("ingested");
    const res = await request(buildApp({ ingest })).post("/tasks/ingest").send({ projectId: "p1", subjectKind: "asset", subjectId: "a1", generation: "7", workKey: "k" });
    expect(res.status).toBe(204);
    expect(ingest).toHaveBeenCalledWith({ projectId: "p1", assetId: "a1", generation: "7" });
  });

  it("acknowledges a skipped task so the queue does not retry it", async () => {
    const ingest = vi.fn().mockResolvedValue("skipped");
    const res = await request(buildApp({ ingest })).post("/tasks/ingest").send({ projectId: "p1", subjectKind: "asset", subjectId: "a1", generation: "7", workKey: "k" });
    expect(res.status).toBe(204);
  });

  it("rejects a malformed task and a non-asset subject without running ingest", async () => {
    const ingest = vi.fn();
    const app = buildApp({ ingest });
    expect((await request(app).post("/tasks/ingest").send({ projectId: "p1", subjectKind: "asset", generation: "7", workKey: "k" })).status).toBe(400);
    expect((await request(app).post("/tasks/ingest").send({ projectId: "p1", subjectKind: "job", subjectId: "j1", generation: "7", workKey: "k" })).status).toBe(400);
    expect(ingest).not.toHaveBeenCalled();
  });

  it("answers 500 when ingest throws, so Cloud Tasks retries with backoff", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const ingest = vi.fn().mockRejectedValue(new Error("network reset"));
    const res = await request(buildApp({ ingest })).post("/tasks/ingest").send({ projectId: "p1", subjectKind: "asset", subjectId: "a1", generation: "7", workKey: "k" });
    expect(res.status).toBe(500);
    error.mockRestore();
  });
});
