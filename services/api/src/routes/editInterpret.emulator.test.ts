import express, { type RequestHandler } from "express";
import { randomUUID } from "node:crypto";
import request from "supertest";
import { listeningServer } from "../test/listeningServer.js";
import { describe, expect, it } from "vitest";
import type { Timeline } from "@mosae/contracts";
import { adminDb } from "../firebase/admin.js";
import { DemoLimitReached } from "../gemini/errors.js";
import { beginEditInterpretation, finishEditInterpretation, abandonEditInterpretation, renewEditInterpretation, saveEditDocument } from "../directing/editStore.js";
import { editInterpretRouter } from "./editInterpret.js";

const owner = "editor-ask-emulator-owner";
const auth: RequestHandler = (_req, res, next) => { res.locals.userId = owner; next(); };
const timeline: Timeline = {
  schemaVersion: 1, projectId: "unused", mode: "memory", aspect: "9:16", fps: 30, durationSec: 6,
  chapters: [{ title: "Snow monkeys", startSec: 0 }],
  videoClips: ["monkeys", "temple"].map((id, index) => ({ id, source: { kind: "photo", shotId: `shot-${id}` }, startSec: index * 3, durationSec: 3, transitionIn: { kind: "cut", durationSec: 0 } })),
  audioClips: [], captions: [],
};

