import { describe, it, expect } from "vitest";
import { validateTimeline, repairOnce, type TimelineIssue, type ValidationContext } from "./validateTimeline.js";
import type { Timeline, VideoClip, AudioClip } from "@mosae/contracts";

function makeCtx(overrides?: Partial<ValidationContext>): ValidationContext {
  // Keyed by candidate id, which is also the Timeline clip id. `shotId` is the
  // shot the renderer resolves and is deliberately a different value, so a
  // lookup that confused the two would fail this fixture rather than pass it.
  const candidates = new Map<string, any>([
    ["cand-photo-1", { candidateId: "cand-photo-1", itemId: "photo-1", kind: "photo" as const, inSec: undefined, outSec: undefined, minHoldSec: 2, maxHoldSec: 6 }],
    ["cand-photo-1b", { candidateId: "cand-photo-1b", itemId: "photo-1", kind: "photo" as const, inSec: undefined, outSec: undefined, minHoldSec: 2, maxHoldSec: 6 }],
    ["cand-video-1", { candidateId: "cand-video-1", itemId: "video-1", kind: "video" as const, inSec: 0, outSec: 10, minHoldSec: undefined, maxHoldSec: undefined }],
    ["cand-photo-2", { candidateId: "cand-photo-2", itemId: "photo-2", kind: "photo" as const, inSec: undefined, outSec: undefined, minHoldSec: 2, maxHoldSec: 6 }],
  ]);

  const assets = new Map<string, any>([
    ["video-1", { kind: "video" as const, analysis: { shots: [{ id: "shot-video-1" }] } }],
    ["photo-1", { kind: "photo" as const }],
    ["photo-2", { kind: "photo" as const }],
  ]);

  return {
    chapters: [{ index: 0, itemIds: ["video-1", "photo-1"] }], // photo-2 is NOT in accepted chapter
    assets,
    candidates,
    soundtrackIds: new Set(["soundtrack-1"]),
    ...overrides,
  };
}

function makeTimeline(overrides?: Partial<Timeline>): Timeline {
  return {
    schemaVersion: 1,
    projectId: "proj-1",
    mode: "creator" as const,
    aspect: "9:16" as const,
    fps: 30,
    durationSec: 4, // default: single photo clip at 4s — matches the default videoClips below
    chapters: [{ title: "Chapter 1", startSec: 0 }],
    videoClips: [
      {
        id: "cand-photo-1",
        source: { kind: "photo" as const, shotId: "shot-photo-1" },
        startSec: 0,
        durationSec: 4,
        transitionIn: { kind: "cut" as const, durationSec: 0 },
      } as VideoClip,
    ],
    audioClips: [] as AudioClip[],
    captions: [],
    ...overrides,
  };
}

