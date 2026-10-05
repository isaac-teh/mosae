import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { safeParseTimeline, type StoryProposal, type Timeline } from "@mosae/contracts";
import { runCompose, type ComposeDeps, type ComposeJob } from "./runCompose.js";
import type { Asset } from "./buildCandidates.js";
import { photoBaseDuration, DIRECTING_RULES } from "./directingRules.js";

/**
 * The determinism guard.
 *
 * One accepted proposal and one recorded model response must always produce the
 * same `Timeline`, down to the bytes. The Player preview and the downloaded MP4
 * are the same film only because one composition drives both hosts; that holds
 * only while composition is a pure function of its inputs. Stages 1, 3 and 4 of
 * the pipeline — candidates, assemble/reflow, validate — have no clock, no
 * randomness and no I/O by design, and this is the test that enforces it.
 *
 * It compares the whole serialized timeline, not a sample of its fields,
 * because a guard that checks a handful of numbers protects a handful of
 * numbers. If this fails, either the composition changed or something
 * non-deterministic got in; read the diff before touching the golden file,
 * and regenerate it only for a change you meant to make.
 */

const here = (name: string) => fileURLToPath(new URL(`./golden/${name}`, import.meta.url));

type GoldenInput = {
  job: Omit<ComposeJob, "proposal">;
  proposal: StoryProposal;
  catalog: Record<string, Asset>;
  response: unknown;
};

const input = JSON.parse(readFileSync(here("input.json"), "utf8")) as GoldenInput;
const expected = readFileSync(here("timeline.json"), "utf8");

/** The one serialization both sides of the comparison use. */
function serialize(timeline: Timeline): string {
  return `${JSON.stringify(timeline, null, 2)}\n`;
}

function compose(): Promise<ReturnType<typeof runCompose>> extends never ? never : ReturnType<typeof runCompose> {
  const deps: ComposeDeps = {
    // Recorded, never live. CI spends nothing.
    generateStructured: async () => input.response,
    soundtrackIds: new Set(["soundtrack-dusk"]),
    assets: new Map(Object.entries(input.catalog)),
  };
  return runCompose({ ...input.job, proposal: input.proposal }, deps);
}

