import { describe, it, expect } from "vitest";
import { reflow, quantize, type ClipPlan } from "./reflow.js";

const fps = 30;

function makeClip(overrides: Partial<ClipPlan> = {}): ClipPlan {
  return {
    id: `clip-${Math.random().toString(36).slice(2)}`,
    source: { kind: "photo" as const, shotId: "shot1" },
    durationSec: 5,
    transitionIn: { kind: "cut", durationSec: 0 },
    strength: 1,
    minHoldSec: 2,
    maxHoldSec: 8,
    ...overrides,
  };
}

function makeChapters(): { id: string; title: string; summary: string; momentIds: string[] }[] {
  return [
    { id: "ch1", title: "Intro", summary: "", momentIds: ["m1"] },
    { id: "ch2", title: "Body", summary: "", momentIds: ["m2", "m3"] },
  ];
}

describe("quantize", () => {
  it("rounds to nearest frame at 30fps", () => {
    expect(quantize(1 / 30, 30)).toBeCloseTo(1 / 30);
    expect(quantize(2 / 30, 30)).toBeCloseTo(2 / 30);
    expect(quantize(0.5, 30)).toBeCloseTo(0.5); // exactly 15 frames
  });

  it("rounds up when closer to next frame", () => {
    const result = quantize(0.047, 30); // ~1.4 frames → rounds to 1/30 ≈ 0.033
    expect(result).toBeCloseTo(1 / 30);
  });

  it("rounds down when closer to previous frame", () => {
    const result = quantize(0.067, 30); // ~2.0 frames → rounds to 2/30 ≈ 0.067
    expect(result).toBeCloseTo(2 / 30);
  });

  it("handles zero correctly", () => {
    expect(quantize(0, 30)).toBe(0);
  });
});

describe("reflow — single clip", () => {
  it("produces a film of exactly that length for a single clip", () => {
    const plans = [makeClip({ durationSec: 5 })];
    const result = reflow({ plans, fps, chapters: makeChapters() });

    expect(result.clips.length).toBe(1);
    expect(result.durationSec).toBeCloseTo(5);
    expect(result.clips[0].startSec).toBeCloseTo(0);
  });
});

describe("reflow — multiple clips with cuts", () => {
  it("accumulates duration correctly for sequential cuts", () => {
    const plans = [
      makeClip({ id: "clip1", durationSec: 5 }),
      makeClip({ id: "clip2", durationSec: 3 }),
      makeClip({ id: "clip3", durationSec: 4 }),
    ];
    const result = reflow({ plans, fps, chapters: makeChapters() });

    expect(result.clips.length).toBe(3);
    expect(result.clips[0].startSec).toBeCloseTo(0);
    expect(result.clips[1].startSec).toBeCloseTo(5);
    expect(result.clips[2].startSec).toBeCloseTo(8);
    expect(result.durationSec).toBeCloseTo(12); // 5 + 3 + 4
  });

  it("every emitted time is an exact multiple of 1/30", () => {
    const plans = [
      makeClip({ durationSec: 5.1 }),
      makeClip({ durationSec: 3.7 }),
    ];
    const result = reflow({ plans, fps, chapters: makeChapters() });

    for (const clip of result.clips) {
      expect(clip.startSec * 30).toBeCloseTo(Math.round(clip.startSec * 30));
    }
    expect(result.durationSec * 30).toBeCloseTo(Math.round(result.durationSec * 30));
  });
});

describe("reflow — crossfades", () => {
  it("a single leading crossfade clamps to 0 rather than going negative", () => {
    const plans = [makeClip({ durationSec: 5, transitionIn: { kind: "crossfade" as const, durationSec: 1 } })];
    const result = reflow({ plans, fps, chapters: makeChapters() });

    expect(result.clips[0].startSec).toBeCloseTo(0);
  });

  it("three crossfades in a row accumulate overlap correctly", () => {
    const transitionDuration = 1; // 1 second crossfade
    const plans = [
      makeClip({ id: "clip1", durationSec: 5, transitionIn: { kind: "crossfade" as const, durationSec: transitionDuration } }),
      makeClip({ id: "clip2", durationSec: 4, transitionIn: { kind: "crossfade" as const, durationSec: transitionDuration } }),
      makeClip({ id: "clip3", durationSec: 3, transitionIn: { kind: "cut" as const, durationSec: 0 } }),
    ];
    const result = reflow({ plans, fps, chapters: makeChapters() });

    // Clip 1 starts at 0
    expect(result.clips[0].startSec).toBeCloseTo(0);

    // Clip 2 starts at 5 - 1 = 4 (crossfade overlap from clip 1)
    expect(result.clips[1].startSec).toBeCloseTo(4);

    // Clip 3 starts at 4 + 4 - 1 = 7 (clip 2 has crossfade with duration 1, so overlap applies)
    expect(result.clips[2].startSec).toBeCloseTo(7);

    // Total duration: 7 + 3 = 10 seconds
    expect(result.durationSec).toBeCloseTo(10);
  });

  it("crossfade overlap is subtracted exactly once", () => {
    const plans = [
      makeClip({ id: "clip1", durationSec: 5, transitionIn: { kind: "crossfade" as const, durationSec: 2 } }),
      makeClip({ id: "clip2", durationSec: 4, transitionIn: { kind: "cut" as const, durationSec: 0 } }),
    ];
    const result = reflow({ plans, fps, chapters: makeChapters() });

    // Clip 1 starts at 0
    expect(result.clips[0].startSec).toBeCloseTo(0);

    // Clip 2 starts at 5 - 2 = 3 (crossfade overlap from clip 1's transition)
    expect(result.clips[1].startSec).toBeCloseTo(3);

    // Total: 3 + 4 = 7 seconds (overlap applied because clip 1 is crossfade)
    expect(result.durationSec).toBeCloseTo(7);
  });
});

describe("reflow — chapter starts", () => {
  it("chapter starts match their first clip", () => {
    const plans = [
      makeClip({ id: "clip1", durationSec: 5 }), // ch1 moment m1
      makeClip({ id: "clip2", durationSec: 3 }), // ch2 moment m2
      makeClip({ id: "clip3", durationSec: 4 }), // ch2 moment m3
    ];
    const chapters = [
      { id: "ch1", title: "Intro", summary: "", momentIds: ["m1"] },
      { id: "ch2", title: "Body", summary: "", momentIds: ["m2", "m3"] },
    ];
    const result = reflow({ plans, fps, chapters });

    expect(result.chapters.length).toBe(2);
    expect(result.chapters[0].startSec).toBeCloseTo(0); // first clip of ch1
    expect(result.chapters[1].startSec).toBeCloseTo(5); // first clip of ch2 (clip2)
  });

  it("empty plans produce empty result", () => {
    const result = reflow({ plans: [], fps, chapters: makeChapters() });

    expect(result.clips.length).toBe(0);
    expect(result.durationSec).toBe(0);
    expect(result.chapters.length).toBe(0);
  });
});

describe("determinism", () => {
  it("two identical runs are deeply equal", () => {
    const plans = [
      makeClip({ id: "clip1", durationSec: 5 }),
      makeClip({ id: "clip2", durationSec: 3, transitionIn: { kind: "crossfade" as const, durationSec: 1 } }),
    ];
    const chapters = makeChapters();

    const result1 = reflow({ plans, fps, chapters });
    const result2 = reflow({ plans, fps, chapters });

    expect(result1).toEqual(result2);
  });
});
