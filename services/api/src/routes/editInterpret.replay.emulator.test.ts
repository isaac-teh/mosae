import express, { type RequestHandler } from "express";
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import request from "supertest";
import { listeningServer } from "../test/listeningServer.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { applyEdits, safeParseTimeline, type Timeline } from "@mosae/contracts";
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
const recordLiveGemini = process.env.MOCK_GEMINI === "record";
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
  audioClips: [{ id: "trip-music", source: { kind: "soundtrack", soundtrackId: "soft-piano", sourceInSec: 0, sourceOutSec: 29 }, role: "music", startSec: 0, gainDb: -12, fadeInSec: 0.5, fadeOutSec: 0.5 }],
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
    for (const phrase of ["move the snow monkeys earlier", "drop the airport bits", "make the temple collage calmer", "move the zoo photos earlier", "Adjust duration to 2s for all", "Add more collage"]) {
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

    const allDurationGenerationId = "generation-live-duration";
    const allDurationTimeline = freshTimeline(trip1Timeline, projectId);
    await adminDb.doc(`projects/${projectId}/generations/${allDurationGenerationId}`).set({ timeline: allDurationTimeline });
    const allDurationResponse = await request(await listeningServer(app)).post(`/api/projects/${projectId}/generations/${allDurationGenerationId}/edits/interpret`).send({
      text: "Adjust duration to 2s for all", revision: 0,
      context: { scope: { kind: "clip", clipId: clipId(allDurationTimeline.videoClips[0]!) }, requestId: "all-duration-replay" },
    });
    expect(allDurationResponse.status).toBe(200);
    expect(allDurationResponse.body.kind).toBe("edit");
    expect(allDurationResponse.body.ops).toHaveLength(allDurationTimeline.videoClips.length);
    const shortened = applyEdits(allDurationTimeline, allDurationResponse.body.ops);
    expect(shortened.ok).toBe(true);
    if (shortened.ok) {
      expect(shortened.timeline.videoClips.every((clip) => clip.durationSec === 2)).toBe(true);
      expect(safeParseTimeline(shortened.timeline).ok).toBe(true);
      const music = shortened.timeline.audioClips.find((clip) => clip.role === "music");
      expect(music && music.startSec + music.source.sourceOutSec - music.source.sourceInSec).toBe(shortened.timeline.durationSec);
    }

    const collageGenerationId = "generation-live-collage";
    const collageTimeline = freshTimeline(timeline, projectId);
    await adminDb.doc(`projects/${projectId}/generations/${collageGenerationId}`).set({ timeline: collageTimeline });
    const collageResponse = await request(await listeningServer(app)).post(`/api/projects/${projectId}/generations/${collageGenerationId}/edits/interpret`).send({
      text: "Add more collage", revision: 0,
      context: { scope: { kind: "clip", clipId: clipId(collageTimeline.videoClips[2]!) }, requestId: "more-collage-replay" },
    });
    expect(collageResponse.status).toBe(200);
    if (collageResponse.body.kind === "edit") {
      expect(collageResponse.body.ops.some((op: { op: string; shotId?: string }) => op.op === "addCollageSlot" && Boolean(op.shotId))).toBe(true);
      expect(applyEdits(collageTimeline, collageResponse.body.ops).ok).toBe(true);
    } else {
      expect(collageResponse.body).toMatchObject({ kind: "clarify", ops: [] });
      expect(collageResponse.body.reply).toMatch(/photo|which/i);
    }
  });

  it.skipIf(!recordLiveGemini)("records only the two reported live Ask AI prompts", async () => {
    if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error("FIRESTORE_EMULATOR_HOST must point at the already-running emulator");
    vi.resetModules();
    const [{ editInterpretRouter }, { generateStructured }, { createGeminiClient }] = await Promise.all([
      import("./editInterpret.js"), import("../gemini/client.js"), import("../gemini/wire.js"),
    ]);
    const projectId = `ask-live-record-${randomUUID()}`;
    await adminDb.doc(`projects/${projectId}`).set({ id: projectId, userId: owner });
    let liveCalls = 0;
    const gemini = createGeminiClient(process.env.GEMINI_API_KEY);
    const app = express();
    app.use(express.json());
    app.use("/api/projects", editInterpretRouter({ db: adminDb, auth, generate: (options) => generateStructured(options, {
      generateContent: async (input) => {
        if (liveCalls >= 2) throw new Error("live Gemini call cap exceeded");
        liveCalls += 1;
        try { return await gemini(input); }
        catch (error) { console.error("live Gemini request failed", error); throw error; }
      },
      recordUsage: () => {},
    }) }));

    const durationTimeline = freshTimeline(trip1Timeline, projectId);
    await adminDb.doc(`projects/${projectId}/generations/duration`).set({ timeline: durationTimeline });
    const duration = await request(await listeningServer(app)).post(`/api/projects/${projectId}/generations/duration/edits/interpret`).send({
      text: "Adjust duration to 2s for all", revision: 0,
      context: { scope: { kind: "clip", clipId: clipId(durationTimeline.videoClips[0]!) }, requestId: "live-all-duration" },
    });
    expect(duration.status).toBe(200);
    expect(duration.body.kind).toBe("edit");
    expect(duration.body.ops).toHaveLength(durationTimeline.videoClips.length);
    const applied = applyEdits(durationTimeline, duration.body.ops);
    expect(applied.ok).toBe(true);
    if (applied.ok) expect(applied.timeline.videoClips.every((clip) => clip.durationSec === 2)).toBe(true);

    const collageTimeline = freshTimeline(timeline, projectId);
    await adminDb.doc(`projects/${projectId}/generations/collage`).set({ timeline: collageTimeline });
    const collage = await request(await listeningServer(app)).post(`/api/projects/${projectId}/generations/collage/edits/interpret`).send({
      text: "Add more collage", revision: 0,
      context: { scope: { kind: "clip", clipId: clipId(collageTimeline.videoClips[2]!) }, requestId: "live-more-collage" },
    });
    expect(collage.status).toBe(200);
    if (collage.body.kind === "edit") {
      expect(collage.body.ops.some((op: { op: string; shotId?: string }) => op.op === "addCollageSlot" && Boolean(op.shotId))).toBe(true);
      expect(applyEdits(collageTimeline, collage.body.ops).ok).toBe(true);
    } else {
      expect(collage.body).toMatchObject({ kind: "clarify", ops: [] });
      expect(collage.body.reply).toMatch(/photo|which/i);
    }
    expect(liveCalls).toBeLessThanOrEqual(2);
  }, 120_000);
});
