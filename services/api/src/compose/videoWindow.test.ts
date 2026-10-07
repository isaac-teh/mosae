import { describe, expect, it } from "vitest";
import { bestWindow, scoreWindow, type ScoredShot } from "./videoWindow.js";

const shot = (extra: Partial<ScoredShot> = {}): ScoredShot => ({ startSec: 0, endSec: 10, ...extra });

describe("video window scoring and selection", () => {
  it("scores weighted highlight overlap and signal loudness/quality", () => {
    expect(scoreWindow(shot({ highlights: [{ startSec: 2, endSec: 4, score: 0.8 }] }), 2, 4)).toBeCloseTo(0.8);
    const signals = { stepSec: 0.25, shake: [0, 0], blur: [0, 0], loud: [0, 1] };
    expect(scoreWindow(shot({ signals }), 0, 0.5)).toBeCloseTo(0.5);
    expect(scoreWindow(shot(), 0, 2)).toBe(0);
  });

  it("uses signal peak with a 0.3 second lead-in when tied", () => {
    const loud = Array(40).fill(0); loud[20] = 1;
    const result = bestWindow(shot({ signals: { stepSec: 0.25, shake: Array(40).fill(0), blur: Array(40).fill(0), loud } }), 2)!;
    expect(result.inSec).toBeCloseTo(4.65); // nearest 0.25s grid point to peak minus 0.3s
  });

  it("avoids a shaky or blurry start when another legal start exists", () => {
    const shake = Array(40).fill(0); shake[1] = 0.9;
    const blur = Array(40).fill(0); blur[2] = 0.9;
    const result = bestWindow(shot({ signals: { stepSec: 0.25, shake, blur, loud: Array(40).fill(0) } }), 2)!;
    expect(result.inSec).toBeGreaterThan(0.5);
  });

  it("returns no window when every possible start is shaky or blurry", () => {
    expect(bestWindow(shot({ signals: { stepSec: 0.25, shake: Array(40).fill(0.9), blur: Array(40).fill(1), loud: Array(40).fill(0) } }), 2)).toBeNull();
    expect(bestWindow(shot({ endSec: 3, signals: { stepSec: 0.25, shake: Array(12).fill(0), blur: Array(12).fill(0.9), loud: Array(12).fill(0) } }), 2)).toBeNull();
  });

  it("rejects invalid timestamps and normalizes nonpositive signal steps", () => {
    expect(bestWindow(shot({ startSec: Number.NaN }), 2)).toBeNull();
    expect(scoreWindow(shot({ signals: { stepSec: -1, shake: [0], blur: [1], loud: [0] } }), 0, 0.25)).toBe(0);
  });

  it("keeps shots shorter than four seconds whole", () => {
    expect(bestWindow(shot({ endSec: 3.5 }), 2)).toMatchObject({ inSec: 0, outSec: 3.5 });
  });

  it("breaks equal scores by earliest legal start and uses earliest without data", () => {
    const expected = { inSec: 0.15, outSec: 2.15 };
    expect(bestWindow(shot(), 2)).toMatchObject(expected);
    expect(bestWindow(shot({ signals: { stepSec: 0.25, shake: Array(40).fill(0), blur: Array(40).fill(0), loud: Array(40).fill(0) } }), 2)).toMatchObject(expected);
  });

  it("does not cut a sentence and can extend to finish one", () => {
    const speech = [{ startSec: 2, endSec: 7, text: "A whole sentence." }];
    expect(bestWindow(shot(), 4, { speech })).toMatchObject({ inSec: 2, outSec: 7 });
  });

  it("extends speech to its complete eight-second boundary but never beyond the limit", () => {
    const speech = [{ startSec: 1, endSec: 9, text: "Long sentence." }];
    expect(bestWindow(shot(), 4, { speech })).toMatchObject({ inSec: 1, outSec: 9 });
    expect(bestWindow(shot(), 4, { speech: [{ startSec: 1, endSec: 9.1, text: "Too long." }] })).toBeNull();
  });
});
