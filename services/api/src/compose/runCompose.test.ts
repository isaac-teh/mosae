import { describe, it, expect, vi } from "vitest";
import { runCompose, applyUserOrder, isAutomaticDayLabel, type ComposeJob, type ComposeDeps } from "./runCompose.js";
import { castSummary } from "../cast/castSummary.js";
import { safeParseTimeline } from "@mosae/contracts";
import { MODELS } from "../gemini/pricing.js";
import { estimateUsd } from "../gemini/client.js";
import { buildCandidates } from "./buildCandidates.js";
import { holdsFor } from "./brief.js";
import { readFileSync } from "node:fs";

describe("applyUserOrder", () => {
  const clips = ["m1", "m2", "m3"].map((itemId) => ({ itemId }));
  const chapterOf = new Map([["m1", 1], ["m2", 1], ["m3", 2]]);
  it("reorders within a chapter only", () => {
    expect(applyUserOrder(clips, ["m2", "m1", "m3"], chapterOf).map((c) => c.itemId)).toEqual(["m2", "m1", "m3"]);
    expect(applyUserOrder(clips, ["m3", "m1", "m2"], chapterOf).map((c) => c.itemId)).toEqual(["m1", "m2", "m3"]);
  });
  it("no order leaves clips unchanged", () => expect(applyUserOrder(clips, undefined, chapterOf)).toEqual(clips));
});

describe("isAutomaticDayLabel", () => {
  it.each(["DAY 1", "Day 2 · Siloso Beach", "Chapter 3 - Arrival"])('filters generated label "%s"', (text) => {
    expect(isAutomaticDayLabel(text)).toBe(true);
  });
  it.each(["Into the water", "A day to remember", "Chapter of our lives"])('keeps story text "%s"', (text) => {
    expect(isAutomaticDayLabel(text)).toBe(false);
  });
});

// --- Helpers to build minimal test fixtures ---

function makeProposal(overrides?: Partial<import("@mosae/contracts").StoryProposal>): import("@mosae/contracts").StoryProposal {
  return {
    schemaVersion: 1,
    id: "proposal-1",
    projectId: "proj-1",
    storyIntentId: "intent-1",
    parentProposalId: null,
    state: "accepted" as const,
    version: 1,
    title: "Test Proposal",
    moments: [
      { id: "video1", shotId: "shot-1", kind: "video" as const, previewInSec: 0, previewOutSec: 5, title: "Moment 1", description: "", rationale: "" },
      { id: "photo1", shotId: "shot-2", kind: "photo" as const, title: "Moment 2", description: "", rationale: "" },
    ],
    chapters: [
      { id: "ch1", title: "Chapter 1", summary: "First chapter", momentIds: ["video1"] },
      { id: "ch2", title: "Chapter 2", summary: "Second chapter", momentIds: ["photo1"] },
    ],
    constraints: { excludedShotIds: [], deselectedMomentIds: [], mustIncludeMomentIds: ["video1"], feedback: [] },
    openQuestions: [],
    ...overrides,
  };
}

function makeAssets(): Map<string, import("./buildCandidates.js").Asset> {
  return new Map([
    [
      "video1",
      {
        kind: "video",
        analysis: {
          shots: [{ startSec: 0, endSec: 10, description: "A shot", role: "A_ROLL", quality: 0.9, usable: true }],
          transcript: [{ startSec: 2, endSec: 5, text: "Hello world" }],
        },
      },
    ],
    ["photo1", { kind: "photo", analysis: { caption: "A sunset" } }],
  ]);
}

function makeDeps(overrides?: Partial<ComposeDeps>): ComposeDeps {
  return {
    generateStructured: vi.fn().mockResolvedValue({
      clips: [
        { candidateId: "video1#s0@0.15c0", transition: "cut" as const, audio: "keep" as const },
        { candidateId: "photo1#still@c1", transition: "crossfade" as const, audio: "duck" as const, holdSec: 4 },
      ],
      musicCues: [],
    }),
    soundtrackIds: new Set(["soundtrack-1"]),
    assets: makeAssets(),
    ...overrides,
  };
}

function makeJob(overrides?: Partial<ComposeJob>): ComposeJob {
  return {
    proposal: makeProposal(),
    projectId: "proj-1",
    generationId: "generation-1",
    mode: "creator" as const,
    aspect: "9:16" as const,
    durationId: "30s" as const,
    cadenceId: "tender" as const,
    seed: "seed-123",
    soundtrackId: null,
    note: "",
    captions: false,
    ...overrides,
  };
}