describe("validateTimeline — semantic rules", () => {
  it("a shot from a deselected moment fails fatally", () => {
    const ctx = makeCtx(); // photo-2 is NOT in accepted chapter itemIds
    const timeline = makeTimeline({
      videoClips: [
        {
          id: "cand-photo-2",
          source: { kind: "photo" as const, shotId: "shot-photo-2" },
          startSec: 0,
          durationSec: 4,
          transitionIn: { kind: "cut" as const, durationSec: 0 },
        } as VideoClip,
      ],
    });

    const issues = validateTimeline(timeline, ctx);

    expect(issues.length).toBeGreaterThan(0);
    expect(issues.some(i => i.severity === "fatal")).toBe(true);
    expect(issues.some(i => i.message.includes("deselected"))).toBe(true);
  });

  it("a range outside its shot fails as fixable", () => {
    const ctx = makeCtx();
    const timeline = makeTimeline({
      videoClips: [
        {
          id: "cand-video-1",
          source: { kind: "video" as const, shotId: "shot-video-1", sourceInSec: 0, sourceOutSec: 15 }, // exceeds shot's outSec=10
          startSec: 0,
          durationSec: 4,
          transitionIn: { kind: "cut" as const, durationSec: 0 },
        } as VideoClip,
      ],
    });

    const issues = validateTimeline(timeline, ctx);

    expect(issues.some(i => i.message.includes("outside shot"))).toBe(true);
    expect(issues.some(i => i.severity === "fixable")).toBe(true);
  });

  it("a gap between clips fails as fixable", () => {
    const ctx = makeCtx();
    const timeline = makeTimeline({
      videoClips: [
        {
          id: "cand-photo-1",
          source: { kind: "photo" as const, shotId: "shot-photo-1" },
          startSec: 0,
          durationSec: 4,
          transitionIn: { kind: "cut" as const, durationSec: 0 },
        } as VideoClip,
        {
          id: "cand-photo-1b",
          source: { kind: "photo" as const, shotId: "shot-photo-1" },
          startSec: 8, // gap of 0s (4+4=8, so no gap) — wait, let me use a bigger gap
          durationSec: 4,
          transitionIn: { kind: "cut" as const, durationSec: 0 },
        } as VideoClip,
      ],
    });

    const issues = validateTimeline(timeline, ctx);

    expect(issues.some(i => i.message.includes("gap"))).toBe(true);
    expect(issues.some(i => i.severity === "fixable")).toBe(true);
  });

  it("photo hold outside cadence bounds fails as fixable", () => {
    const ctx = makeCtx();
    const timeline = makeTimeline({
      videoClips: [
        {
          id: "cand-photo-1",
          source: { kind: "photo" as const, shotId: "shot-photo-1" },
          startSec: 0,
          durationSec: 8, // exceeds maxHoldSec=6
          transitionIn: { kind: "cut" as const, durationSec: 0 },
        } as VideoClip,
      ],
    });

    const issues = validateTimeline(timeline, ctx);

    expect(issues.some(i => i.message.includes("outside bounds"))).toBe(true);
    expect(issues.some(i => i.severity === "fixable")).toBe(true);
  });

  it("unknown assetId fails fatally", () => {
    const ctx = makeCtx();
    const timeline = makeTimeline({
      audioClips: [
        {
          id: "audio-1",
          source: { kind: "asset" as const, assetId: "unknown-asset", sourceInSec: 0, sourceOutSec: 4 },
          role: "speech" as const,
          startSec: 0,
          gainDb: 0,
          fadeInSec: 0.5,
          fadeOutSec: 0.5,
        } as AudioClip,
      ],
    });

    const issues = validateTimeline(timeline, ctx);

    expect(issues.some(i => i.message.includes("unknown asset"))).toBe(true);
    expect(issues.some(i => i.severity === "fatal")).toBe(true);
  });

  it("unknown soundtrackId fails fatally", () => {
    const ctx = makeCtx();
    const timeline = makeTimeline({
      audioClips: [
        {
          id: "audio-1",
          source: { kind: "soundtrack" as const, soundtrackId: "unknown-soundtrack", sourceInSec: 0, sourceOutSec: 4 },
          role: "music" as const,
          startSec: 0,
          gainDb: -6,
          fadeInSec: 1,
          fadeOutSec: 1,
        } as AudioClip,
      ],
    });

    const issues = validateTimeline(timeline, ctx);

    expect(issues.some(i => i.message.includes("unknown soundtrack"))).toBe(true);
    expect(issues.some(i => i.severity === "fatal")).toBe(true);
  });

  it("a valid timeline returns no issues", () => {
    const ctx = makeCtx();
    const timeline = makeTimeline({
      videoClips: [
        {
          id: "cand-photo-1",
          source: { kind: "photo" as const, shotId: "shot-photo-1" },
          startSec: 0,
          durationSec: 4, // within bounds [2,6]
          transitionIn: { kind: "cut" as const, durationSec: 0 },
        } as VideoClip,
      ],
    });

    const issues = validateTimeline(timeline, ctx);

    expect(issues.length).toBe(0);
  });
});