describe("edit interpretation route (Firestore emulator)", () => {
  it("uses an owned generation and the requested current edit revision", async () => {
    if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error("FIRESTORE_EMULATOR_HOST must point at the already-running emulator");
    const projectId = `ask-project-${randomUUID()}`;
    const generationId = "generation-1";
    const project = adminDb.doc(`projects/${projectId}`);
    await project.set({ id: projectId, userId: owner });
    await project.collection("generations").doc(generationId).set({ timeline: { ...timeline, projectId } });
    const generate = async (options: { contents: unknown }) => {
      expect(JSON.stringify(options.contents)).toContain("Snow monkeys");
      return { reply: "Move the monkeys earlier?", ops: [{ op: "move", clipId: "monkeys", toIndex: 1 }] };
    };
    const app = express();
    app.use(express.json());
    app.use("/api/projects", editInterpretRouter({ db: adminDb, auth, generate }));
    const response = await request(await listeningServer(app)).post(`/api/projects/${projectId}/generations/${generationId}/edits/interpret`).send({ text: "move the snow monkeys earlier", revision: 0 });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ kind: "edit", baseRevision: 0, requestId: expect.any(String), reply: "Move the monkeys earlier?", ops: [{ op: "move", clipId: "monkeys", toIndex: 1 }] });
    const stale = await request(await listeningServer(app)).post(`/api/projects/${projectId}/generations/${generationId}/edits/interpret`).send({ text: "move the snow monkeys earlier", revision: 4 });
    expect(stale.status).toBe(409);
  });
  it("persists bounded generation history, deduplicates requests and acknowledges only saved proposed ops", async () => {
    const projectId = `ask-history-${randomUUID()}`;
    const project = adminDb.doc(`projects/${projectId}`);
    await project.set({ userId: owner });
    for (const generationId of ["g1", "g2"]) await project.collection("generations").doc(generationId).set({ timeline: { ...timeline, projectId } });
    let calls = 0;
    const app = express(); app.use(express.json());
    app.use("/api/projects", editInterpretRouter({ db: adminDb, auth, generate: async () => { calls++; return { reply: "Move the photo.", ops: [{ op: "move", clipId: "monkeys", toIndex: 1 }] }; } }));
    const server = await listeningServer(app);
    const base = `/api/projects/${projectId}/generations/g1/edits`;
    const payload = { text: "move this", revision: 0, context: { scope: { kind: "clip", clipId: "monkeys" }, requestId: "request-one" } };
    const first = await request(server).post(`${base}/interpret`).send(payload);
    expect(first.status).toBe(200);
    expect((await request(server).get(`${base}/conversation`)).body.turns).toMatchObject([{ requestId: "request-one", status: "pending", revision: 0 }]);
    expect((await request(server).post(`${base}/acknowledge`).send({ requestId: "request-one", revision: 1 })).status).toBe(409);
    expect((await request(server).post(`${base}/interpret`).send(payload)).body).toEqual(first.body);
    expect(calls).toBe(1);
    expect((await request(server).post(`${base}/interpret`).send({ ...payload, text: "different request" })).status).toBe(409);
    const edits = project.collection("generations").doc("g1").collection("edits").doc("current");
    await edits.set({ revision: 1, ops: [{ op: "remove", clipId: "temple" }], updatedAt: 1 });
    expect((await request(server).post(`${base}/acknowledge`).send({ requestId: "request-one", revision: 1 })).status).toBe(409);
    await edits.delete();
    const saved = await saveEditDocument(adminDb, owner, projectId, "g1", { revision: 1, ops: first.body.ops });
    expect(saved.status).toBe("saved");
    expect((await request(server).post(`${base}/acknowledge`).send({ requestId: "request-one", revision: 1 })).status).toBe(200);
    expect((await request(server).get(`${base}/conversation`)).body.turns).toMatchObject([{ status: "applied", appliedRevision: 1 }]);
    expect((await request(server).post(`${base}/interpret`).send(payload)).body).toEqual(first.body);
    expect(calls).toBe(1);
    expect((await request(server).get(`/api/projects/${projectId}/generations/g2/edits/conversation`)).body.turns).toEqual([]);
    for (let i = 0; i < 10; i++) {
      expect((await request(server).post(`${base}/interpret`).send({ text: `move photo ${i}`, revision: 1, context: { scope: { kind: "film" }, requestId: `request-${i}` } })).status).toBe(200);
    }
    const history = (await request(server).get(`${base}/conversation`)).body.turns;
    expect(history).toHaveLength(8);
    expect(history[0].requestId).toBe("request-2");
    await project.update({ userId: "other" });
    expect((await request(server).get(`${base}/conversation`)).status).toBe(404);
    expect((await request(server).post(`${base}/acknowledge`).send({ requestId: "request-one", revision: 1 })).status).toBe(404);
  });
  it("recovers expired reservations and fences completion and cleanup from former owners", async () => {
    const projectId = `ask-lease-${randomUUID()}`;
    const project = adminDb.doc(`projects/${projectId}`);
    await project.set({ userId: owner });
    await project.collection("generations").doc("g").set({ timeline: { ...timeline, projectId } });
    const begin = beginEditInterpretation;
    const finish = finishEditInterpretation;
    const abandon = abandonEditInterpretation;
    const now = Date.now();
    const old = await begin(adminDb, owner, projectId, "g", "r", "payload", () => now);
    expect((await begin(adminDb, owner, projectId, "g", "r", "payload", () => now + 1)).status).toBe("processing");
    expect(await renewEditInterpretation(adminDb, projectId, "g", "r", old.status === "started" ? old.leaseToken : "", () => now + 90_000)).toBe(true);
    expect((await begin(adminDb, owner, projectId, "g", "r", "payload", () => now + 180_001)).status).toBe("processing");
    const recovered = await begin(adminDb, owner, projectId, "g", "r", "payload", () => now + 220_001);
    expect(recovered.status).toBe("started");
    expect(recovered.leaseToken).toEqual(expect.any(String));
    expect(recovered.leaseToken).not.toBe(old.leaseToken);
    expect((await begin(adminDb, owner, projectId, "g", "r", "different", () => now + 180_002)).status).toBe("conflict");
    const result = { kind: "edit" as const, requestId: "r", reply: "Move it", baseRevision: 0, ops: [{ op: "move" as const, clipId: "monkeys", toIndex: 1 }] };
    if (old.status !== "started" || recovered.status !== "started") throw new Error("reservation_not_acquired");
    await expect(finish(adminDb, owner, projectId, "g", "move", 0, [], result, old.leaseToken, () => now + 180_002)).rejects.toThrow("edit_interpretation_lease_lost");
    await abandon(adminDb, projectId, "g", "r", old.leaseToken);
    expect((await begin(adminDb, owner, projectId, "g", "r", "payload", () => now + 180_003)).status).toBe("processing");
    await finish(adminDb, owner, projectId, "g", "move", 0, [], result, recovered.leaseToken, () => now + 180_004);
    expect((await begin(adminDb, owner, projectId, "g", "r", "payload", () => now + 360_000)).status).toBe("complete");
    await expect(finish(adminDb, owner, projectId, "g", "old", 0, [], { ...result, reply: "wrong owner" }, old.leaseToken, () => now + 180_005)).rejects.toThrow("edit_interpretation_lease_lost");
  });

  it("deduplicates live model work and retries ordinary failures with the same request ID", async () => {
    const projectId = `ask-retry-${randomUUID()}`;
    const project = adminDb.doc(`projects/${projectId}`);
    await project.set({ userId: owner });
    await project.collection("generations").doc("g").set({ timeline: { ...timeline, projectId } });
    let entered!: () => void, release!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    const blocked = new Promise<void>(resolve => { release = resolve; });
    let calls = 0;
    const app = express(); app.use(express.json());
    app.use("/api/projects", editInterpretRouter({ db: adminDb, auth, generate: async () => {
      calls++; if (calls === 1) { entered(); await blocked; throw new DemoLimitReached(); }
      return { reply: "Move it", ops: [{ op: "move", clipId: "monkeys", toIndex: 1 }] };
    } }));
    const server = await listeningServer(app);
    const path = `/api/projects/${projectId}/generations/g/edits/interpret`;
    const payload = { text: "move this", revision: 0, context: { scope: { kind: "film" }, requestId: "retry" } };
    const first = request(server).post(path).send(payload).then(response => response);
    await started;
    expect((await request(server).post(path).send(payload)).body.error).toBe("request_in_progress");
    expect(calls).toBe(1);
    release();
    expect((await first).status).toBe(429);
    expect((await request(server).post(path).send({ ...payload, text: "different" })).body.error).toBe("request_id_conflict");
    const retried = await request(server).post(path).send(payload);
    expect(retried.status).toBe(200);
    expect(retried.body.kind).toBe("edit");
    expect(calls).toBe(2);
  });

  it("renews the active route reservation while model work is still running", async () => {
    const projectId = `ask-renew-${randomUUID()}`;
    const project = adminDb.doc(`projects/${projectId}`);
    await project.set({ userId: owner });
    await project.collection("generations").doc("g").set({ timeline: { ...timeline, projectId } });
    let entered!: () => void, release!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    const blocked = new Promise<void>(resolve => { release = resolve; });
    const renewalResults: boolean[] = [];
    const app = express(); app.use(express.json());
    app.use("/api/projects", editInterpretRouter({ db: adminDb, auth, leaseRenewIntervalMs: 500, renewLease: async (...args) => {
      const renewed = await renewEditInterpretation(...args); renewalResults.push(renewed); return renewed;
    }, generate: async () => {
      entered(); await blocked; return { reply: "Moved", ops: [{ op: "move", clipId: "monkeys", toIndex: 1 }] };
    } }));
    const server = await listeningServer(app);
    const path = `/api/projects/${projectId}/generations/g/edits/interpret`;
    const payload = { text: "move this", revision: 0, context: { scope: { kind: "film" }, requestId: "renew" } };
    const first = request(server).post(path).send(payload).then(response => response);
    await started;
    for (let attempt = 0; attempt < 30 && !renewalResults.length; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    release();
    expect(renewalResults.some(Boolean)).toBe(true);
    expect((await first).status).toBe(200);
  }, 30_000);

  it("rejects a result after the route renewal reports lost ownership", async () => {
    const projectId = `ask-lost-${randomUUID()}`;
    const project = adminDb.doc(`projects/${projectId}`);
    await project.set({ userId: owner });
    await project.collection("generations").doc("g").set({ timeline: { ...timeline, projectId } });
    let entered!: () => void, release!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    const blocked = new Promise<void>(resolve => { release = resolve; });
    const app = express(); app.use(express.json());
    app.use("/api/projects", editInterpretRouter({ db: adminDb, auth, leaseRenewIntervalMs: 5, renewLease: async () => false, generate: async () => {
      entered(); await blocked; return { reply: "Moved", ops: [{ op: "move", clipId: "monkeys", toIndex: 1 }] };
    } }));
    const server = await listeningServer(app);
    const path = `/api/projects/${projectId}/generations/g/edits/interpret`;
    const payload = { text: "move this", revision: 0, context: { scope: { kind: "film" }, requestId: "lost" } };
    const first = request(server).post(path).send(payload).then(response => response);
    await started;
    await new Promise(resolve => setTimeout(resolve, 40));
    release();
    const response = await first;
    expect(response.status).toBe(409);
    expect(response.body.error).toBe("request_lease_lost");
  }, 30_000);

});
