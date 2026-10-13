import express from "express";
import type { RequestHandler } from "express";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { getStorage } from "firebase-admin/storage";
import { adminDb, getAdminApp } from "../firebase/admin.js";
import { listeningServer } from "../test/listeningServer.js";
import { projectsRouter } from "./projects.js";

const bucket = getStorage(getAdminApp()).bucket(process.env.FIREBASE_STORAGE_BUCKET ?? "demo-mosae.appspot.com");
const projectIds: string[] = [];
const objectPaths: string[] = [];
function auth(userId: string): RequestHandler { return (_req, res, next) => { res.locals.userId = userId; next(); }; }
function app(userId: string) {
  const server = express(); server.use(express.json());
  server.use("/api/projects", projectsRouter({ db: adminDb, auth: auth(userId), storageBucket: bucket }));
  return server;
}
async function seed(userId: string) {
  const projectId = `delete-${crypto.randomUUID()}`;
  projectIds.push(projectId);
  const project = adminDb.doc(`projects/${projectId}`);
  await project.set({ id: projectId, userId, status: "ready" });
  await project.collection("assets").doc("asset").set({ projectId, userId });
  await project.collection("shots").doc("shot").set({ projectId, assetId: "asset" });
  await project.collection("uploadSessions").doc("session").collection("entries").doc("entry").set({ projectId });
  await project.collection("storyIntents").doc("intent").set({ projectId });
  await project.collection("storyProposals").doc("proposal").collection("edits").doc("edit").set({ projectId });
  await project.collection("generations").doc("generation").collection("edits").doc("current").set({ projectId });
  const paths = [
    `uploads/${userId}/${projectId}/session/asset/original`,
    `proxies/${userId}/${projectId}/asset/1/thumb.jpg`,
    `proxies/${userId}/${projectId}/asset/1/render.jpg`,
    `renders/${userId}/${projectId}/generation.mp4`,
    `renders/${userId}/${projectId}/generation-edit-2.mp4`,
  ];
  objectPaths.push(...paths);
  await Promise.all(paths.map((path) => bucket.file(path).save(Buffer.from("film"))));
  return projectId;
}
afterEach(async () => {
  await Promise.all(projectIds.splice(0).map((id) => adminDb.recursiveDelete(adminDb.doc(`projects/${id}`))));
  await Promise.all(objectPaths.splice(0).map((path) => bucket.file(path).delete({ ignoreNotFound: true })));
});

describe("DELETE /api/projects/:projectId (emulator)", () => {
  it("removes project descendants and all project-scoped storage prefixes; repeated delete succeeds", async () => {
    const projectId = await seed("delete-owner");
    const siblingPath = `uploads/delete-owner/another-project/${crypto.randomUUID()}`;
    await bucket.file(siblingPath).save(Buffer.from("keep")); objectPaths.push(siblingPath);
    const server = await listeningServer(app("delete-owner"));
    expect((await request(server).delete(`/api/projects/${projectId}`)).status).toBe(204);
    expect((await request(server).delete(`/api/projects/${projectId}`)).status).toBe(204);
    expect((await adminDb.doc(`projects/${projectId}`).get()).exists).toBe(false);
    for (const path of [
      `projects/${projectId}/assets/asset`, `projects/${projectId}/shots/shot`,
      `projects/${projectId}/uploadSessions/session/entries/entry`, `projects/${projectId}/storyIntents/intent`,
      `projects/${projectId}/storyProposals/proposal/edits/edit`, `projects/${projectId}/generations/generation/edits/current`,
    ]) expect((await adminDb.doc(path).get()).exists, path).toBe(false);
    for (const root of ["uploads", "proxies", "renders"]) {
      const [files] = await bucket.getFiles({ prefix: `${root}/delete-owner/${projectId}/` });
      expect(files).toHaveLength(0);
    }
    expect((await bucket.file(siblingPath).exists())[0]).toBe(true);
  });

  it("rejects a non-owner without changing Firestore or storage", async () => {
    const projectId = await seed("delete-owner");
    const response = await request(await listeningServer(app("delete-other"))).delete(`/api/projects/${projectId}`);
    expect(response.status).toBe(404);
    expect((await adminDb.doc(`projects/${projectId}`).get()).exists).toBe(true);
    expect((await bucket.getFiles({ prefix: `uploads/delete-owner/${projectId}/` }))[0]).toHaveLength(1);
  });
});
