import { describe, expect, it } from "vitest";
import { CONFIDENCE_MIN, IOU_THRESHOLD, normalizeFaces } from "./faceDetect.js";

describe("normalizeFaces", () => {
  const pixelFaces = [
    { bbox: [100, 200, 300, 400], confidence: 0.9 }, // image ~600x800
    { bbox: [105, 205, 305, 405], confidence: 0.8 }, // overlaps first heavily → deduped
    { bbox: [400, 450, 500, 550], confidence: 0.7 }, // distinct person
    { bbox: [10, 10, 20, 20], confidence: 0.2 }, // below CONFIDENCE_MIN → dropped
  ];

  it("rescales pixel coordinates to [0,1] using image dimensions", () => {
    const out = normalizeFaces(pixelFaces, { width: 600, height: 800 });
    expect(out).toHaveLength(2); // heavy overlap deduped the second box; low-conf dropped
    expect(out[0].bbox).toEqual([100 / 800, 200 / 600, 300 / 800, 400 / 600]);
    expect(out[0].confidence).toBeCloseTo(0.9);
  });

  it("passes through already-normalized coordinates when no dims given", () => {
    const normalized = [
      { bbox: [0.1, 0.1, 0.4, 0.4], confidence: 0.7 },
      { bbox: [0.6, 0.6, 0.9, 0.9], confidence: 0.8 },
    ];
    const out = normalizeFaces(normalized);
    expect(out).toHaveLength(2);
    expect(out[0].bbox).toEqual([0.1, 0.1, 0.4, 0.4]);
  });

  it("drops faces below the confidence gate", () => {
    const out = normalizeFaces(pixelFaces, { width: 600, height: 800 });
    expect(out.every((f) => f.confidence >= CONFIDENCE_MIN)).toBe(true);
  });

  it("rejects malformed input without throwing", () => {
    expect(normalizeFaces([])).toEqual([]);
    expect(normalizeFaces([{ bbox: "nope" }])).toEqual([]);
    expect(normalizeFaces([null, undefined])).toEqual([]);
  });

  it("clamps boxes into [0,1] and rejects degenerate boxes", () => {
    const out = normalizeFaces([
      { bbox: [-5, -5, 2000, 2000], confidence: 0.9 }, // clamped to [0,1]
      { bbox: [0.5, 0.5, 0.5, 0.5], confidence: 0.9 }, // zero area → dropped
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].bbox).toEqual([0, 0, 1, 1]);
  });

  it("dedups boxes whose IoU exceeds the threshold", () => {
    const nearIdentical = [
      { bbox: [0.1, 0.1, 0.5, 0.5], confidence: 0.9 },
      { bbox: [0.12, 0.12, 0.52, 0.52], confidence: 0.8 }, // IoU ≈ 0.76 > threshold
    ];
    expect(normalizeFaces(nearIdentical)).toHaveLength(1);
  });

  it("exposes its tunable constants", () => {
    expect(IOU_THRESHOLD).toBeGreaterThan(0);
    expect(CONFIDENCE_MIN).toBeGreaterThan(0);
  });
});