describe("runCompose — collages", () => {
  it("accepts valid model boundary choices and logs their reasons", async () => {
    const result = await runCompose(makeJob(), makeDeps({ generateStructured: async () => ({
      clips: [{ candidateId: "video1", transition: "cut", audio: "keep" }, { candidateId: "photo1#still@c1", transition: "cut", audio: "mute" }],
      musicCues: [],
      openerId: { candidateId: "video1", reason: "The opening line establishes the trip." },
      closerId: { candidateId: "photo1", reason: "The sunset gives the story a quiet finish." },
    }) }));
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.reasons.join("; "));
    expect(result.droppedPicks).toContain("Gemini opener: video1 — The opening line establishes the trip.");
    expect(result.droppedPicks).toContain("Gemini closer: photo1 — The sunset gives the story a quiet finish.");
  });

  it("rejects invalid model boundary choices and records deterministic fallback", async () => {
    const result = await runCompose(makeJob(), makeDeps({ generateStructured: async () => ({
      clips: [{ candidateId: "video1#s0@0c0", transition: "cut", audio: "keep" }, { candidateId: "photo1#still@c1", transition: "cut", audio: "mute" }],
      musicCues: [],
      openerId: { candidateId: "photo1#still@c1", reason: "Looks nice." },
    }) }));
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.reasons.join("; "));
    expect(result.droppedPicks.some((reason) => reason.includes("Gemini opener rejected") && reason.includes("deterministic rule used"))).toBe(true);
  });

  it("records duplicate photo overflow on droppedPicks and keeps the canonical photo", async () => {
    const moments = ["primary", "duplicate", "other"].map((id) => ({
      id, shotId: `shot-${id}`, kind: "photo" as const, title: id, description: "", rationale: "",
    }));
    const proposal = makeProposal({
      moments,
      chapters: [{ id: "chapter-1", title: "Day", summary: "", momentIds: moments.map((moment) => moment.id) }],
      constraints: { excludedShotIds: [], deselectedMomentIds: [], mustIncludeMomentIds: [], feedback: [] },
    });
    const assets = new Map([
      ["primary", { kind: "photo" as const, assetId: "asset-primary", analysis: { caption: "primary" } }],
      ["duplicate", { kind: "photo" as const, assetId: "asset-duplicate", dupOf: "asset-primary", analysis: { caption: "duplicate" } }],
      ["other", { kind: "photo" as const, assetId: "asset-other", analysis: { caption: "other" } }],
    ]);
    const result = await runCompose(makeJob({ proposal }), makeDeps({
      assets,
      generateStructured: async () => ({ clips: moments.map((moment) => ({ candidateId: `${moment.id}#still@c0`, holdSec: 2, transition: "cut", audio: "mute" })), musicCues: [] }),
    }));
    if (!result.ok) throw new Error(result.reasons.join("; "));
    expect(result.droppedPicks).toContain("Similar photo — best one kept");
    expect(result.timeline.videoClips.filter((clip) => "source" in clip).map((clip) => clip.source.shotId)).not.toContain("shot-duplicate");
  });

  it("composes photos without capture times and omits the collage caption date", async () => {
    const moments = Array.from({ length: 7 }, (_, index) => ({
      id: `photo${index}`, shotId: `shot-${index}`, kind: "photo" as const,
      title: `Photo ${index}`, description: "", rationale: "",
    }));
    const proposal = makeProposal({
      moments,
      chapters: [{ id: "chapter-1", title: "Day 1 · Siloso Beach", summary: "", momentIds: moments.map((moment) => moment.id) }],
      constraints: { excludedShotIds: [], deselectedMomentIds: [], mustIncludeMomentIds: [], feedback: [] },
    });
    const assets = new Map(moments.map((moment, index) => [moment.id, {
      kind: "photo" as const, eventId: "burst", assetId: `asset-${index}`,
      analysis: { caption: moment.title },
    }]));
    const result = await runCompose(makeJob({ proposal }), makeDeps({
      assets,
      collageReview: { combos: [{ layoutId: "torn-paper", motionId: "print-drop", verdict: "keep" }] },
      generateStructured: async () => ({
        clips: moments.map((moment) => ({ candidateId: `${moment.id}#still@c0`, holdSec: 4, transition: "cut", audio: "mute" })),
        musicCues: [],
      }),
    }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.timeline.videoClips.length).toBeGreaterThan(0);
    for (const clip of result.timeline.videoClips) {
      if ("kind" in clip) expect(clip.spec.caption).toBeUndefined();
    }
  });

  it("places a four-photo event burst in the composed v2 film", async () => {
    const moments = Array.from({ length: 7 }, (_, index) => ({
      id: `photo${index}`, shotId: `shot-${index}`, kind: "photo" as const,
      title: `Photo ${index}`, description: "", rationale: "",
    }));
    const proposal = makeProposal({
      moments,
      chapters: [{ id: "chapter-1", title: "The day", summary: "", momentIds: moments.map((moment) => moment.id) }],
      constraints: { excludedShotIds: [], deselectedMomentIds: [], mustIncludeMomentIds: [], feedback: [] },
    });
    const assets = new Map(moments.map((moment, index) => [moment.id, {
      kind: "photo" as const, eventId: index < 4 ? "burst" : `event-${index}`,
      assetId: `asset-${index}`, localTime: `2026-05-03T09:${String(index).padStart(2, "0")}:00`,
      analysis: { caption: moment.title },
    }]));
    const result = await runCompose(makeJob({ proposal }), makeDeps({
      assets,
      collageReview: { combos: [{ layoutId: "torn-paper", motionId: "print-drop", verdict: "keep" }] },
      generateStructured: async () => ({
        clips: moments.map((moment) => ({ candidateId: `${moment.id}#still@c0`, holdSec: 4, transition: "cut", audio: "mute" })),
        musicCues: [],
      }),
    }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.timeline.schemaVersion).toBe(2);
    // N=7 is below the rule's first collage threshold (N=8).
    expect(result.timeline.videoClips.filter((clip) => "kind" in clip)).toHaveLength(0);
    expect(result.timeline.durationSec).toBeGreaterThanOrEqual(18);
    expect(result.timeline.durationSec).toBeLessThanOrEqual(30);
    expect(safeParseTimeline(result.timeline).ok).toBe(true);
  });

  it.each([
    { durationId: "30s" as const, cadenceId: "playful" as const, minimum: 27, maximum: 33 },
    { durationId: "1m" as const, cadenceId: "reflective" as const, minimum: 42, maximum: 48 },
  ])("includes all selected proposal media and reaches the $durationId tier despite Gemini under-selection", async ({ durationId, cadenceId, minimum, maximum }) => {
    const moments = Array.from({ length: 13 }, (_, index) => ({
      id: `photo${index}`, shotId: `shot-${index}`, kind: "photo" as const,
      title: `Photo ${index}`, description: "", rationale: "",
    }));
    const proposal = makeProposal({
      moments,
      chapters: [0, 1, 2].map((chapter) => ({ id: `chapter-${chapter}`, title: `Day ${chapter + 1}`, summary: "", momentIds: moments.slice(chapter * 4, chapter === 2 ? 13 : (chapter + 1) * 4).map((moment) => moment.id) })),
      constraints: { excludedShotIds: [], deselectedMomentIds: ["photo3"], mustIncludeMomentIds: [], feedback: [] },
    });
    const assets = new Map(moments.map((moment, index) => [moment.id, {
      kind: "photo" as const, eventId: `day-${Math.floor(index / 4)}`, assetId: `asset-${index}`,
      localTime: `2026-06-${String(Math.floor(index / 4) + 1).padStart(2, "0")}T09:${String(index % 4).padStart(2, "0")}:00`,
    }]));
    const result = await runCompose(makeJob({ proposal, durationId, cadenceId, collageAmount: "few" }), makeDeps({
      assets,
      generateStructured: async () => ({ clips: moments.slice(0, 3).map((moment) => ({ candidateId: `${moment.id}#still@c0`, holdSec: 2, transition: "cut", audio: "mute" })), musicCues: [] }),
    }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.timeline.durationSec).toBeGreaterThan(0);
    expect(result.timeline.durationSec).toBeGreaterThanOrEqual(minimum);
    expect(result.timeline.durationSec).toBeLessThanOrEqual(maximum);
    const included = new Set(result.timeline.videoClips.flatMap((clip) => "kind" in clip ? clip.spec.slots.map((slot) => slot.shotId) : [clip.source.shotId]));
    expect(included.size).toBe(12);
    expect(included).not.toContain("shot-3");
  });

  it("fits all ten photos to a 30 second tender tier with one collage", async () => {
    const moments = Array.from({ length: 10 }, (_, index) => ({ id: `photo${index}`, shotId: `shot-${index}`, kind: "photo" as const, title: `Photo ${index}`, description: "", rationale: "" }));
    const proposal = makeProposal({ moments, chapters: [{ id: "ch1", title: "Trip", summary: "", momentIds: moments.map(({ id }) => id) }] });
    const assets = new Map(moments.map(({ id }, index) => [id, { kind: "photo" as const, assetId: `asset-${index}`, eventId: "event-1", localTime: `2026-06-01T09:${String(index).padStart(2, "0")}:00` }]));
    const result = await runCompose(makeJob({ proposal, durationId: "30s", cadenceId: "tender", collageAmount: "few" }), makeDeps({ assets,
      generateStructured: async () => ({ clips: moments.slice(0, 2).map(({ id }) => ({ candidateId: `${id}#still@c0`, holdSec: 2.4, transition: "cut", audio: "mute" })), musicCues: [] }),
    }));
    if (!result.ok) throw new Error(result.reasons.join("; "));
    expect(result.timeline.durationSec).toBeGreaterThanOrEqual(27);
    expect(result.timeline.durationSec).toBeLessThanOrEqual(33);
    expect(result.timeline.videoClips.filter((clip) => "kind" in clip)).toHaveLength(1);
    const included = result.timeline.videoClips.flatMap((clip) => "kind" in clip ? clip.spec.slots.map((slot) => slot.shotId) : [clip.source.shotId]);
    expect(new Set(included).size).toBe(10);
  });

  it("passes a none collage setting through composition without adding collage clips", async () => {
    const moments = Array.from({ length: 4 }, (_, index) => ({
      id: `photo${index}`, shotId: `shot-${index}`, kind: "photo" as const,
      title: `Photo ${index}`, description: "", rationale: "",
    }));
    const proposal = makeProposal({
      moments,
      chapters: [{ id: "chapter-1", title: "The day", summary: "", momentIds: moments.map((moment) => moment.id) }],
      constraints: { excludedShotIds: [], deselectedMomentIds: [], mustIncludeMomentIds: [], feedback: [] },
    });
    const assets = new Map(moments.map((moment) => [moment.id, { kind: "photo" as const, eventId: "event", assetId: moment.id, localTime: "2026-05-03T09:00:00" }]));
    const result = await runCompose(makeJob({ proposal, collageAmount: "none" }), makeDeps({
      assets,
      generateStructured: async () => ({ clips: moments.map((moment) => ({ candidateId: `${moment.id}#still@c0`, holdSec: 4, transition: "cut", audio: "mute" })), musicCues: [] }),
    }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.timeline.videoClips.filter((clip) => "kind" in clip)).toHaveLength(0);
  });
});

describe("runCompose — founder video coverage rules", () => {
  it("scores moments when the proposal has no optional summary field", async () => {
    const result = await runCompose(makeJob(), makeDeps());
    expect(result.ok).toBe(true);
  });

  it("leaves good photo overflow out with a length reason while keeping the film within ten percent", async () => {
    const moments = Array.from({ length: 25 }, (_, index) => ({ id: `overflow${index}`, shotId: `overflow-shot-${index}`, kind: "photo" as const, title: `Moment ${index}`, description: "", rationale: "" }));
    const proposal = makeProposal({ moments, chapters: [{ id: "day", title: "Day", summary: "", momentIds: moments.map(({ id }) => id) }], constraints: { excludedShotIds: [], deselectedMomentIds: [], mustIncludeMomentIds: [], feedback: [] } });
    const result = await runCompose(makeJob({ proposal, durationId: "30s", cadenceId: "playful", collageAmount: "none" }), makeDeps({ assets: new Map(moments.map(({ id }, index) => [id, { kind: "photo" as const, keyMomentScore: index / 15 }])), generateStructured: async () => ({ clips: moments.map(({ id }) => ({ candidateId: `${id}#still@c0`, holdSec: 2, transition: "cut", audio: "mute" })), musicCues: [] }) }));
    if (!result.ok) throw new Error(result.reasons.join("; "));
    expect(result.leftOut.length).toBeGreaterThan(0);
    expect(result.leftOut.every(({ reason }) => reason === "didn't fit the length")).toBe(true);
    expect(result.timeline.durationSec).toBeGreaterThanOrEqual(27);
    expect(result.timeline.durationSec).toBeLessThanOrEqual(33);
  });

  it("uses an even chronological arc when the album has no clear peak", async () => {
    const moments = Array.from({ length: 4 }, (_, index) => ({ id: `even${index}`, shotId: `even-shot-${index}`, kind: "photo" as const, title: `Quiet ${index}`, description: "", rationale: "" }));
    const proposal = makeProposal({ moments, chapters: [{ id: "day", title: "Day", summary: "Quiet afternoon", momentIds: moments.map(({ id }) => id) }], constraints: { excludedShotIds: [], deselectedMomentIds: [], mustIncludeMomentIds: [], feedback: [] } });
    const assets = new Map(moments.map(({ id }) => [id, { kind: "photo" as const, analysis: { caption: "Quiet afternoon", mood: "calm", activities: ["walking"], keyMomentScore: 3 } }]));
    const timeOf = new Map(moments.map(({ id }, index) => [id, { chapter: 0, localTime: `2026-05-01T09:0${index}:00`, score: 0.5 }]));
    const result = await runCompose(makeJob({ proposal, durationId: "short", durationSec: 10, cadenceId: "reflective", collageAmount: "none", timeOf }), makeDeps({ assets,
      generateStructured: async () => ({ clips: moments.map(({ id }) => ({ candidateId: `${id}#still@c0`, holdSec: 2.7, transition: "cut", audio: "mute" })), musicCues: [] }),
    }));
    if (!result.ok) throw new Error(result.reasons.join("; "));
    expect(result.timeline.videoClips.map((clip) => "id" in clip ? clip.source.shotId : clip.clipId)).toEqual(["even-shot-0", "even-shot-1", "even-shot-3"]);
    expect(result.leftOut).toContainEqual({ shotId: "even-shot-2", reason: "didn't fit the length" });
    expect(result.timeline.durationSec).toBeGreaterThanOrEqual(9);
    expect(result.timeline.durationSec).toBeLessThanOrEqual(11);
  });

  it("keeps the directing-comparison speech segments complete under video-share pressure", async () => {
    const fixture = JSON.parse(readFileSync(new URL("./fixtures/speech-boundaries.json", import.meta.url), "utf8")) as {
      segments: Array<{ shotId: string; startSec: number; endSec: number; text: string }>;
    };
    for (const [index, segment] of fixture.segments.entries()) {
      const itemId = `speech-${index}`;
      const shotId = segment.shotId;
      const proposal = makeProposal({
        moments: [{ id: itemId, shotId, kind: "video", previewInSec: segment.startSec, previewOutSec: segment.endSec, title: "Speech", description: "", rationale: "" }],
        chapters: [{ id: "speech-chapter", title: "Speech", summary: "", momentIds: [itemId] }],
        constraints: { excludedShotIds: [], deselectedMomentIds: [], mustIncludeMomentIds: [], feedback: [] },
      });
      const assets = new Map([[itemId, { kind: "video" as const, assetId: shotId, analysis: {
        shots: [{ startSec: segment.startSec, endSec: segment.endSec, description: "Complete spoken sentence", role: "A_ROLL", quality: 1, usable: true }],
        transcript: [{ startSec: segment.startSec, endSec: segment.endSec, text: segment.text }],
      } }]]);
      const candidate = buildCandidates([{ index: 0, itemIds: [itemId] }], assets, holdsFor("reflective"), 6, "reflective").find((entry) => entry.kind === "video" && entry.hasSpeech)!;
      const result = await runCompose(makeJob({ proposal, durationId: "1m", cadenceId: "reflective" }), makeDeps({
        assets,
        generateStructured: async () => ({ clips: [{ candidateId: candidate.candidateId, transition: "crossfade", audio: "keep" }], musicCues: [] }),
      }));
      if (!result.ok) throw new Error(result.reasons.join("; "));
      const clip = result.timeline.videoClips.find((entry) => "source" in entry && entry.source.kind === "video");
      if (!clip || !("source" in clip) || clip.source.kind !== "video") throw new Error("speech clip missing from final timeline");
      expect(clip.source.sourceInSec).toBeLessThanOrEqual(segment.startSec + 0.15);
      expect(clip.source.sourceOutSec).toBeGreaterThanOrEqual(segment.endSec - 0.15);
      expect(clip.durationSec).toBeLessThanOrEqual(8.15);
      expect(clip.transitionIn?.kind).toBe("cut");
    }
  });

  it("keeps all five videos in a 12-second playful Short even when coverage exceeds half the cut", async () => {
    const videoLengths = [6.08, 6, 8.08, 50.05, 6.08];
    const videos = videoLengths.map((length, index) => ({ id: `video-${index}`, shotId: `shot-video-${index}`, kind: "video" as const, previewInSec: 0, previewOutSec: length, title: `Video ${index}`, description: "", rationale: "" }));
    const photos = [0, 1, 2].map((index) => ({ id: `photo-${index}`, shotId: `shot-photo-${index}`, kind: "photo" as const, title: `Photo ${index}`, description: "", rationale: "" }));
    const moments = [...videos, ...photos];
    const proposal = makeProposal({
      moments,
      chapters: [{ id: "all", title: "Day", summary: "", momentIds: moments.map((moment) => moment.id) }],
      constraints: { excludedShotIds: [], deselectedMomentIds: [], mustIncludeMomentIds: [], feedback: [] },
    });
    const assets = new Map(moments.map((moment) => [moment.id, moment.kind === "video"
      ? { kind: "video" as const, assetId: moment.id, analysis: { shots: [{ startSec: 0, endSec: videoLengths[Number(moment.id.split("-")[1])]!, usable: true, highlights: [] }] } }
      : { kind: "photo" as const, assetId: moment.id, analysis: { caption: moment.title } }]));
    const result = await runCompose(makeJob({ proposal, cadenceId: "playful", durationId: "short", durationSec: 12 }), makeDeps({
      assets,
      generateStructured: async () => ({ clips: moments.map((moment) => ({ candidateId: moment.kind === "video" ? `${moment.id}#s0@0.15c0` : `${moment.id}#still@c0`, transition: "cut", audio: "mute", holdSec: 2 })), musicCues: [] }),
    }));
    if (!result.ok) throw new Error(result.reasons.join("; "));
    const clips = result.timeline.videoClips.filter((clip): clip is import("@mosae/contracts").VideoClip => "source" in clip && clip.source.kind === "video");
    expect(clips).toHaveLength(5);
    expect(clips.every((clip) => clip.durationSec >= 2)).toBe(true);
    expect(clips.map((clip) => clip.source.shotId).sort()).toEqual(videos.map((video) => video.shotId).sort());
    expect(result.droppedPicks.some((drop) => drop.includes("video share limit"))).toBe(false);
    expect(clips.reduce((sum, clip) => sum + clip.durationSec, 0) / result.timeline.durationSec).toBeGreaterThan(0.5);
  });
});

// --- Tests ---

describe("runCompose — happy path", () => {
  it.each([
    ["tender", 24],
    ["reflective", 21.6],
    ["playful", 12],
    ["energetic", 12],
    ["celebratory", 14.4],
  ] as const)("composes a 15-second short from three photos at %s pace by clamping to available material", async (cadenceId, maximum) => {
    const moments = ["photo1", "photo2", "photo3"].map((id) => ({ id, shotId: `shot-${id}`, kind: "photo" as const, title: id, description: "", rationale: "" }));
    const proposal = makeProposal({ moments, chapters: [{ id: "ch1", title: "Chapter 1", summary: "", momentIds: moments.map(({ id }) => id) }] });
    const assets = new Map(moments.map(({ id }) => [id, { kind: "photo" as const, analysis: { caption: id } }]));
    const deps = makeDeps({ assets, generateStructured: async () => ({ clips: moments.map(({ id }) => ({ candidateId: `${id}#still@c0`, holdSec: 5, transition: "cut", audio: "mute" })), musicCues: [] }) });

    const result = await runCompose(makeJob({ proposal, durationId: "short", durationSec: 15, cadenceId }), deps);

    if (!result.ok) throw new Error(result.reasons.join("; "));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.timeline.durationSec).toBeLessThanOrEqual(maximum * 1.1);
  });

  it.each([[6, 20], [3, 12]] as const)("matches a client-recommended Short target for %i photos", async (photoCount, recommendedSeconds) => {
    const moments = Array.from({ length: photoCount }, (_, index) => ({ id: `photo${index}`, shotId: `shot-${index}`, kind: "photo" as const, title: `Photo ${index}`, description: "", rationale: "" }));
    const proposal = makeProposal({ moments, chapters: [{ id: "ch1", title: "Trip", summary: "", momentIds: moments.map(({ id }) => id) }], constraints: { excludedShotIds: [], deselectedMomentIds: [], mustIncludeMomentIds: [], feedback: [] } });
    const assets = new Map(moments.map(({ id }, index) => [id, { kind: "photo" as const, analysis: { caption: `Photo ${index}` } }]));
    const result = await runCompose(makeJob({ proposal, durationId: "short", durationSec: recommendedSeconds, cadenceId: "playful", collageAmount: "none" }), makeDeps({
      assets,
      generateStructured: async () => ({ clips: moments.map(({ id }, index) => ({ candidateId: `${id}#still@c0`, holdSec: 1.2, transition: "cut", audio: "mute" })), musicCues: [] }),
    }));
    if (!result.ok) throw new Error(result.reasons.join("; "));
    expect(result.timeline.durationSec).toBeCloseTo(recommendedSeconds, 0);
  });

  it("composes an adaptive short duration within its requested limit", async () => {
    const moments = ["photo1", "photo2", "photo3"].map((id, index) => ({ id, shotId: `shot-${index}`, kind: "photo" as const, title: `Photo ${index}`, description: "", rationale: "" }));
    const proposal = makeProposal({ moments, chapters: [{ id: "ch1", title: "Chapter 1", summary: "", momentIds: moments.map(({ id }) => id) }] });
    const assets = new Map(moments.map(({ id }) => [id, { kind: "photo" as const, analysis: { caption: id } }]));
    const deps = makeDeps({ assets, generateStructured: async () => ({ clips: [{ candidateId: "photo1#still@c0", holdSec: 3, transition: "cut", audio: "mute" }], musicCues: [] }) });
    const result = await runCompose(makeJob({ proposal, durationId: "short", durationSec: 10 }), deps);
    if (!result.ok) throw new Error(result.reasons.join("; "));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.timeline.durationSec).toBeLessThanOrEqual(10);
  });

  it("keeps reflective story locks fixed while fitting a viable Short target", async () => {
    const moments = ["photo1", "photo2", "photo3"].map((id, index) => ({ id, shotId: `shot-${index}`, kind: "photo" as const, title: id, description: "", rationale: "" }));
    const proposal = makeProposal({ moments, chapters: [{ id: "ch1", title: "Chapter 1", summary: "", momentIds: moments.map(({ id }) => id) }] });
    const assets = new Map(moments.map(({ id }) => [id, { kind: "photo" as const, analysis: { caption: id } }]));
    const result = await runCompose(makeJob({ proposal, durationId: "short", durationSec: 9, cadenceId: "reflective" }), makeDeps({
      assets,
      generateStructured: async () => ({ clips: moments.map(({ id }) => ({ candidateId: `${id}#still@c0`, holdSec: 2.2, transition: "cut", audio: "mute" })), musicCues: [] }),
    }));
    if (!result.ok) throw new Error(result.reasons.join("; "));
    const durations = result.timeline.videoClips.map((clip) => clip.durationSec);
    expect(durations[0]).toBe(3.2);
    expect(durations.at(-1)).toBe(4);
    expect(result.timeline.durationSec).toBeGreaterThanOrEqual(8.1);
    expect(result.timeline.durationSec).toBeLessThanOrEqual(9.9);
  });

  it("clamps a short target to the available proposal material", async () => {
    const result = await runCompose(makeJob({ durationId: "short", durationSec: 29 }), makeDeps());
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.timeline.durationSec).toBeLessThanOrEqual(18);
  });

  it("composes a valid Timeline from an accepted proposal", async () => {
    const job = makeJob();
    const deps = makeDeps();

    const result = await runCompose(job, deps);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    const parsed = safeParseTimeline(result.timeline);
    expect(parsed.ok).toBe(true);
  });

  it("soundtrackId null produces a valid film with no music clips", async () => {
    const job = makeJob({ soundtrackId: null });
    const deps = makeDeps();

    const result = await runCompose(job, deps);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    const musicClips = result.timeline.audioClips.filter(a => a.role === "music");
    expect(musicClips.length).toBe(0);
  });
});

