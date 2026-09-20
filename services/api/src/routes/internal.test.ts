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
function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(
    "/",
    internalRouter({
      db,
      queue: new InMemoryTaskQueue(),
      now: () => 9,
      auth: pass,
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
  it("acknowledges well-formed ingest tasks and rejects malformed ones", async () => {
    const ok = await request(buildApp())
      .post("/tasks/ingest")
      .send({
        projectId: "p",
        subjectKind: "asset",
        subjectId: "a",
        generation: "1",
        workKey: "p:asset:a:1:ingest:1",
      });
    expect(ok.status).toBe(204);
    const bad = await request(buildApp())
      .post("/tasks/ingest")
      .send({ projectId: "p", subjectKind: "asset", generation: "1", workKey: "p:asset:a:1:ingest:1" });
    expect(bad.status).toBe(400);
  });
});
