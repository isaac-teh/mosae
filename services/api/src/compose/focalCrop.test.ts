import { describe, expect, it } from "vitest";
import { aspectRatio, cellAspect, collageCellAspect, focalCrop } from "./focalCrop.js";

const face = (bbox: [number, number, number, number], characterId?: string) => ({ bbox, confidence: 1, ...(characterId ? { characterId } : {}) });

describe("focalCrop", () => {
  it("keeps a left-edge face fully visible in a portrait cover crop", () => {
    const crop = focalCrop([face([0.3, 0.02, 0.62, 0.2])], 16 / 9, 9 / 16)!;
    const visibleWidth = (9 / 16) / (16 / 9);
    const left = crop.x * (1 - visibleWidth);
    expect(left).toBeLessThanOrEqual(0.02);
    expect(left + visibleWidth).toBeGreaterThanOrEqual(0.2);
  });

  it("centres the union of faces when it fits", () => {
    const crop = focalCrop([face([0.25, 0.35, 0.55, 0.45]), face([0.3, 0.48, 0.6, 0.62])], 16 / 9, 9 / 16)!;
    const visibleWidth = (9 / 16) / (16 / 9);
    const left = crop.x * (1 - visibleWidth);
    expect(left).toBeLessThanOrEqual(0.35);
    expect(left + visibleWidth).toBeGreaterThanOrEqual(0.62);
  });

  it("returns no crop without faces and favours a focused face", () => {
    expect(focalCrop([], 16 / 9, 9 / 16)).toBeUndefined();
    const crop = focalCrop([face([0.2, 0.1, 0.4, 0.25]), face([0.4, 0.7, 0.8, 0.95], "focus")], 16 / 9, 9 / 16, new Set(["focus"]))!;
    expect(crop.x).toBeGreaterThan(0.5);
  });

  it("uses a collage cell's pixel aspect instead of the portrait frame aspect", () => {
    // A 16:9-normalized cell in a 9:16 frame is square in pixels.
    expect(cellAspect(9 / 16, { w: 16, h: 9 })).toBe(1);
    const gridCell = collageCellAspect("grid-wide-top", 2, 0, 9 / 16);
    expect(gridCell).toBeCloseTo(0.9375);
    expect(gridCell).not.toBe(9 / 16);
  });

  it("derives framing from a square film aspect setting", () => {
    const ratio = aspectRatio("1:1");
    expect(ratio).toBe(1);
    const crop = focalCrop([face([0.2, 0.1, 0.4, 0.25])], 16 / 9, ratio)!;
    const visibleWidth = ratio! / (16 / 9);
    const left = crop.x * (1 - visibleWidth);
    expect(left).toBeLessThanOrEqual(0.1);
    expect(left + visibleWidth).toBeGreaterThanOrEqual(0.25);
  });

  it("skips framing when source dimensions are missing", () => {
    expect(focalCrop([face([0.2, 0.1, 0.4, 0.25])], undefined, 9 / 16)).toBeUndefined();
  });
});
