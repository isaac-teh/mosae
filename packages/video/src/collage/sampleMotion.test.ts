import { describe, expect, it } from "vitest";
import { mosaicEntranceAt } from "./sampleMotion";
const top = { x: 0, y: 0, w: 24, h: 32 };
const middle = { x: 0, y: 33.5, w: 49.5, h: 32 };

describe("reference mosaic entrance", () => {
  it("holds the reference's diagonal tilted poses before snapping into place", () => {
    const pose = mosaicEntranceAt(8 / 30, 0, top, 5);
    expect(pose.translateX).toBeCloseTo(-50);
    expect(pose.translateY).toBeCloseTo(-31.09375);
    expect(pose.rotation).toBe(-4.5);
    expect(pose.opacity).toBe(1);
    expect(mosaicEntranceAt(14 / 30, 0, top, 5)).toEqual(pose);
    expect(mosaicEntranceAt(15 / 30, 0, top, 5)).toEqual({ translateX: 0, translateY: 0, rotation: 0, opacity: 1 });
  });
  it("gives the wide middle tile two distinct held poses including vertical movement", () => {
    const first = mosaicEntranceAt(10 / 30, 3, middle, 5);
    const second = mosaicEntranceAt(17 / 30, 3, middle, 5);
    expect(first.rotation).toBe(-5);
    expect(first.translateY).toBe(0);
    expect(mosaicEntranceAt(16 / 30, 3, middle, 5)).toEqual(first);
    expect(second.rotation).toBe(4.5);
    expect(second.translateY).toBeGreaterThan(0);
    expect(second.translateX).toBeGreaterThan(first.translateX);
  });
  it("starts the bottom row later and holds every tile stationary after landing", () => {
    expect(mosaicEntranceAt(.4, 6, top, 5).opacity).toBe(0);
    for (let order = 0; order < 9; order++) {
      const settled = mosaicEntranceAt(2, order, top, 5);
      expect(settled).toEqual({ translateX: 0, translateY: 0, rotation: 0, opacity: 1 });
      expect(mosaicEntranceAt(4.9, order, top, 5)).toEqual(settled);
      expect(mosaicEntranceAt(.45, order, top, .5)).toEqual(settled);
    }
  });
});
