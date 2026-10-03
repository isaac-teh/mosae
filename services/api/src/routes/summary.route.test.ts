import express from "express";
import type { RequestHandler } from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { listeningServer } from "../test/listeningServer.js";

vi.mock("../store/understandStore.js", () => ({ getProjectFaces: vi.fn(async () => []) }));

function auth(_req: unknown, res: any, next: () => void) { res.locals.userId = "owner"; next(); }

describe("summary route asset progress", () => {
  it("includes per-asset status and kind in the existing summary response", async () => {
    const docs = [
      { id: "photo-a", data: () => ({ status: "understood", media: { kind: "photo" } }) },
      { id: "photo-b", data: () => ({ status: "ingested", media: { kind: "photo" } }) },
      { id: "clip-c", data: () => ({ status: "uploaded", media: { kind: "video" } }) },
    ];
    const projectRef = {
      get: async () => ({ exists: true, get: (field: string) => field === "userId" ? "owner" : undefined }),
      collection: (name: string) => name === "assets"
        ? { get: async () => ({ docs }) }
        : name === "uploadSessions" ? { get: async () => ({ docs: [] }) } : { limit: () => ({ get: async () => ({ empty: true }) }) },
    };
    const db = { collection: () => ({ doc: () => projectRef }) } as any;
    const app = express();
    app.use("/api/projects", (await import("./summary.js")).summaryRouter({ db, auth: auth as RequestHandler }));
    const response = await request(await listeningServer(app)).get("/api/projects/project-a/summary");
    expect(response.status).toBe(200);
    expect(response.body.upload).toEqual({ expected: 0, settled: 0, failed: 0, cancelled: 0, closed: true });
    expect(response.body.ready.story).toBe(false);
    expect(response.body.assetStatuses).toEqual([
      { assetId: "photo-a", kind: "photo", status: "understood" },
      { assetId: "photo-b", kind: "photo", status: "ingested" },
      { assetId: "clip-c", kind: "video", status: "uploaded" },
    ]);
  });
});
