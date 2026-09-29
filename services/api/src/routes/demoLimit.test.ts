import { describe, expect, it } from "vitest";
import express, { type RequestHandler } from "express";
import request from "supertest";
import type { Firestore } from "firebase-admin/firestore";
import { listeningServer } from "../test/listeningServer.js";
import { chatInterpretRouter } from "./chatInterpret.js";
import { DemoLimitReached } from "../gemini/errors.js";

describe("demo typed request limit", () => {
  it("returns a friendly limit response from chat interpretation", async () => {
    const db = { collection: () => ({ doc: () => ({ get: async () => ({ exists: true, get: () => "owner", data: () => ({ userId: "owner" }) }) }) }) } as unknown as Firestore;
    const auth: RequestHandler = (_req, res, next) => { res.locals.userId = "owner"; next(); };
    const app = express(); app.use(express.json());
    app.use("/api/projects", chatInterpretRouter({ db, auth, generate: async () => { throw new DemoLimitReached(); }, searchShots: async () => [] }));
    const response = await request(await listeningServer(app)).post("/api/projects/demo-1/chat/interpret").send({ step: "occasion", text: "make it longer" });
    expect(response.status).toBe(429);
    expect(response.body).toEqual({ error: "demo_limit_reached", message: "Demo limit reached — try the options" });
  });
});