describe("runCompose — failure modes", () => {
  it("returns failure when no candidates exist", async () => {
    const job = makeJob();
    const deps = makeDeps({ assets: new Map() });

    const result = await runCompose(job, deps);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.reasons.some(r => r.includes("no legal candidates"))).toBe(true);
  });

  it("includes every eligible proposal asset even when Gemini returns no picks", async () => {
    const job = makeJob();
    const deps = makeDeps({
      generateStructured: vi.fn().mockResolvedValue({ clips: [], musicCues: [] }), // missing required fields
    });

    const result = await runCompose(job, deps);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.reasons.join("; "));
    const included = new Set(result.timeline.videoClips.flatMap((clip) => "kind" in clip ? clip.spec.slots.map((slot) => slot.shotId) : [clip.source.shotId]));
    expect(included.size).toBeGreaterThan(0);
  });

  it("returns failure when every pick is dropped", async () => {
    const job = makeJob();
    const deps = makeDeps({
      generateStructured: vi.fn().mockResolvedValue({
        clips: [
          { candidateId: "nonexistent-id", transition: "cut" as const, audio: "keep" as const },
        ],
        musicCues: [],
      }),
    });

    const result = await runCompose(job, deps);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
  });
});

describe("runCompose — Gemini mock", () => {
  it.each([["parent", "Mum"], ["family", "everyone"], [undefined, "children"]])("sends the selected focus to the compose model (%s)", async (focus, expectedFocus) => {
    const summary = castSummary({ source: "none", confirmed: true, core: [], focus: [], people: [
      { personId: "parent", name: "Mum", role: "parent", ageBand: "adult", subjectCount: 1, appearances: 1, faceIds: [], confidence: "high" },
      { personId: "child", name: "Mia", role: "child", ageBand: "child", subjectCount: 1, appearances: 1, faceIds: [], confidence: "high" },
    ] }, [], new Map(), focus)!;
    const mockGenerate = vi.fn().mockResolvedValue({
      clips: [
        { candidateId: "video1#s0@0.15c0", transition: "cut" as const, audio: "keep" as const },
        { candidateId: "photo1#still@c1", transition: "crossfade" as const, audio: "duck" as const, holdSec: 4 },
      ], musicCues: [],
    });
    await runCompose(makeJob({ cast: { summary, core: [], focus: [], peopleByMoment: new Map(), subjectsByMoment: new Map(), namesById: {} } }), makeDeps({ generateStructured: mockGenerate }));
    expect(mockGenerate.mock.calls[0]?.[0]).toMatchObject({ contents: expect.stringContaining(`Cast: 1 parents, 1 children; focus: ${expectedFocus};`) });
  });

  it("calls generateStructured with the configured model and prices its token usage", async () => {
    const job = makeJob();
    const mockGenerate = vi.fn().mockResolvedValue({
      clips: [
        { candidateId: "video1#s0@0c0", transition: "cut" as const, audio: "keep" as const },
        { candidateId: "photo1#still@c1", transition: "crossfade" as const, audio: "duck" as const, holdSec: 4 },
      ],
      musicCues: [],
    });
    const deps = makeDeps({ generateStructured: mockGenerate });

    await runCompose(job, deps);

    expect(mockGenerate).toHaveBeenCalledOnce();
    const callArgs = mockGenerate.mock.calls[0]!;
    expect(callArgs[0]).toMatchObject({ model: MODELS.compose, stage: "compose" });
    expect(estimateUsd(MODELS.compose, { promptTokens: 100, candidatesTokens: 20, thoughtsTokens: 0 })).toBeGreaterThan(0);
  });
});

