import { describe, expect, it } from "vitest";
import { focalCrop } from "./focalCrop.js";

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
});
