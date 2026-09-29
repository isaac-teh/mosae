import express, { type RequestHandler } from "express";
import { randomUUID } from "node:crypto";
import request from "supertest";
import { listeningServer } from "../test/listeningServer.js";
import { describe, expect, it } from "vitest";
import type { Timeline } from "@mosae/contracts";
import { adminDb } from "../firebase/admin.js";
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
    expect(response.body).toEqual({ reply: "Move the monkeys earlier?", ops: [{ op: "move", clipId: "monkeys", toIndex: 1 }] });
    const stale = await request(await listeningServer(app)).post(`/api/projects/${projectId}/generations/${generationId}/edits/interpret`).send({ text: "move the snow monkeys earlier", revision: 4 });
    expect(stale.status).toBe(409);
  });
});
