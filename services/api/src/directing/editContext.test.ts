import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import type { Firestore } from "firebase-admin/firestore";
import type { Timeline } from "@mosae/contracts";
import { validateEditContext } from "./editContext.js";
import { editInterpretRouter } from "../routes/editInterpret.js";
import { listeningServer } from "../test/listeningServer.js";

const timeline: Timeline = {
  schemaVersion: 1, projectId: "p1", mode: "memory", aspect: "9:16", fps: 30, durationSec: 6,
  chapters: [], audioClips: [], captions: [],
  videoClips: ["a", "b"].map((id, i) => ({ id, source: { kind: "photo", shotId: id }, startSec: i * 3, durationSec: 3, transitionIn: { kind: "cut", durationSec: 0 } })),
};
function setup(owner = "u1", edits = { revision: 2, ops: [{ op: "remove", clipId: "b" }] }) {
  const data: Record<string, unknown> = { "projects/p1": { userId: owner }, "projects/p1/generations/g1": { timeline }, "projects/p1/generations/g1/edits/current": edits };
  const ref = (path: string): unknown => ({
    doc: (id: string) => ref(`${path}/${id}`), collection: (id: string) => ref(`${path}/${id}`),
    get: async () => ({ exists: path in data, data: () => data[path], get: (key: string) => (data[path] as Record<string, unknown>)?.[key] }),
  });
  const db = { doc: ref, collection: ref } as unknown as Firestore;
  const generate = vi.fn(async () => ({ reply: "Hold longer", ops: [{ op: "setPhotoDuration", clipId: "a", sec: 4 }] }));
  const app = express(); app.use(express.json());
  app.use("/api/projects", editInterpretRouter({ db, generate, auth: (_req, res, next) => { res.locals.userId = "u1"; next(); } }));
  return { app, generate };
}
async function send(app: express.Express, body: object) {
  return request(await listeningServer(app)).post("/api/projects/p1/generations/g1/edits/interpret").send(body);
}
describe("scoped edit context", () => {
  it("validates collage slots within their selected parent clip", () => {
    const collage: Timeline = { ...timeline, schemaVersion: 2, videoClips: [{ kind: "collage", clipId: "c1", startSec: 0, durationSec: 6, spec: { layoutId: "two-photo-diptych", motionId: "print-drop", effectId: null, seed: "s", durationSec: 6, slots: [{ slotId: "s1", shotId: "a" }, { slotId: "s2", empty: true }] } }] };
    const context = { scope: { kind: "slot", clipId: "c1", slotId: "s1" }, requestId: "r1" };
    expect(validateEditContext(collage, context)).toEqual(context);
    for (const slotId of ["missing", "s2"]) expect(validateEditContext(collage, { ...context, scope: { ...context.scope, slotId } })).toBeNull();
    expect(validateEditContext(collage, { ...context, scope: { ...context.scope, clipId: "other" } })).toBeNull();
  });
  it("rejects malformed context and blank request identities", () => {
    for (const context of [null, [], {}, { scope: { kind: "film" }, requestId: " " }, { scope: { kind: "unknown" }, requestId: "r1" }]) expect(validateEditContext(timeline, context)).toBeNull();
  });
  it("rejects unknown or removed selections even with an explicit client timeline", async () => {
    const { app, generate } = setup();
    for (const clipId of ["unknown", "b"]) {
      const response = await send(app, { text: "hold this longer", revision: 2, timeline, context: { scope: { kind: "clip", clipId }, requestId: "r1" } });
      expect(response.status).toBe(400); expect(response.body.error).toBe("invalid_scope");
    }
    expect(generate).not.toHaveBeenCalled();
  });
  it("rejects slot scope on a non-collage clip", async () => {
    const { app } = setup();
    expect((await send(app, { text: "change this", revision: 2, context: { scope: { kind: "slot", clipId: "a", slotId: "s1" }, requestId: "r1" } })).status).toBe(400);
  });
  it("rejects foreign projects and stale acknowledged revisions before model calls", async () => {
    const foreign = setup("other");
    expect((await send(foreign.app, { text: "change", revision: 2 })).status).toBe(404);
    expect(foreign.generate).not.toHaveBeenCalled();
    const stale = setup();
    expect((await send(stale.app, { text: "change", revision: 1 })).status).toBe(409);
    expect(stale.generate).not.toHaveBeenCalled();
  });
  it("returns the acknowledged revision and request identity for valid scoped edits", async () => {
    const { app } = setup();
    const response = await send(app, { text: "hold this longer", revision: 2, context: { scope: { kind: "clip", clipId: "a" }, requestId: "r1" } });
    expect(response.body).toMatchObject({ kind: "edit", baseRevision: 2, requestId: "r1" });
  });
  it("defaults legacy requests to film scope", async () => {
    const { app } = setup();
    const response = await send(app, { text: "hold longer", revision: 2 });
    expect(response.status).toBe(200); expect(response.body.kind).toBe("edit"); expect(response.body.requestId).toEqual(expect.any(String));
  });
});
