import express, { type RequestHandler } from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { adminDb } from "../firebase/admin.js";
import { editRenderRouter } from "./editRender.js";

const owner = "edit-render-owner";
const auth = (userId: string): RequestHandler => (_req, res, next) => { res.locals.userId = userId; next(); };
const timeline = {
  schemaVersion: 1, projectId: "fixture", mode: "memory", aspect: "9:16", fps: 30,
  durationSec: 3, chapters: [{ title: "Day", startSec: 0 }],
  videoClips: [{ id: "clip-1", source: { kind: "photo", shotId: "shot-1" }, startSec: 0, durationSec: 3, transitionIn: { kind: "cut", durationSec: 0 } }],
  audioClips: [], captions: [],
};

async function seed() {
  const projectId = `edit-render-${crypto.randomUUID()}`;
  const project = adminDb.collection("projects").doc(projectId);
  const generation = project.collection("generations").doc("g1");
  const ops = [{ op: "setPhotoDuration", clipId: "clip-1", sec: 5 }];
  await project.set({ id: projectId, userId: owner });
  await generation.set({ id: "g1", timeline: { ...timeline, projectId }, status: "saved" });
  const current = generation.collection("edits").doc("current");
  await current.set({ revision: 3, ops, updatedAt: 1 });
  await current.collection("revisions").doc("3").set({ revision: 3, ops, updatedAt: 1 });
  return { projectId, current, path: `/api/projects/${projectId}/generations/g1/edits/3/render` };
}

function app(userId: string, dispatch = vi.fn(async () => undefined)) {
  const server = express();
  server.use(express.json());
  server.use("/api/projects", editRenderRouter({ db: adminDb, auth: auth(userId), dispatch, downloadUrl: async (path) => `https://storage.test/${path}` }));
  return { server, dispatch };
}

describe("edit render request (Firestore emulator)", () => {
  it("queues a revision render and exposes its status", async () => {
    const { projectId, current, path } = await seed();
    const { server, dispatch } = app(owner);
    const response = await request(server).post(path);
    expect(response.status).toBe(202);
    expect(response.body.renderId).toBeTruthy();
    expect((await current.get()).data()).toMatchObject({ renderRevision: 3, status: "rendering" });
    expect((await current.collection("revisions").doc("3").get()).data()).toMatchObject({ status: "rendering" });
    const outbox = await adminDb.collection("projects").doc(projectId).collection("taskOutbox").get();
    expect(outbox.docs.map((doc) => doc.data())).toContainEqual(expect.objectContaining({ stage: "render", generation: "edit-3" }));
    expect(dispatch).toHaveBeenCalledOnce();
    expect((await request(server).get(path)).body).toMatchObject({ revision: 3, status: "rendering" });
  });

  it("hides the render from a non-owner", async () => {
    const { path } = await seed();
    expect((await request(app("other").server).post(path)).status).toBe(404);
    expect((await request(app("other").server).get(path)).status).toBe(404);
  });

  it("returns a fresh download URL when a revision is ready", async () => {
    const { current, path } = await seed();
    await current.collection("revisions").doc("3").update({ status: "ready", outputPath: "renders/owner/edit-3.mp4" });
    const response = await request(app(owner).server).get(path);
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ revision: 3, status: "ready", downloadUrl: "https://storage.test/renders/owner/edit-3.mp4" });
  });
});
