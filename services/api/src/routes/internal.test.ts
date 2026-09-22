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
  understand = vi.fn().mockResolvedValue("understood"),
  cluster = vi.fn().mockResolvedValue({ status: "ready" }),
}: {
  ingest?: (task: { projectId: string; assetId: string; generation: string; attempt?: number }) => Promise<unknown>;
  understand?: (task: { projectId: string; assetId: string; generation: string; attempt?: number }) => Promise<unknown>;
  cluster?: (projectId: string) => Promise<unknown>;
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
      understand,
      cluster,
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
    expect(ingest).toHaveBeenCalledWith({ projectId: "p1", assetId: "a1", generation: "7", attempt: 0 });
  });

  it("runs understand for a well-formed asset task and acknowledges it", async () => {
    const understand = vi.fn().mockResolvedValue("understood");
    const res = await request(buildApp({ understand })).post("/tasks/understand").send({ projectId: "p1", subjectKind: "asset", subjectId: "a1", generation: "7", workKey: "k" });
    expect(res.status).toBe(204);
    expect(understand).toHaveBeenCalledWith({ projectId: "p1", assetId: "a1", generation: "7", attempt: 0 });
  });

  it("rejects malformed understand tasks without invoking the worker", async () => {
    const understand = vi.fn();
    const res = await request(buildApp({ understand })).post("/tasks/understand").send({ projectId: "p1", subjectKind: "project", subjectId: "p1", generation: "7", workKey: "k" });
    expect(res.status).toBe(400);
    expect(understand).not.toHaveBeenCalled();
  });

  it("returns 500 from understand so Cloud Tasks retries transient failures", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await request(buildApp({ understand: vi.fn().mockRejectedValue(new Error("network reset")) })).post("/tasks/understand").send({ projectId: "p1", subjectKind: "asset", subjectId: "a1", generation: "7", workKey: "k" });
    expect(res.status).toBe(500);
    error.mockRestore();
  });

  it.each([
    ["3", 3],
    [" 4 ", 4],
    ["5junk", 0],
    ["-1", 0],
    ["1.5", 0],
    ["", 0],
    [undefined, 0],
  ])("parses Cloud Tasks retry count %j as %i", async (header, attempt) => {
    const ingest = vi.fn().mockResolvedValue("ingested");
    let requestBuilder = request(buildApp({ ingest })).post("/tasks/ingest");
    if (header !== undefined) requestBuilder = requestBuilder.set("x-cloudtasks-taskretrycount", header);
    await requestBuilder.send({ projectId: "p1", subjectKind: "asset", subjectId: "a1", generation: "7", workKey: "k" });
    expect(ingest).toHaveBeenCalledWith({ projectId: "p1", assetId: "a1", generation: "7", attempt });
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

  it("runs the project pass for a well-formed project task", async () => {
    const cluster = vi.fn().mockResolvedValue({ status: "ready" });
    const res = await request(buildApp({ cluster })).post("/tasks/cluster").send({ projectId: "p1", subjectKind: "project", subjectId: "p1", generation: "3", workKey: "k" });
    expect(res.status).toBe(204);
    expect(cluster).toHaveBeenCalledWith("p1");
  });

  it("rejects a malformed cluster task and a non-project subject", async () => {
    const cluster = vi.fn();
    const app = buildApp({ cluster });
    expect((await request(app).post("/tasks/cluster").send({ projectId: "p1", subjectKind: "project", generation: "3", workKey: "k" })).status).toBe(400);
    expect((await request(app).post("/tasks/cluster").send({ projectId: "p1", subjectKind: "asset", subjectId: "a1", generation: "3", workKey: "k" })).status).toBe(400);
    expect(cluster).not.toHaveBeenCalled();
  });

  it("answers 500 when the pass throws so the queue retries", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const cluster = vi.fn().mockRejectedValue(new Error("firestore unavailable"));
    const res = await request(buildApp({ cluster })).post("/tasks/cluster").send({ projectId: "p1", subjectKind: "project", subjectId: "p1", generation: "3", workKey: "k" });
    expect(res.status).toBe(500);
    error.mockRestore();
  });
});