describe("repairOnce — deterministic fixes", () => {
  it("a repairable film passes on the second pass", () => {
    const ctx = makeCtx();
    // Photo hold exceeds maxHoldSec=6, which is fixable
    const timeline = makeTimeline({
      videoClips: [
        {
          id: "cand-photo-1",
          source: { kind: "photo" as const, shotId: "shot-photo-1" },
          startSec: 0,
          durationSec: 8, // exceeds maxHoldSec=6
          transitionIn: { kind: "cut" as const, durationSec: 0 },
        } as VideoClip,
      ],
    });

    const issues = validateTimeline(timeline, ctx);
    expect(issues.some(i => i.severity === "fixable")).toBe(true);

    const repaired = repairOnce(timeline, issues, ctx);
    if (!repaired.ok) throw new Error("expected repair to succeed");

    // Second pass should have no issues (hold was clamped to maxHoldSec=6)
    const secondIssues = validateTimeline(repaired.timeline, ctx);
    expect(secondIssues.length).toBe(0);
  });

  it("an unrepairable film returns reasons and does not throw", () => {
    const ctx = makeCtx(); // photo-2 is NOT in accepted chapter
    const timeline = makeTimeline({
      videoClips: [
        {
          id: "cand-photo-2",
          source: { kind: "photo" as const, shotId: "shot-photo-2" }, // deselected moment → fatal
          startSec: 0,
          durationSec: 4,
          transitionIn: { kind: "cut" as const, durationSec: 0 },
        } as VideoClip,
      ],
    });

    const issues = validateTimeline(timeline, ctx);
    expect(issues.some(i => i.severity === "fatal")).toBe(true);

    const repaired = repairOnce(timeline, issues, ctx);
    expect(repaired.ok).toBe(false);
    if (!repaired.ok) {
      expect(repaired.reasons.length).toBeGreaterThan(0);
    }
  });

  it("drops clips with ranges outside their shot bounds", () => {
    const ctx = makeCtx();
    const timeline = makeTimeline({
      videoClips: [
        {
          id: "cand-video-1",
          source: { kind: "video" as const, shotId: "shot-video-1", sourceInSec: 0, sourceOutSec: 20 }, // exceeds shot's outSec=10
          startSec: 0,
          durationSec: 4,
          transitionIn: { kind: "cut" as const, durationSec: 0 },
        } as VideoClip,
      ],
    });

    const issues = validateTimeline(timeline, ctx);
    expect(issues.some(i => i.message.includes("outside shot"))).toBe(true);

    const repaired = repairOnce(timeline, issues, ctx);
    expect(repaired.ok).toBe(true);
    // The illegal clip should be dropped
    if (repaired.ok) {
      expect(repaired.timeline.videoClips.length).toBe(0);
    }
  });

  it("reflows clip positions to be contiguous", () => {
    const ctx = makeCtx();
    const timeline = makeTimeline({
      videoClips: [
        {
          id: "cand-photo-1",
          source: { kind: "photo" as const, shotId: "shot-photo-1" },
          startSec: 0,
          durationSec: 4,
          transitionIn: { kind: "cut" as const, durationSec: 0 },
        } as VideoClip,
        {
          id: "cand-photo-1b",
          source: { kind: "photo" as const, shotId: "shot-photo-1" },
          startSec: 8, // gap of 0s (4+4=8) — actually no gap here
          durationSec: 4,
          transitionIn: { kind: "cut" as const, durationSec: 0 },
        } as VideoClip,
      ],
    });

    const issues = validateTimeline(timeline, ctx);
    // There should be a gap issue (8 - (0+4) = 4s gap)
    expect(issues.some(i => i.message.includes("gap"))).toBe(true);

    const repaired = repairOnce(timeline, issues, ctx);
    expect(repaired.ok).toBe(true);
    if (repaired.ok) {
      // Clip positions should be contiguous: clip-1 at 0-4s, clip-2 at 4-8s
      expect(repaired.timeline.videoClips[0]!.startSec).toBe(0);
      expect(repaired.timeline.videoClips[1]!.startSec).toBe(4);
    }
  });

  it("no issues returns the original timeline unchanged", () => {
    const ctx = makeCtx();
    const timeline = makeTimeline({
      videoClips: [
        {
          id: "cand-photo-1",
          source: { kind: "photo" as const, shotId: "shot-photo-1" },
          startSec: 0,
          durationSec: 4,
          transitionIn: { kind: "cut" as const, durationSec: 0 },
        } as VideoClip,
      ],
    });

    const issues = validateTimeline(timeline, ctx);
    expect(issues.length).toBe(0);

    const repaired = repairOnce(timeline, issues, ctx);
    expect(repaired.ok).toBe(true);
    if (repaired.ok) {
      expect(repaired.timeline.videoClips[0]!.durationSec).toBe(4);
    }
  });
});
