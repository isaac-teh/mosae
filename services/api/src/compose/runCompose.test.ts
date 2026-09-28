import { describe, it, expect, vi } from "vitest";
import { runCompose, type ComposeJob, type ComposeDeps } from "./runCompose.js";
import { safeParseTimeline } from "@mosae/contracts";

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
  it("adds the cast summary to the compose prompt when present", async () => {
    const mockGenerate = vi.fn().mockResolvedValue({
      clips: [
        { candidateId: "video1#s0@0.15c0", transition: "cut" as const, audio: "keep" as const },
        { candidateId: "photo1#still@c1", transition: "crossfade" as const, audio: "duck" as const, holdSec: 4 },
      ], musicCues: [],
    });
    await runCompose(makeJob({ cast: { summary: "2 parents, 1 child", core: [], focus: [], peopleByMoment: new Map(), subjectsByMoment: new Map(), namesById: {} } }), makeDeps({ generateStructured: mockGenerate }));
    expect(mockGenerate.mock.calls[0]?.[0]).toMatchObject({ contents: expect.stringContaining("Cast: 2 parents") });
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

    const photoClip = result.timeline.videoClips.find((c) => c.source.kind === "photo")!;
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

    const photoClip = result.timeline.videoClips.find((c) => c.source.kind === "photo")!;
    expect(photoClip.motion).toMatchObject({ kind: "slow-zoom", from: 1 });
    expect((photoClip.motion as { center?: { cx: number; cy: number } }).center).toEqual({ cx: 0.4, cy: 0.35 });
  });

  it("leaves video clips motionless regardless of focus", async () => {
    const job = makeJob({ focusCenter: new Map([["video1", { cx: 0.5, cy: 0.5 }]]) });
    const deps = makeDeps();

    const result = await runCompose(job, deps);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");

    const videoClip = result.timeline.videoClips.find((c) => c.source.kind === "video")!;
    expect(videoClip.motion).toBeUndefined();
  });
});
