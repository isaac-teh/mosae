import express, { type RequestHandler } from "express";
import { randomUUID } from "node:crypto";
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Timeline } from "@mosae/contracts";
import { adminDb } from "../firebase/admin.js";

const fixturesDir = fileURLToPath(new URL("../../fixtures/gemini/", import.meta.url));
const oldMode = process.env.MOCK_GEMINI;
const owner = "editor-ask-replay-owner";
const auth: RequestHandler = (_req, res, next) => { res.locals.userId = owner; next(); };
const timeline: Timeline = {
  schemaVersion: 2, projectId: "unused", mode: "memory", aspect: "9:16", fps: 30, durationSec: 16,
  chapters: [{ title: "Arrival", startSec: 0 }, { title: "Snow monkeys", startSec: 4 }, { title: "At the temple", startSec: 8 }, { title: "Leaving", startSec: 12 }],
  videoClips: [
    { id: "clip-airport", source: { kind: "photo", shotId: "shot-airport" }, startSec: 0, durationSec: 4, transitionIn: { kind: "cut", durationSec: 0 } },
    { id: "clip-snow-monkeys", source: { kind: "photo", shotId: "shot-monkeys" }, startSec: 4, durationSec: 4, transitionIn: { kind: "cut", durationSec: 0 } },
    { kind: "collage", clipId: "collage-temple", startSec: 8, durationSec: 4, transitionIn: { kind: "cut", durationSec: 0 }, spec: { layoutId: "photo-table", slots: [1, 2, 3, 4].map((index) => ({ slotId: `temple-${index}`, shotId: `temple-shot-${index}`, kind: "photo" as const })), motionId: "stack-deal", effectId: "vignette", seed: "fixture", durationSec: 4 } },
    { id: "clip-leaving", source: { kind: "photo", shotId: "shot-leaving" }, startSec: 12, durationSec: 4, transitionIn: { kind: "cut", durationSec: 0 } },
  ],
  audioClips: [],
  captions: [
    { text: "Walking through the airport", startSec: 0, endSec: 4 },
    { text: "Watching the snow monkeys play", startSec: 4, endSec: 8 },
    { text: "Exploring the temple grounds", startSec: 8, endSec: 12 },
    { text: "Heading home", startSec: 12, endSec: 16 },
  ],
};
const examples = [
  { text: "move the snow monkeys earlier", op: "move", clipId: "clip-snow-monkeys" },
  { text: "drop the airport bits", op: "remove", clipId: "clip-airport" },
  { text: "make the temple collage calmer", op: "setCollageMotion", clipId: "collage-temple" },
];

afterEach(() => { if (oldMode === undefined) delete process.env.MOCK_GEMINI; else process.env.MOCK_GEMINI = oldMode; vi.resetModules(); });

describe("edit interpretation replay route (Firestore emulator)", () => {
  it("replays the three recorded Ask examples through the owned-generation route", async () => {
    if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error("FIRESTORE_EMULATOR_HOST must point at the already-running emulator");
    const fixtures = readdirSync(fixturesDir).filter((name) => name.startsWith("edit-interpret-") && name.endsWith(".json"));
    expect(fixtures).toHaveLength(4); // one example required a recorded schema-repair turn
    process.env.MOCK_GEMINI = "replay";
    vi.resetModules();
    const [{ editInterpretRouter }, { generateStructured }, { createGeminiClient }] = await Promise.all([
      import("./editInterpret.js"), import("../gemini/client.js"), import("../gemini/wire.js"),
    ]);
    const projectId = `ask-replay-${randomUUID()}`;
    await adminDb.doc(`projects/${projectId}`).set({ id: projectId, userId: owner });
    const app = express();
    app.use(express.json());
    app.use("/api/projects", editInterpretRouter({ db: adminDb, auth, generate: (options) => generateStructured(options, { generateContent: createGeminiClient(), recordUsage: () => {} }) }));
    for (const [index, example] of examples.entries()) {
      const generationId = `generation-${index}`;
      await adminDb.doc(`projects/${projectId}/generations/${generationId}`).set({ timeline: { ...timeline, projectId } });
      const response = await request(app).post(`/api/projects/${projectId}/generations/${generationId}/edits/interpret`).send({ text: example.text, revision: 0 });
      expect(response.status, example.text).toBe(200);
      expect(response.body.ops).toContainEqual(expect.objectContaining({ op: example.op, clipId: example.clipId }));
    }
  });
});
