import express, { type RequestHandler } from "express";
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import request from "supertest";
import { listeningServer } from "../test/listeningServer.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Timeline } from "@mosae/contracts";
import { adminDb } from "../firebase/admin.js";

const fixturesDir = fileURLToPath(new URL("../../fixtures/gemini/", import.meta.url));
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
const trip1Timeline: Timeline = {
  ...timeline,
  durationSec: 29,
  chapters: [
    { title: "Day 1 · Siloso Beach", startSec: 0 },
    { title: "Day 2 · Singapore Zoo", startSec: 9 },
    { title: "Day 3 · Shangri-La Rasa Sentosa", startSec: 19 },
  ],
  videoClips: [0, 2, 4, 7, 9, 12, 14, 17, 19, 22, 24, 27].map((startSec, index) => ({
    id: `trip1Shot${String(index).padStart(16, "0")}#still@c${index < 4 ? 0 : index < 8 ? 1 : 2}`,
    source: { kind: "photo" as const, shotId: `shot${index}` },
    startSec,
    durationSec: [2, 2, 3, 2, 3, 2, 3, 2, 3, 2, 3, 2][index]!,
    transitionIn: { kind: "cut" as const, durationSec: 0 },
  })),
  captions: [],
};

function freshTimeline(source: Timeline, projectId: string): Timeline {
  const ids = new Map<string, string>();
  const freshId = (id: string) => {
    if (!ids.has(id)) ids.set(id, `${id}-${randomUUID()}`);
    return ids.get(id)!;
  };
  return {
    ...source,
    projectId,
    videoClips: source.videoClips.map((clip) => "kind" in clip
      ? { ...clip, clipId: freshId(clip.clipId), spec: { ...clip.spec, slots: clip.spec.slots.map((slot) => ({ ...slot, slotId: freshId(slot.slotId), ...(slot.shotId ? { shotId: freshId(slot.shotId) } : {}) })) } }
      : { ...clip, id: freshId(clip.id), source: { ...clip.source, shotId: freshId(clip.source.shotId) } }),
  };
}

const clipId = (clip: Timeline["videoClips"][number]) => "kind" in clip ? clip.clipId : clip.id;

afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });

describe("edit interpretation replay route (Firestore emulator)", () => {
  it("replays the recorded Ask examples and the trip1 zoo edit through the owned-generation route", async () => {
    if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error("FIRESTORE_EMULATOR_HOST must point at the already-running emulator");
    const fixtures = readdirSync(fixturesDir).filter((name) => name.startsWith("edit-interpret-") && name.endsWith(".json"));
    const fixturePrompts = fixtures.map((name) => {
      const fixture = JSON.parse(readFileSync(new URL(`../../fixtures/gemini/${name}`, import.meta.url), "utf8")) as { request: string };
      const request = JSON.parse(fixture.request) as { contents?: { text?: string }[] };
      return request.contents?.map((part) => part.text ?? "").join("\n") ?? "";
    });
    for (const phrase of ["move the snow monkeys earlier", "drop the airport bits", "make the temple collage calmer", "move the zoo photos earlier"]) {
      expect(fixturePrompts.some((prompt) => prompt.includes(`Request: ${phrase}`)), `recording for ${phrase}`).toBe(true);
    }
    vi.stubEnv("MOCK_GEMINI", "replay");
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
      const currentTimeline = freshTimeline(timeline, projectId);
      await adminDb.doc(`projects/${projectId}/generations/${generationId}`).set({ timeline: currentTimeline });
      const response = await request(await listeningServer(app)).post(`/api/projects/${projectId}/generations/${generationId}/edits/interpret`).send({ text: example.text, revision: 0 });
      expect(response.status, example.text).toBe(200);
      const originalIndex = timeline.videoClips.findIndex((clip) => clipId(clip) === example.clipId);
      expect(response.body.ops).toContainEqual(expect.objectContaining({ op: example.op, clipId: clipId(currentTimeline.videoClips[originalIndex]!) }));
      expect(response.body.ops.every((op: { clipId?: string }) => !op.clipId || currentTimeline.videoClips.some((clip) => clipId(clip) === op.clipId))).toBe(true);
    }
    const tripGenerationId = "generation-trip1-zoo";
    const currentTripTimeline = freshTimeline(trip1Timeline, projectId);
    await adminDb.doc(`projects/${projectId}/generations/${tripGenerationId}`).set({ timeline: currentTripTimeline });
    const tripResponse = await request(await listeningServer(app)).post(`/api/projects/${projectId}/generations/${tripGenerationId}/edits/interpret`).send({ text: "move the zoo photos earlier", revision: 0 });
    expect(tripResponse.status).toBe(200);
    expect(tripResponse.body.reply).toContain("Singapore Zoo");
    expect(tripResponse.body.ops).toHaveLength(4);
    expect(tripResponse.body.ops.map((op: { clipId: string }) => op.clipId)).toEqual(currentTripTimeline.videoClips.slice(4, 8).map(clipId));
  });
});
