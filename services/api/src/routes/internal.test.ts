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
  db: customDb,
  ingest = vi.fn().mockResolvedValue("ingested"),
  understand = vi.fn().mockResolvedValue("understood"),
  cluster = vi.fn().mockResolvedValue({ status: "ready" }),
  plan = vi.fn().mockResolvedValue("published"),
  compose = vi.fn().mockResolvedValue("composed"),
  render = vi.fn().mockResolvedValue("rendered"),
}: {
  db?: Firestore;
  ingest?: (task: { projectId: string; assetId: string; generation: string; attempt?: number }) => Promise<unknown>;
  understand?: (task: { projectId: string; assetId: string; generation: string; attempt?: number }) => Promise<unknown>;
  cluster?: (projectId: string) => Promise<unknown>;
  plan?: (task: { projectId: string; jobId: string; generation: string }) => Promise<unknown>;
  compose?: (task: { projectId: string; generationId: string; giveUp?: string }) => Promise<unknown>;
  render?: (task: { projectId: string; generationId: string; giveUp?: string }) => Promise<unknown>;
} = {}) {
  const app = express();
  app.use(express.json());
  app.use(
    "/",
    internalRouter({
      db: customDb ?? (db as Firestore),
      queue: new InMemoryTaskQueue(),
      now: () => 9,
      auth: pass,
      ingest,
      understand,
      cluster,
      plan,
      compose,
      render,
    }),
  );
  return app;
}
describe("internal routes", () => {
  it("delivers job identity to planning and retries deferred work", async () => {
    const plan = vi.fn().mockResolvedValue("published");
    const body = { projectId: "p1", subjectKind: "job", subjectId: "j1", generation: "2", workKey: "k" };
    expect((await request(buildApp({ plan })).post("/tasks/plan").send(body)).status).toBe(204);
    expect(plan).toHaveBeenCalledWith({ projectId: "p1", jobId: "j1", generation: "2" });
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    plan.mockRejectedValue(new Error("waiting_for_ready"));
    expect((await request(buildApp({ plan })).post("/tasks/plan").send(body)).status).toBe(500);
    error.mockRestore();
  });

  it.each([
    { subjectKind: "asset" }, { subjectId: "" }, { projectId: "../p" }, { generation: "" }, { workKey: null },
  ])("rejects invalid plan identity %j", async (invalid) => {
    const plan = vi.fn();
    const body = { projectId: "p1", subjectKind: "job", subjectId: "j1", generation: "1", workKey: "k", ...invalid };
    expect((await request(buildApp({ plan })).post("/tasks/plan").send(body)).status).toBe(400);
    expect(plan).not.toHaveBeenCalled();
  });
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

  // Task 9 + 13: /tasks/compose is a thin route over the composer.
  const composeTask = { projectId: "p1", subjectKind: "generation", subjectId: "g1", generation: "7", workKey: "k" };

  it("rejects a malformed compose task with non-generation subjectKind", async () => {
    const res = await request(buildApp()).post("/tasks/compose").send({ ...composeTask, subjectKind: "asset" });
    expect(res.status).toBe(400);
  });

  it("rejects a compose task with missing fields", async () => {
    const res = await request(buildApp()).post("/tasks/compose").send({ projectId: "p1" });
    expect(res.status).toBe(400);
  });

  it("hands the generation to the composer and acknowledges delivery", async () => {
    const compose = vi.fn().mockResolvedValue("composed");
    const res = await request(buildApp({ compose })).post("/tasks/compose").send(composeTask);
    expect(res.status).toBe(204);
    expect(compose).toHaveBeenCalledWith({ projectId: "p1", generationId: "g1" });
  });

  it("acknowledges a failed composition instead of asking for redelivery", async () => {
    // The generation carries its own reasons. Answering 500 would make Cloud
    // Tasks retry work that is already settled.
    const compose = vi.fn().mockResolvedValue("failed");
    const res = await request(buildApp({ compose })).post("/tasks/compose").send(composeTask);
    expect(res.status).toBe(204);
  });

  it("returns 500 when the composer throws, so the task is redelivered", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const compose = vi.fn().mockRejectedValue(new Error("firestore unavailable"));
    const res = await request(buildApp({ compose })).post("/tasks/compose").send(composeTask);
    expect(res.status).toBe(500);
    error.mockRestore();
  });

  it("returns 500 when no composer is configured", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const bare = express();
    bare.use(express.json());
    bare.use("/", internalRouter({
      db, queue: new InMemoryTaskQueue(), now: () => 9, auth: pass,
      ingest: vi.fn(), understand: vi.fn(), cluster: vi.fn(),
    }));
    const res = await request(bare).post("/tasks/compose").send(composeTask);
    expect(res.status).toBe(500);
    error.mockRestore();
  });

  it("settles the generation as failed once retries are exhausted", async () => {
    const compose = vi.fn().mockResolvedValue("failed");
    const res = await request(buildApp({ compose })).post("/tasks/compose").set("x-cloudtasks-taskretrycount", "3").send(composeTask);
    expect(res.status).toBe(204);
    expect(compose).toHaveBeenCalledWith({ projectId: "p1", generationId: "g1", giveUp: "exceeded 3 compose attempts" });
  });

  // C1: /tasks/render is the path STAGE_PATHS.render promises. Without it a
  // Save moved the generation to `rendering`, the outbox retried into a 404,
  // and the film could never be rendered or retried again.
  const renderTask = { projectId: "p1", subjectKind: "generation", subjectId: "g1", generation: "7", workKey: "k" };

  it("hands the generation to the render leg and acknowledges delivery", async () => {
    const render = vi.fn().mockResolvedValue("rendered");
    const res = await request(buildApp({ render })).post("/tasks/render").send(renderTask);
    expect(res.status).toBe(204);
    expect(render).toHaveBeenCalledWith({ projectId: "p1", generationId: "g1" });
  });

  it("rejects a malformed render task with non-generation subjectKind", async () => {
    const res = await request(buildApp()).post("/tasks/render").send({ ...renderTask, subjectKind: "asset" });
    expect(res.status).toBe(400);
  });

  it("rejects a render task with missing fields", async () => {
    const res = await request(buildApp()).post("/tasks/render").send({ projectId: "p1" });
    expect(res.status).toBe(400);
  });

  it("answers 204 when the render gave the film back, so Cloud Tasks does not repeat it", async () => {
    const render = vi.fn().mockResolvedValue("failed");
    const res = await request(buildApp({ render })).post("/tasks/render").send(renderTask);
    expect(res.status).toBe(204);
  });

  it("returns 500 when the render leg throws, so the task is redelivered", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const render = vi.fn().mockRejectedValue(new Error("firestore unavailable"));
    const res = await request(buildApp({ render })).post("/tasks/render").send(renderTask);
    expect(res.status).toBe(500);
    error.mockRestore();
  });

  it("gives the film back once render retries are exhausted", async () => {
    const render = vi.fn().mockResolvedValue("failed");
    const res = await request(buildApp({ render })).post("/tasks/render").set("x-cloudtasks-taskretrycount", "3").send(renderTask);
    expect(res.status).toBe(204);
    expect(render).toHaveBeenCalledWith({ projectId: "p1", generationId: "g1", giveUp: "exceeded 3 render attempts" });
  });
});
