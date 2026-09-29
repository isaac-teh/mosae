import { describe, expect, it } from "vitest";
import { faceCropGeometry, imageSizeFromLoadEvent, normalizeFaceBbox } from "./faceCrop";

describe("face crop geometry", () => {
  it("normalizes Gemini boxes on a 0–1000 grid in ymin, xmin, ymax, xmax order", () => {
    expect(normalizeFaceBbox([120, 240, 360, 480])).toEqual([0.12, 0.24, 0.36, 0.48]);
  });

  it("reads image dimensions from browser load events without a native source object", () => {
    expect(imageSizeFromLoadEvent({ nativeEvent: { target: { naturalWidth: 400, naturalHeight: 200 } } })).toEqual({ width: 400, height: 200 });
    expect(imageSizeFromLoadEvent({ nativeEvent: { source: { width: 300, height: 500 } } })).toEqual({ width: 300, height: 500 });
    expect(imageSizeFromLoadEvent({})).toBeNull();
  });

  it("centres a padded square crop in source pixels without stretching landscape thumbnails", () => {
    const crop = faceCropGeometry([0.2, 0.6, 0.4, 0.8], 400, 200, 72);
    expect(crop.width / crop.height).toBe(2);
    expect(crop.left + 72 / 2).toBeCloseTo(200); // (0.6 + 0.8) / 2 * 400
    expect(crop.top + 72 / 2).toBeCloseTo(60); // (0.2 + 0.4) / 2 * 200
    expect(crop.width).toBeGreaterThan(72);
    expect(crop.height).toBeGreaterThan(72);
  });

  it("keeps an edge face inside the image while retaining a square crop", () => {
    const crop = faceCropGeometry([0.05, 0.82, 0.25, 0.98], 400, 200, 72);
    expect(crop.width).toBe(crop.height);
    expect(crop.left).toBeGreaterThanOrEqual(-crop.width);
    expect(crop.left).toBeLessThanOrEqual(0);
  });
});
