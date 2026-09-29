import { describe, expect, it } from "vitest";
import { faceCropGeometry, imageSizeFromLoadEvent, normalizeFaceBbox } from "../lib/faceCrop";

describe("face crop geometry", () => {
  it("normalizes Gemini boxes on a 0–1000 grid in ymin, xmin, ymax, xmax order", () => {
    expect(normalizeFaceBbox([120, 240, 360, 480])).toEqual([0.12, 0.24, 0.36, 0.48]);
  });

  it("reads image dimensions from browser load events without a native source object", () => {
    expect(imageSizeFromLoadEvent({ nativeEvent: { target: { naturalWidth: 400, naturalHeight: 200 } } })).toEqual({ width: 400, height: 200 });
    expect(imageSizeFromLoadEvent({ nativeEvent: { source: { width: 300, height: 500 } } })).toEqual({ width: 300, height: 500 });
    expect(imageSizeFromLoadEvent({})).toBeNull();
  });

  it("calculates an exact padded square crop for a known portrait box", () => {
    const crop = faceCropGeometry([0.2, 0.25, 0.4, 0.35], 800, 600, 64);
    expect(crop.width).toBeCloseTo(266.666667, 5);
    expect(crop.height).toBe(200);
    expect(crop.left).toBe(-48);
    expect(crop.top).toBeCloseTo(-28, 5);
  });

  it("centres a padded square crop in source pixels without stretching landscape thumbnails", () => {
    const crop = faceCropGeometry([0.2, 0.6, 0.4, 0.8], 400, 200, 72);
    expect(crop.width / crop.height).toBe(2);
    const scale = crop.width / 400;
    expect(crop.left + ((0.6 + 0.8) / 2) * 400 * scale).toBeCloseTo(72 / 2);
    expect(crop.top + 64 * scale).toBeCloseTo(72 / 2); // face center is clamped to the image edge
    expect(crop.width).toBeGreaterThan(72);
    expect(crop.height).toBeGreaterThan(72);
  });

  it("keeps an edge face inside the image while preserving its aspect ratio", () => {
    const crop = faceCropGeometry([0.05, 0.82, 0.25, 0.98], 400, 200, 72);
    expect(crop.width / crop.height).toBe(2);
    expect(crop.left).toBeGreaterThanOrEqual(-crop.width);
    expect(crop.left).toBeLessThanOrEqual(0);
  });
});
