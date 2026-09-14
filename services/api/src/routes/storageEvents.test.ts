import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import type { Firestore } from "firebase-admin/firestore";

vi.mock("../store/finalizeStore.js", () => ({ recordFinalize: vi.fn() }));
const { recordFinalize } = await import("../store/finalizeStore.js");
const { storageEventsRouter } = await import("./storageEvents.js");
const db = {} as Firestore;
const pass: express.RequestHandler = (_req, _res, next) => next();
const onAccepted = vi.fn().mockResolvedValue(undefined);
function buildApp() { const app = express(); app.use(express.json()); app.use("/events", storageEventsRouter({ db, bucket: "b1", now: () => 7, auth: pass, onAccepted })); return app; }
const payload = { bucket: "b1", name: "uploads/u/p/s/a/original", generation: "123", size: "10", contentType: "image/jpeg" };
describe("POST /events/storage-finalize", () => {
  beforeEach(() => vi.clearAllMocks());
  it("records the finalize event and triggers dispatch when accepted", async () => {
    vi.mocked(recordFinalize).mockResolvedValue({ kind: "accepted", assetId: "a", taskId: "t" }); const res = await request(buildApp()).post("/events/storage-finalize").send(payload); expect(res.status).toBe(204);
    expect(recordFinalize).toHaveBeenCalledWith(db, "b1", { bucket: "b1", objectName: "uploads/u/p/s/a/original", generation: "123", sizeBytes: 10, contentType: "image/jpeg", now: 7 }); expect(onAccepted).toHaveBeenCalledOnce();
  });
  it("acknowledges non-retryable outcomes without dispatching", async () => { vi.mocked(recordFinalize).mockResolvedValue({ kind: "ignored_path" }); const res = await request(buildApp()).post("/events/storage-finalize").send(payload); expect(res.status).toBe(204); expect(onAccepted).not.toHaveBeenCalled(); });
  it("acknowledges malformed payloads without touching Firestore", async () => { const res = await request(buildApp()).post("/events/storage-finalize").send({ bucket: "b1" }); expect(res.status).toBe(204); expect(recordFinalize).not.toHaveBeenCalled(); });
  it("returns 500 on transaction errors so Eventarc retries", async () => { vi.mocked(recordFinalize).mockRejectedValue(new Error("aborted")); const res = await request(buildApp()).post("/events/storage-finalize").send(payload); expect(res.status).toBe(500); });
});
