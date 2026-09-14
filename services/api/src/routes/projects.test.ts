import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import type { Firestore } from "firebase-admin/firestore";

vi.mock("../store/projectStore.js", async () => {
  const actual = await vi.importActual<
    typeof import("../store/projectStore.js")
  >("../store/projectStore.js");
  return {
    ...actual,
    createProject: vi.fn(),
    openSession: vi.fn(),
    addEntries: vi.fn(),
    closeSession: vi.fn(),
    recordClientOutcome: vi.fn(),
  };
});

const store = await import("../store/projectStore.js");
const { projectsRouter } = await import("./projects.js");
const db = {} as Firestore;
const fakeAuth: express.RequestHandler = (_req, res, next) => {
  res.locals.userId = "user-1";
  next();
};
function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(
    "/api/projects",
    projectsRouter({ db, now: () => 42, auth: fakeAuth }),
  );
  return app;
}
const entry = {
  assetId: "a1",
  fileName: "a.jpg",
  contentType: "image/jpeg",
  sizeBytes: 5,
  outcome: "pending",
  generation: null,
  failureReason: null,
};

describe("projects routes", () => {
  beforeEach(() => vi.clearAllMocks());
  it("creates a project for the signed-in user", async () => {
    vi.mocked(store.createProject).mockResolvedValue({
      id: "p1",
      userId: "user-1",
      mode: "memory",
      title: null,
      status: "collecting",
      createdAt: 42,
    });
    const res = await request(buildApp())
      .post("/api/projects")
      .send({ mode: "memory" });
    expect(res.status).toBe(201);
    expect(store.createProject).toHaveBeenCalledWith(db, {
      userId: "user-1",
      mode: "memory",
      now: 42,
    });
  });
  it("rejects an invalid mode", async () => {
    const res = await request(buildApp())
      .post("/api/projects")
      .send({ mode: "album" });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "invalid_mode" });
  });
  it("opens a session and returns storage paths for each entry", async () => {
    vi.mocked(store.openSession).mockResolvedValue({
      session: {
        id: "s1",
        projectId: "p1",
        userId: "user-1",
        closed: false,
        createdAt: 42,
      },
      entries: [entry as never],
    });
    const res = await request(buildApp())
      .post("/api/projects/p1/upload-sessions")
      .send({
        entries: [
          { fileName: "a.jpg", contentType: "image/jpeg", sizeBytes: 5 },
        ],
      });
    expect(res.status).toBe(201);
    expect(res.body.entries[0].storagePath).toBe(
      "uploads/user-1/p1/s1/a1/original",
    );
  });
  it("rejects encoded slashes in project IDs before calling the store", async () => {
    const res = await request(buildApp())
      .post("/api/projects/p1%2FuploadSessions%2Fs1/upload-sessions")
      .send({
        entries: [
          { fileName: "a.jpg", contentType: "image/jpeg", sizeBytes: 5 },
        ],
      });
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "not_found" });
    expect(store.openSession).not.toHaveBeenCalled();
  });
  it("rejects encoded slashes in session IDs before calling the store", async () => {
    const res = await request(buildApp())
      .post("/api/projects/p1/upload-sessions/s1%2Fentries%2Fa1/entries")
      .send({
        entries: [
          { fileName: "a.jpg", contentType: "image/jpeg", sizeBytes: 5 },
        ],
      });
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "not_found" });
    expect(store.addEntries).not.toHaveBeenCalled();
  });
  it("maps store errors to HTTP statuses", async () => {
    vi.mocked(store.addEntries).mockRejectedValue(
      new store.StoreError("session_closed"),
    );
    const closed = await request(buildApp())
      .post("/api/projects/p1/upload-sessions/s1/entries")
      .send({
        entries: [
          { fileName: "a.jpg", contentType: "image/jpeg", sizeBytes: 5 },
        ],
      });
    expect(closed.status).toBe(409);
    vi.mocked(store.closeSession).mockRejectedValue(
      new store.StoreError("not_found"),
    );
    const missing = await request(buildApp()).post(
      "/api/projects/p1/upload-sessions/s1/close",
    );
    expect(missing.status).toBe(404);
  });
  it("validates client outcome bodies", async () => {
    const res = await request(buildApp())
      .post("/api/projects/p1/upload-sessions/s1/entries/a1/outcome")
      .send({ kind: "finalized" });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "invalid_outcome" });
    expect(store.recordClientOutcome).not.toHaveBeenCalled();
  });
});
