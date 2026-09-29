import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { editRenderRouter } from "./editRender.js";

function snapshot(fields: Record<string, unknown>, exists = true) {
  return { exists, get: (key: string) => fields[key], data: () => fields };
}

function app() {
  const revision = snapshot({ revision: 3, status: "rendering", renderProgress: 0.42 });
  const project = {
    get: async () => snapshot({ userId: "owner" }),
    collection: (name: string) => name === "generations" ? {
      doc: () => ({
        get: async () => snapshot({}),
        collection: () => ({
          doc: () => ({
            collection: () => ({ doc: () => ({ get: async () => revision }) }),
          }),
        }),
      }),
    } : undefined,
  };
  const db = { collection: () => ({ doc: () => project }) } as any;
  const auth = (req: any, res: any, next: any) => { res.locals.userId = "owner"; next(); };
  const server = express();
  server.use("/api/projects", editRenderRouter({ db, auth, downloadUrl: vi.fn(async () => "https://film.test/render.mp4") }));
  return server;
}

describe("edit render status", () => {
  it("returns revision renderProgress while the MP4 is rendering", async () => {
    const response = await request(app()).get("/api/projects/project-1/generations/generation-1/edits/3/render");
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ status: "rendering", renderProgress: 0.42 });
  });
});
