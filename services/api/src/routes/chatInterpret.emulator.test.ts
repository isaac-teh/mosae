import express, { type RequestHandler } from "express";
import request from "supertest";
import { listeningServer } from "../test/listeningServer.js";
import { describe, expect, it, vi } from "vitest";
import { adminDb } from "../firebase/admin.js";
import type { GenerateOptions } from "../gemini/client.js";

const auth = (userId: string): RequestHandler => (_req, res, next) => { res.locals.userId = userId; next(); };
const generate = vi.fn(async (_options: GenerateOptions<unknown>, _projectId?: string) => ({ change: { kind: "direction", pace: "lively" }, reply: "I understood: more upbeat." }));
const searchShots = vi.fn(async () => [] as string[]);
async function app(userId: string) {
  const server = express(); server.use(express.json());
  server.use("/api/projects", (await import("./chatInterpret.js")).chatInterpretRouter({ db: adminDb, auth: auth(userId), generate, searchShots }));
  return server;
}
async function project(userId: string) {
  const id = `chat-interpret-${crypto.randomUUID()}`;
  await adminDb.doc(`projects/${id}`).set({ id, userId, status: "ready" });
  return id;
}

describe("chat interpret route (Firestore emulator)", () => {
  it("rejects empty text and unknown steps", async () => {
    const id = await project("chat-owner"); const server = await app("chat-owner");
    expect((await request(await listeningServer(server)).post(`/api/projects/${id}/chat/interpret`).send({ step: "occasion", text: " " })).status).toBe(400);
    expect((await request(await listeningServer(server)).post(`/api/projects/${id}/chat/interpret`).send({ step: "unknown", text: "hello" })).status).toBe(400);
  });
  it("returns 404 for a non-owner", async () => {
    const id = await project("chat-owner");
    expect((await request(await listeningServer(await app("chat-other"))).post(`/api/projects/${id}/chat/interpret`).send({ step: "direction", text: "more upbeat" })).status).toBe(404);
  });
  it("returns the interpreted result to the owner", async () => {
    const id = await project("chat-owner");
    const response = await request(await listeningServer(await app("chat-owner"))).post(`/api/projects/${id}/chat/interpret`).send({ step: "direction", text: "more upbeat" });
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ reply: "I understood: more upbeat.", change: { kind: "direction", pace: "lively" } });
  });
});