async function composeOrThrow(): Promise<Timeline> {
  const result = await compose();
  if (!result.ok) throw new Error(`golden input failed to compose: ${result.reasons.join("; ")}`);
  return result.timeline;
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("golden composition", () => {
  it("reproduces the committed timeline byte for byte", async () => {
    expect(serialize(await composeOrThrow())).toBe(expected);
  });

  it("drops none of the recorded picks, so the golden locks the whole film", async () => {
    const result = await compose();
    if (!result.ok) throw new Error(result.reasons.join("; "));
    // A golden built from a film that quietly lost half its picks would still
    // be stable, and would still be worthless.
    expect(result.droppedPicks).toEqual([]);
    const included = new Set(result.timeline.videoClips.flatMap((clip) => "kind" in clip ? clip.spec.slots.map((slot) => slot.shotId) : [clip.source.shotId]));
    expect(included).toEqual(new Set(input.proposal.moments.map((moment) => moment.shotId)));
  });

  it("produces a structurally valid timeline", async () => {
    const parsed = safeParseTimeline(JSON.parse(expected));
    expect(parsed.ok ? [] : parsed.errors).toEqual([]);
  });

  it("emits timeline schema v2 even when the golden film has no collage candidates", async () => {
    expect((await composeOrThrow()).schemaVersion).toBe(2);
  });

  it("drops day labels while preserving story text overlays", async () => {
    const timeline = await composeOrThrow();
    expect(timeline.captions.map((caption) => caption.text)).toEqual(["Into the water"]);
  });

  it("is unchanged by the wall clock", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2021-03-04T05:06:07.008Z"));
    const first = serialize(await composeOrThrow());
    vi.setSystemTime(new Date("2031-12-31T23:59:59.999Z"));
    const second = serialize(await composeOrThrow());

    expect(first).toBe(second);
    expect(first).toBe(expected);
  });

  it("never reaches for randomness", async () => {
    // The seed is a stored input, not something composition rolls for itself.
    const random = vi.spyOn(Math, "random").mockImplementation(() => {
      throw new Error("composition called Math.random()");
    });

    expect(serialize(await composeOrThrow())).toBe(expected);
    expect(random).not.toHaveBeenCalled();
  });

  it("gives the same film on a second run in the same process", async () => {
    const runs = await Promise.all([composeOrThrow(), composeOrThrow(), composeOrThrow()]);
    const serialized = runs.map(serialize);
    expect(new Set(serialized).size).toBe(1);
    expect(serialized[0]).toBe(expected);
  });

  it("deterministically stretches a four-photo collage from its photo-count base", async () => {
    const moments = Array.from({ length: 8 }, (_, index) => ({
      id: `collage-photo-${index}`,
      shotId: `collage-shot-${index}`,
      kind: "photo" as const,
      title: `Trip photo ${index + 1}`,
      description: "",
      rationale: "",
    }));
    const proposal: StoryProposal = {
      ...input.proposal,
      id: "trip1-four-photo-collage-golden",
      moments,
      chapters: [{ id: "trip", title: "Trip", summary: "", momentIds: moments.map((moment) => moment.id) }],
      constraints: { excludedShotIds: [], deselectedMomentIds: [], mustIncludeMomentIds: [], feedback: [] },
    };
    const job: ComposeJob = { ...input.job, proposal, durationId: null, cadenceId: "playful", soundtrackId: null, collageAmount: "few" };
    const catalog = Object.fromEntries(moments.map((moment, index) => [moment.id, {
      ...(input.catalog["m-arrival"] as Asset),
      assetId: `trip-asset-${index}`,
      eventId: index < 4 ? "four-photo-burst" : `other-${index}`,
      localTime: `2026-06-01T09:${String(index).padStart(2, "0")}:00`,
    }])) as Record<string, Asset>;
    const response = {
      clips: moments.map((moment) => ({ candidateId: `${moment.id}#still@c0`, holdSec: 2.2, transition: "cut", audio: "mute" })),
      musicCues: [],
    };
    const deps: ComposeDeps = {
      generateStructured: async () => response,
      soundtrackIds: new Set(),
      assets: new Map(Object.entries(catalog)),
      collageReview: { combos: [{ layoutId: "torn-paper", motionId: "print-drop", verdict: "keep" }] },
    };
    const runs = await Promise.all([runCompose(job, deps), runCompose(job, deps)]);
    for (const result of runs) {
      if (!result.ok) throw new Error(result.reasons.join("; "));
      const collage = result.timeline.videoClips.find((clip) => "kind" in clip);
      if (!collage || !("kind" in collage)) throw new Error("expected collage in tierless golden run");
      expect(collage.spec.slots).toHaveLength(4);
      expect(collage.durationSec).toBeGreaterThanOrEqual(photoBaseDuration(4, "playful"));
      expect(collage.durationSec).toBeLessThanOrEqual(photoBaseDuration(4, "playful") * DIRECTING_RULES.tierlessPhotoStretchMultiplier);
      expect(collage.spec.durationSec).toBe(collage.durationSec);
    }
    const serializedRuns = runs.map((result) => result.ok ? serialize(result.timeline) : "");
    expect(serializedRuns[0]).toBe(serializedRuns[1]);
  });

  it("calls the model exactly once", async () => {
    const generateStructured = vi.fn().mockResolvedValue(input.response);
    await runCompose(
      { ...input.job, proposal: input.proposal },
      { generateStructured, soundtrackIds: new Set(["soundtrack-dusk"]), assets: new Map(Object.entries(input.catalog)) },
    );
    // Composition is one structured call, not an agent loop.
    expect(generateStructured).toHaveBeenCalledTimes(1);
  });

  it("gives each clip the overlap its own transitionIn declares", async () => {
    // `transitionIn` is the transition INTO a clip. m-talking and m-dusk declare
    // crossfades and are the clips pulled back over their predecessors;
    // m-water declares a cut and sits flush. Before the fix each declaration
    // landed one boundary early, so m-talking got no overlap and m-water —
    // which asked for a hard cut — was pulled back half a second.
    const timeline = await composeOrThrow();
    const [arrival, talking, water, dusk] = timeline.videoClips;

    const boundary = (out: typeof arrival, incoming: typeof arrival) =>
      Number(((out.startSec + out.durationSec) - incoming.startSec).toFixed(6));

    expect(talking.transitionIn?.kind).toBe("crossfade");
    expect(boundary(arrival, talking)).toBeCloseTo(0.5);

    expect(water.transitionIn?.kind).toBe("cut");
    expect(boundary(talking, water)).toBeCloseTo(0);

    expect(dusk.transitionIn?.kind).toBe("crossfade");
    expect(boundary(water, dusk)).toBeCloseTo(0.5);
  });

  it("lands within 10% of the length it was fitted to", async () => {
    const timeline = await composeOrThrow();
    // All four proposal moments remain in the cut; selected tiers fit only to
    // the maximum reachable duration when the requested tier exceeds capacity.
    expect(timeline.durationSec).toBeCloseTo(27.4);
    expect(Math.abs(timeline.durationSec - 27.4)).toBeLessThanOrEqual(2.74);
  });

  it("burns in the model's text overlay and ducks the music under speech", async () => {
    const timeline = await composeOrThrow();
    expect(timeline.captions).toEqual([{ text: "Into the water", startSec: 8.5, endSec: 14.266666666666666 }]);

    const music = timeline.audioClips.find((clip) => clip.role === "music");
    const speech = timeline.audioClips.find((clip) => clip.role === "speech");
    expect(speech?.gainDb).toBe(0);
    // Ducked, not the flat -6 the role-keyed constant used to hardcode.
    expect(music?.gainDb).toBeLessThan(-6);
  });

  it("carries the directing note to the model", async () => {
    const generateStructured = vi.fn().mockResolvedValue(input.response);
    await runCompose(
      { ...input.job, proposal: input.proposal },
      { generateStructured, soundtrackIds: new Set(["soundtrack-dusk"]), assets: new Map(Object.entries(input.catalog)) },
    );
    const options = generateStructured.mock.calls[0][0] as { contents: string };
    expect(options.contents).toContain(input.job.note);
  });

  it("changes the film when the recorded response changes", async () => {
    // Guards the guard: a comparison that passed whatever it was handed would
    // look exactly like a passing determinism test.
    const reordered = {
      ...(input.response as { clips: unknown[]; musicCues: unknown[] }),
      clips: [...(input.response as { clips: unknown[] }).clips].reverse(),
    };
    const result = await runCompose(
      { ...input.job, proposal: input.proposal },
      { generateStructured: async () => reordered, soundtrackIds: new Set(["soundtrack-dusk"]), assets: new Map(Object.entries(input.catalog)) },
    );
    if (!result.ok) throw new Error(result.reasons.join("; "));
    expect(serialize(result.timeline)).not.toBe(expected);
  });
});
