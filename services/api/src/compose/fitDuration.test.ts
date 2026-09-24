import { describe, it, expect } from "vitest";
import { fitDuration, type FitResult } from "./fitDuration.js";
import type { AssembledClip } from "./assemble.js";

const holds = { base: 3.5, min: 2, max: 6 };

function makePhotoClip(id: string, holdSec: number): AssembledClip {
  return {
    candidateId: `cand-${id}`,
    itemId: id,
    kind: "photo" as const,
    chapterIndex: 0,
    description: `${id} photo`,
    order: 1,
    transition: "cut" as const,
    audio: "keep" as const,
    holdSec,
  };
}

function makeVideoClip(id: string, inSec: number, outSec: number, hasSpeech = false): AssembledClip {
  return {
    candidateId: `cand-${id}`,
    itemId: id,
    kind: "video" as const,
    chapterIndex: 0,
    description: `${id} video`,
    order: 1,
    transition: "cut" as const,
    audio: "keep" as const,
    sourceInSec: inSec,
    sourceOutSec: outSec,
    hasSpeech,
  };
}

describe("fitDuration — photo holds", () => {
  it("a film 40% over target comes back inside 10%", () => {
    const clips = [
      makePhotoClip("photo1", 6),
      makePhotoClip("photo2", 6),
      makePhotoClip("photo3", 6),
    ];
    const targetSec = 9; // total is 18, drift is +9 (50% over)

    const result = fitDuration(clips, targetSec, holds);

    expect(result.clips.length).toBe(3);
    const total = result.clips.reduce((sum, c) => sum + (c.holdSec ?? 0), 0);
    expect(total).toBeLessThanOrEqual(targetSec * 1.1); // within 10%
    expect(total).toBeGreaterThanOrEqual(targetSec * 0.9);
  });

  it("a must-include keeps its full hold while ordinary clips shrink", () => {
    const clips = [
      makePhotoClip("must1", 3),
      makePhotoClip("ordinary1", 4),
      makePhotoClip("ordinary2", 4),
      makePhotoClip("ordinary3", 4),
    ];
    const targetSec = 9;

    const result = fitDuration(clips, targetSec, holds, ["must1"]);

    expect(result.clips[0]!.holdSec).toBe(3); // must-include preserved
    const total = result.clips.reduce((sum, c) => sum + (c.holdSec ?? 0), 0);
    expect(total).toBeLessThanOrEqual(targetSec * 1.1);
    expect(total).toBeGreaterThanOrEqual(targetSec * 0.9);
  });

  it("an unreachable target shortens rather than padding", () => {
    const clips = [
      makePhotoClip("photo1", 2), // already at min
      makePhotoClip("photo2", 2),
    ];
    const targetSec = 3; // total is 4, need to shrink by 1 but both at min

    const result = fitDuration(clips, targetSec, holds);

    expect(result.clips.length).toBe(2);
    // Should not pad — clips stay at their current values
    const total = result.clips.reduce((sum, c) => sum + (c.holdSec ?? 0), 0);
    expect(total).toBe(4); // unchanged, can't shrink further
    expect(result.notes.some(n => n.includes("exhausted") || n.includes("not within"))).toBe(true);
  });

  it("already within tolerance does nothing", () => {
    const clips = [
      makePhotoClip("photo1", 3),
      makePhotoClip("photo2", 3),
    ];
    const targetSec = 6; // total is exactly 6

    const result = fitDuration(clips, targetSec, holds);

    expect(result.clips[0]!.holdSec).toBe(3);
    expect(result.clips[1]!.holdSec).toBe(3);
    expect(result.notes.length).toBe(0);
  });
});

describe("fitDuration — silent video trimming", () => {
  it("trims silent video when photo holds are exhausted and film is too long", () => {
    const clips: AssembledClip[] = [
      makePhotoClip("photo1", 2), // at min, can't shrink
      makeVideoClip("video1", 0, 10, false), // silent video, 10 seconds
    ];
    const targetSec = 5;

    const result = fitDuration(clips, targetSec, holds);

    expect(result.clips.length).toBe(2);
    expect(result.clips[0]!.holdSec).toBe(2); // photo at min
    expect(result.clips[1]!.sourceOutSec).toBeLessThan(10); // video trimmed
  });

  it("never trims speech clips", () => {
    const clips: AssembledClip[] = [
      makePhotoClip("photo1", 2), // at min
      makeVideoClip("video1", 0, 10, true), // has speech, should not be trimmed
    ];
    const targetSec = 5;

    const result = fitDuration(clips, targetSec, holds);

    expect(result.clips[1]!.sourceOutSec).toBe(10); // unchanged
  });
});

describe("fitDuration — edge cases", () => {
  it("empty clips returns empty with no notes", () => {
    const result = fitDuration([], 60, holds);

    expect(result.clips.length).toBe(0);
    expect(result.notes.length).toBe(0);
  });

  it("single photo clip adjusts to target", () => {
    const clips = [makePhotoClip("photo1", 10)];
    const targetSec = 5;

    const result = fitDuration(clips, targetSec, holds);

    expect(result.clips[0]!.holdSec).toBe(5); // adjusted to target
  });
});
