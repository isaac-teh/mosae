import { describe, it, expect, vi } from "vitest";
import { runCompose, applyUserOrder, type ComposeJob, type ComposeDeps } from "./runCompose.js";
import { castSummary } from "../cast/castSummary.js";
import { safeParseTimeline } from "@mosae/contracts";

describe("applyUserOrder", () => {
  const clips = ["m1", "m2", "m3"].map((itemId) => ({ itemId }));
  const chapterOf = new Map([["m1", 1], ["m2", 1], ["m3", 2]]);
  it("reorders within a chapter only", () => {
    expect(applyUserOrder(clips, ["m2", "m1", "m3"], chapterOf).map((c) => c.itemId)).toEqual(["m2", "m1", "m3"]);
    expect(applyUserOrder(clips, ["m3", "m1", "m2"], chapterOf).map((c) => c.itemId)).toEqual(["m1", "m2", "m3"]);
  });
  it("no order leaves clips unchanged", () => expect(applyUserOrder(clips, undefined, chapterOf)).toEqual(clips));
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
    expect(result.timeline.videoClips.filter((clip) => "kind" in clip)).toHaveLength(1);
    expect(result.timeline.durationSec).toBeGreaterThanOrEqual(27);
    expect(result.timeline.durationSec).toBeLessThanOrEqual(33);
    expect(safeParseTimeline(result.timeline).ok).toBe(true);
  });

  it.each([
    { durationId: "30s" as const, cadenceId: "playful" as const, minimum: 27, maximum: 33 },
    { durationId: "1m" as const, cadenceId: "reflective" as const, minimum: 54, maximum: 66 },
  ])("fills a $durationId film from kept proposal photos when the model under-selects clips", async ({ durationId, cadenceId, minimum, maximum }) => {
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
    expect(result.timeline.durationSec).toBeGreaterThanOrEqual(minimum);
    expect(result.timeline.durationSec).toBeLessThanOrEqual(maximum);
    expect(result.timeline.videoClips.flatMap((clip) => "kind" in clip ? clip.spec.slots.map((slot) => slot.shotId) : [clip.source.shotId])).not.toContain("shot-3");
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

// --- Tests ---

describe("runCompose — happy path", () => {
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

  it("returns failure when model response is invalid", async () => {
    const job = makeJob();
    const deps = makeDeps({
      generateStructured: vi.fn().mockResolvedValue({ clips: [], musicCues: [] }), // missing required fields
    });

    const result = await runCompose(job, deps);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
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

  it("calls generateStructured with the correct model and stage", async () => {
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
    expect(callArgs[0]).toMatchObject({ model: "gemini-2.5-flash", stage: "compose" });
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
    expect(result.timeline.videoClips.map((clip) => "id" in clip ? clip.id : clip.clipId)).toEqual(["b#s0@0.15c0", "a#s0@0.15c0", "chapter2#s0@0.15c1"]);
  });

  it("orders a cast replacement by time while keeping the chapter peak last", async () => {
    const result = await runCompose(makeJob({
      proposal: arcProposal, cast: cast({ peopleByMoment: new Map([["a", new Set(["dad"])], ["b", new Set(["dad"])], ["chapter2", new Set(["dad"])], ["new", new Set(["mom"])]]), subjectsByMoment: new Map([["new", new Set(["mom"]) ]]) }),
      chapterOf: new Map([["a", 0], ["b", 0], ["chapter2", 1], ["new", 0]]), timeOf: arcTimes,
    }), arcDeps());
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.timeline.videoClips.map((clip) => "id" in clip ? clip.id : clip.clipId)).toEqual(["new#still@c0", "a#s0@0.15c0", "chapter2#s0@0.15c1"]);
  });
});
