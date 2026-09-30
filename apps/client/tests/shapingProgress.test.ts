import { describe, expect, it } from "vitest";
import { mapShapingProgress } from "../lib/shapingProgress";

describe("mapShapingProgress", () => {
  it("advances through composition within the first third", () => {
    expect(mapShapingProgress("composing", 0, 0.5)).toMatchObject({ progress: 1 / 6, stepsDone: 0 });
    expect(mapShapingProgress("composing", 0, 1)).toMatchObject({ progress: 1 / 3, stepsDone: 0 });
  });

  it("maps rendering progress onto the remaining two thirds and checklist thresholds", () => {
    expect(mapShapingProgress("rendering", 0.45)).toEqual({ progress: 1 / 3 + 0.45 * 2 / 3, stepsDone: 1 });
    expect(mapShapingProgress("rendering", 0.5)).toEqual({ progress: 2 / 3, stepsDone: 2 });
    expect(mapShapingProgress("rendering", 0.73)).toEqual({ progress: 1 / 3 + 0.73 * 2 / 3, stepsDone: 2 });
    expect(mapShapingProgress("rendering", 1)).toEqual({ progress: 1, stepsDone: 2 });
  });

  it("treats playable as composition done and saved as fully complete", () => {
    expect(mapShapingProgress("playable", 0)).toEqual({ progress: 1, stepsDone: 3 });
    expect(mapShapingProgress("saved", 0)).toEqual({ progress: 1, stepsDone: 3 });
  });

  it("clamps invalid progress and queued composition progress", () => {
    expect(mapShapingProgress("queued", 0, 1.5)).toEqual({ progress: 1 / 3, stepsDone: 0 });
    expect(mapShapingProgress("rendering", 2)).toEqual({ progress: 1, stepsDone: 2 });
  });
});