describe("runCompose — mode and aspect propagation", () => {
  it("preserves mode in the output timeline", async () => {
    const job = makeJob({ mode: "memory" as const });
    const deps = makeDeps();

    const result = await runCompose(job, deps);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.timeline.mode).toBe("memory");
  });

  it("preserves aspect in the output timeline", async () => {
    const job = makeJob({ aspect: "16:9" as const });
    const deps = makeDeps();

    const result = await runCompose(job, deps);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.timeline.aspect).toBe("16:9");
  });
});

describe("runCompose — person-anchored Ken Burns", () => {
  it("emits no motion when the job has no focus center (byte-identical to pre-focus output)", async () => {
    const job = makeJob({ focusCenter: new Map() });
    const deps = makeDeps();

    const result = await runCompose(job, deps);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");

    const photoClip = result.timeline.videoClips.find((c): c is import("@mosae/contracts").VideoClip => "source" in c && c.source.kind === "photo")!;
    expect(photoClip.motion).toBeUndefined();
  });

  it("anchors a slow-zoom on the focus face's bbox center when present", async () => {
    // Focus face bbox [0.2,0.3,0.5,0.6] → midpoint (cx=0.4, cy=0.35).
    const job = makeJob({
      focusCenter: new Map([["photo1", { cx: 0.4, cy: 0.35 }]]),
    });
    const deps = makeDeps();

    const result = await runCompose(job, deps);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");

    const photoClip = result.timeline.videoClips.find((c): c is import("@mosae/contracts").VideoClip => "source" in c && c.source.kind === "photo")!;
    expect(photoClip.motion).toMatchObject({ kind: "slow-zoom", from: 1 });
    expect((photoClip.motion as { center?: { cx: number; cy: number } }).center).toEqual({ cx: 0.4, cy: 0.35 });
  });

  it("leaves video clips motionless regardless of focus", async () => {
    const job = makeJob({ focusCenter: new Map([["video1", { cx: 0.5, cy: 0.5 }]]) });
    const deps = makeDeps();

    const result = await runCompose(job, deps);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");

    const videoClip = result.timeline.videoClips.find((c): c is import("@mosae/contracts").VideoClip => "source" in c && c.source.kind === "video")!;
    expect(videoClip.motion).toBeUndefined();
  });
});

