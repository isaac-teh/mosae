import { describe, it, expect } from "vitest";
import { reflow, quantize, type ClipPlan } from "./reflow.js";

const fps = 30;

function makeClip(overrides: Partial<ClipPlan> = {}): ClipPlan {
  return {
    // A fixed default, not a random one: a fixture that rolls its own ids
    // cannot be snapshotted and makes a determinism test weaker than it reads.
    id: "clip",
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
  it("a leading crossfade clamps to 0 rather than going negative", () => {
    const plans = [makeClip({ durationSec: 5, transitionIn: { kind: "crossfade" as const, durationSec: 1 } })];
    const result = reflow({ plans, fps, chapters: makeChapters() });

    expect(result.clips[0].startSec).toBeCloseTo(0);
  });

  it("an overlap longer than everything before it clamps to 0", () => {
    const plans = [
      makeClip({ id: "clip1", durationSec: 2, transitionIn: { kind: "cut" as const, durationSec: 0 } }),
      makeClip({ id: "clip2", durationSec: 4, transitionIn: { kind: "crossfade" as const, durationSec: 5 } }),
    ];
    const result = reflow({ plans, fps, chapters: makeChapters() });

    // 2 - 5 is negative; the clip starts at 0 instead.
    expect(result.clips[1].startSec).toBeCloseTo(0);
  });

  it("each clip's own transitionIn governs the boundary it arrives on", () => {
    // `transitionIn` is the transition INTO a clip. Clip N's declaration
    // governs the boundary between N-1 and N; a predecessor's declaration
    // governs the boundary before it, not the one after.
    const plans = [
      makeClip({ id: "clip1", durationSec: 5, transitionIn: { kind: "cut" as const, durationSec: 0 } }),
      makeClip({ id: "clip2", durationSec: 4, transitionIn: { kind: "crossfade" as const, durationSec: 1 } }),
      makeClip({ id: "clip3", durationSec: 3, transitionIn: { kind: "cut" as const, durationSec: 0 } }),
    ];
    const result = reflow({ plans, fps, chapters: makeChapters() });

    expect(result.clips[0].startSec).toBeCloseTo(0);
    // Clip 2 declares the crossfade, so clip 2 is the one pulled back: 5 - 1.
    expect(result.clips[1].startSec).toBeCloseTo(4);
    // Clip 3 declares a cut, so it sits flush after clip 2 — clip 2's crossfade
    // is not applied a second time at the following boundary.
    expect(result.clips[2].startSec).toBeCloseTo(8);
    expect(result.durationSec).toBeCloseTo(11);
  });

  it("three crossfades in a row accumulate overlap correctly", () => {
    const transitionDuration = 1; // 1 second crossfade
    const plans = [
      makeClip({ id: "clip1", durationSec: 5, transitionIn: { kind: "cut" as const, durationSec: 0 } }),
      makeClip({ id: "clip2", durationSec: 4, transitionIn: { kind: "crossfade" as const, durationSec: transitionDuration } }),
      makeClip({ id: "clip3", durationSec: 3, transitionIn: { kind: "crossfade" as const, durationSec: transitionDuration } }),
      makeClip({ id: "clip4", durationSec: 2, transitionIn: { kind: "crossfade" as const, durationSec: transitionDuration } }),
    ];
    const result = reflow({ plans, fps, chapters: makeChapters() });

    expect(result.clips[0].startSec).toBeCloseTo(0);
    expect(result.clips[1].startSec).toBeCloseTo(4); // 0 + 5 - 1
    expect(result.clips[2].startSec).toBeCloseTo(7); // 4 + 4 - 1
    expect(result.clips[3].startSec).toBeCloseTo(9); // 7 + 3 - 1

    // 5 + 4 + 3 + 2 = 14 of material, less three 1s overlaps = 11.
    expect(result.durationSec).toBeCloseTo(11);
  });

  it("the last clip's transition is applied, not dropped", () => {
    const plans = [
      makeClip({ id: "clip1", durationSec: 5, transitionIn: { kind: "cut" as const, durationSec: 0 } }),
      makeClip({ id: "clip2", durationSec: 4, transitionIn: { kind: "crossfade" as const, durationSec: 2 } }),
    ];
    const result = reflow({ plans, fps, chapters: makeChapters() });

    expect(result.clips[1].startSec).toBeCloseTo(3); // 5 - 2
    expect(result.durationSec).toBeCloseTo(7);
  });

  it("crossfade overlap is subtracted exactly once", () => {
    const plans = [
      makeClip({ id: "clip1", durationSec: 5, transitionIn: { kind: "cut" as const, durationSec: 0 } }),
      makeClip({ id: "clip2", durationSec: 4, transitionIn: { kind: "crossfade" as const, durationSec: 2 } }),
      makeClip({ id: "clip3", durationSec: 4, transitionIn: { kind: "cut" as const, durationSec: 0 } }),
    ];
    const result = reflow({ plans, fps, chapters: makeChapters() });

    expect(result.clips[0].startSec).toBeCloseTo(0);
    expect(result.clips[1].startSec).toBeCloseTo(3);
    // The 2s overlap is taken at clip 2's boundary and nowhere else.
    expect(result.clips[2].startSec).toBeCloseTo(7);
    expect(result.durationSec).toBeCloseTo(11);
  });

  it("a dip does not overlap", () => {
    const plans = [
      makeClip({ id: "clip1", durationSec: 5, transitionIn: { kind: "cut" as const, durationSec: 0 } }),
      makeClip({ id: "clip2", durationSec: 4, transitionIn: { kind: "dip" as const, durationSec: 0.3 } }),
    ];
    const result = reflow({ plans, fps, chapters: makeChapters() });

    expect(result.clips[1].startSec).toBeCloseTo(5);
    expect(result.durationSec).toBeCloseTo(9);
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

describe("frame boundaries", () => {
  it("quantizes durations as well as starts", () => {
    // A hold the duration fit produced, such as 5.75s, is 172.5 frames at 30fps.
    // Leaving it unrounded lets the Player and the renderer resolve the clip to
    // different frame counts, which is precisely the drift one shared
    // composition exists to prevent.
    const plans = [
      makeClip({ id: "clip1", durationSec: 5.75 }),
      makeClip({ id: "clip2", durationSec: 2.01 }),
    ];

    const result = reflow({ plans, fps, chapters: makeChapters() });

    for (const clip of result.clips) {
      expect(Number.isInteger(Math.round(clip.durationSec * fps * 1e6) / 1e6)).toBe(true);
      expect(Number.isInteger(Math.round(clip.startSec * fps * 1e6) / 1e6)).toBe(true);
    }
    expect(Number.isInteger(Math.round(result.durationSec * fps * 1e6) / 1e6)).toBe(true);
  });
});

describe("reflow chapter starts with a partial cut", () => {
  it("starts each chapter at its first kept clip and drops chapters with none", () => {
    const plan = (id: string, momentId: string) => ({ id, momentId, source: {}, durationSec: 3, transitionIn: { kind: "cut" as const, durationSec: 0 }, strength: 0, minHoldSec: 0, maxHoldSec: Infinity });
    const result = reflow({
      fps: 30,
      plans: [plan("c1", "m1"), plan("c2", "m4"), plan("c3", "m6")],
      chapters: [
        { id: "d1", title: "Day 1", summary: "", momentIds: ["m1", "m2", "m3"] },
        { id: "d2", title: "Day 2", summary: "", momentIds: ["m4", "m5"] },
        { id: "d3", title: "Day 3", summary: "", momentIds: ["m6"] },
        { id: "d4", title: "Day 4", summary: "", momentIds: ["m7"] },
      ],
    });
    expect(result.chapters.map((c) => [c.title, c.startSec])).toEqual([["Day 1", 0], ["Day 2", 3], ["Day 3", 6]]);
  });
});
