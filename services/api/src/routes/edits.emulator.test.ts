import express, { type RequestHandler } from "express";
import request from "supertest";
import { listeningServer } from "../test/listeningServer.js";
import { describe, expect, it } from "vitest";
import { adminDb } from "../firebase/admin.js";
import { editsRouter } from "./edits.js";

const owner = "edit-owner";
const auth = (userId: string): RequestHandler => (_req, res, next) => { res.locals.userId = userId; next(); };
const timeline = {
  schemaVersion: 1, projectId: "fixture", mode: "memory", aspect: "9:16", fps: 30,
  durationSec: 3, chapters: [{ title: "Day", startSec: 0 }],
  videoClips: [{ id: "clip-1", source: { kind: "photo", shotId: "shot-1" }, startSec: 0, durationSec: 3, transitionIn: { kind: "cut", durationSec: 0 } }],
  audioClips: [], captions: [],
};
const firstOps = [{ op: "setPhotoDuration", clipId: "clip-1", sec: 4 }];

function app(userId: string) {
  const server = express();
  server.use(express.json());
  server.use("/api/projects", editsRouter({ db: adminDb, auth: auth(userId) }));
  return server;
}

async function seed() {
  const projectId = `edit-emulator-${crypto.randomUUID()}`;
  const generationId = "generation-1";
  const project = adminDb.collection("projects").doc(projectId);
  await project.set({ id: projectId, userId: owner });
  await project.collection("generations").doc(generationId).set({ id: generationId, timeline: { ...timeline, projectId } });
  return { projectId, generationId, path: `/api/projects/${projectId}/generations/${generationId}/edits` };
}

describe("edit revisions (Firestore emulator)", () => {
  it("saves revision one and keeps each accepted revision in history", async () => {
    const { projectId, generationId, path } = await seed();
    expect((await request(await listeningServer(app(owner))).get(path)).body).toEqual({ revision: 0, ops: [], updatedAt: null });

    const first = await request(await listeningServer(app(owner))).put(path).send({ revision: 1, ops: firstOps });
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ revision: 1, ops: firstOps });
    expect(typeof first.body.updatedAt).toBe("number");

    const secondOps = [{ op: "setPhotoDuration", clipId: "clip-1", sec: 5 }];
    const second = await request(await listeningServer(app(owner))).put(path).send({ revision: 2, ops: secondOps });
    expect(second.status).toBe(200);
    expect((await request(await listeningServer(app(owner))).get(path)).body).toMatchObject({ revision: 2, ops: secondOps });

    const edit = adminDb.collection("projects").doc(projectId).collection("generations").doc(generationId).collection("edits").doc("current");
    expect((await edit.collection("revisions").doc("1").get()).data()).toMatchObject({ revision: 1, ops: firstOps });
    expect((await edit.collection("revisions").doc("2").get()).data()).toMatchObject({ revision: 2, ops: secondOps });
  });

  it("returns 409 with current edits for a stale revision", async () => {
    const { path } = await seed();
    await request(await listeningServer(app(owner))).put(path).send({ revision: 1, ops: firstOps });
    const stale = await request(await listeningServer(app(owner))).put(path).send({ revision: 1, ops: [] });
    expect(stale.status).toBe(409);
    expect(stale.body).toMatchObject({ error: "stale_revision", current: { revision: 1, ops: firstOps } });
  });

  it("returns 422 with the failing operation index and stores nothing", async () => {
    const { path } = await seed();
    const invalid = await request(await listeningServer(app(owner))).put(path).send({ revision: 1, ops: [
      firstOps[0], { op: "remove", clipId: "clip-1" },
    ] });
    expect(invalid.status).toBe(422);
    expect(invalid.body).toMatchObject({ opIndex: 1 });
    expect((await request(await listeningServer(app(owner))).get(path)).body).toMatchObject({ revision: 0, ops: [] });
  });

  it("returns 404 to a non-owner for reads and writes", async () => {
    const { path } = await seed();
    expect((await request(await listeningServer(app("someone-else"))).get(path)).status).toBe(404);
    expect((await request(await listeningServer(app("someone-else"))).put(path).send({ revision: 1, ops: [] })).status).toBe(404);
  });
});