describe("runCompose — arc ordering after cast guards", () => {
  const arcProposal = makeProposal({
    moments: ["a", "b", "chapter2", "new"].map((id, index) => ({
      id, shotId: `shot-${id}`, kind: "photo" as const, title: id, description: "", rationale: "",
    })),
    chapters: [
      { id: "ch1", title: "Chapter 1", summary: "First chapter", momentIds: ["a", "b", "new"] },
      { id: "ch2", title: "Chapter 2", summary: "Second chapter", momentIds: ["chapter2"] },
    ],
    constraints: { excludedShotIds: [], deselectedMomentIds: [], mustIncludeMomentIds: ["a", "b", "chapter2"], feedback: [] },
  });
  const arcAssets = new Map<string, import("./buildCandidates.js").Asset>(["a", "b", "chapter2"].map((id) => [id, {
    kind: "video" as const, analysis: { shots: [{ startSec: 0, endSec: 12, description: id, usable: true }] },
  }]));
  arcAssets.set("new", { kind: "photo", analysis: { caption: "new" } });
  const arcTimes = new Map([
    ["a", { chapter: 0, localTime: "2026-01-01T08:00:00", score: 0.9 }],
    ["b", { chapter: 0, localTime: "2026-01-01T09:00:00", score: 0.2 }],
    ["chapter2", { chapter: 1, localTime: "2026-01-01T10:00:00", score: 0.5 }],
    ["new", { chapter: 0, localTime: "2026-01-01T08:30:00", score: 0.1 }],
  ]);
  const arcDeps = () => makeDeps({
    assets: arcAssets,
    generateStructured: vi.fn().mockResolvedValue({
      clips: ["a", "b", "chapter2"].map((id) => ({ candidateId: `${id}#s0@0.15c${id === "chapter2" ? 1 : 0}`, transition: "cut" as const, audio: "mute" as const })),
      musicCues: [],
    }),
  });
  const cast = (overrides?: Partial<NonNullable<ComposeJob["cast"]>>) => ({
    summary: "family", core: ["mom"], focus: [], peopleByMoment: new Map<string, Set<string>>(),
    subjectsByMoment: new Map<string, Set<string>>(), namesById: { mom: "Mom" }, ...overrides,
  });

  it("preserves the per chapter peak order when cast guards make no swaps", async () => {
    const result = await runCompose(makeJob({
      proposal: arcProposal, cast: cast({ peopleByMoment: new Map(["a", "b", "chapter2"].map((id) => [id, new Set(["mom", "dad"])])) }),
      chapterOf: new Map([["a", 0], ["b", 0], ["chapter2", 1], ["new", 0]]), timeOf: arcTimes,
    }), arcDeps());
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.timeline.videoClips.map((clip) => "id" in clip ? clip.id : clip.clipId)).toEqual(["a#s0@0.15c0", "new#still@c0", "b#s0@0.15c0", "chapter2#s0@0.15c1"]);
    expect(result.droppedPicks).not.toContain("b: video share limit");
  });

  it("orders a cast replacement by time while keeping the chapter peak last", async () => {
    const result = await runCompose(makeJob({
      proposal: arcProposal, cast: cast({ peopleByMoment: new Map([["a", new Set(["dad"])], ["b", new Set(["dad"])], ["chapter2", new Set(["dad"])], ["new", new Set(["mom"])]]), subjectsByMoment: new Map([["new", new Set(["mom"]) ]]) }),
      chapterOf: new Map([["a", 0], ["b", 0], ["chapter2", 1], ["new", 0]]), timeOf: arcTimes,
    }), arcDeps());
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.timeline.videoClips.map((clip) => "id" in clip ? clip.id : clip.clipId)).toEqual(["a#s0@0.15c0", "new#still@c0", "b#s0@0.15c0", "chapter2#s0@0.15c1"]);
  });
});
