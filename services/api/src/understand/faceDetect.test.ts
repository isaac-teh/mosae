import { describe, expect, it } from "vitest";
import { CONFIDENCE_MIN, DETECTION_GRID, IOU_THRESHOLD, normalizeFaces } from "./faceDetect.js";

describe("normalizeFaces", () => {
  const gridFaces = [
    { bbox: [100, 200, 300, 400], confidence: 0.9 },
    { bbox: [105, 205, 305, 405], confidence: 0.8 }, // overlaps first heavily → deduped
    { bbox: [400, 450, 500, 550], confidence: 0.7 }, // distinct person
    { bbox: [10, 10, 20, 20], confidence: 0.2 }, // below CONFIDENCE_MIN → dropped
  ];

  it("divides grid coordinates by 1000, not by the image size", () => {
    const out = normalizeFaces(gridFaces);
    expect(out).toHaveLength(2); // heavy overlap deduped the second box; low-conf dropped
    expect(out[0].bbox).toEqual([0.1, 0.2, 0.3, 0.4]);
    expect(out[0].confidence).toBeCloseTo(0.9);
  });

  /**
   * The bug this pins: boxes were divided by the image's pixel dimensions. On a
   * roughly 1000px-square photo that is within a few percent and looks right,
   * which is exactly why it survived. On a tall photo it put every face about
   * twice as high as it belonged — off the top of the frame, into the sky.
   */
  it("places a face identically whatever the image's shape", () => {
    const face = [{ bbox: [389, 483, 453, 532], confidence: 0.99 }];
    const [square] = normalizeFaces(face);
    const [tall] = normalizeFaces(face);
    expect(square.bbox).toEqual(tall.bbox);
    expect(square.bbox[0]).toBeCloseTo(0.389);
    expect(square.bbox[1]).toBeCloseTo(0.483);
    // Comfortably inside the frame, where the face actually is.
    expect(square.bbox.every((v) => v >= 0 && v <= 1)).toBe(true);
  });

  it("passes through already-normalized coordinates untouched", () => {
    const normalized = [
      { bbox: [0.1, 0.1, 0.4, 0.4], confidence: 0.7 },
      { bbox: [0.6, 0.6, 0.9, 0.9], confidence: 0.8 },
    ];
    const out = normalizeFaces(normalized);
    expect(out).toHaveLength(2);
    expect(out[0].bbox).toEqual([0.1, 0.1, 0.4, 0.4]);
  });

  it("drops faces below the confidence gate", () => {
    const out = normalizeFaces(gridFaces);
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
    expect(DETECTION_GRID).toBe(1000);
  });
});
