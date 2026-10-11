import { describe, expect, it } from "vitest";
import { snapPhotoBoundaries } from "./musicCuts.js";

const photo = (holdSec: number, minHoldSec = 2, maxHoldSec = 4, extra = {}) => ({ kind: "photo" as const, holdSec, minHoldSec, maxHoldSec, ...extra });

describe("music cut timing", () => {
  it("snaps within 250ms when the hold stays in range", () => {
    const result = snapPhotoBoundaries([photo(2.1), photo(2.8)], { hasPulse: true, beatsSec: [2, 3], downbeatsSec: [2] }, "beat");
    expect(result[0]!.holdSec).toBe(2);
  });

  it("snaps the incoming edge after accounting for its crossfade overlap", () => {
    const result = snapPhotoBoundaries([photo(2.1), { ...photo(2), transitionOverlapSec: 0.4 }], { hasPulse: true, beatsSec: [1.8, 3], downbeatsSec: [1.8] }, "beat");
    expect(result[0]!.holdSec).toBe(2.2);
  });

  it("does not snap outside the hold range or beyond 250ms", () => {
    const result = snapPhotoBoundaries([photo(2.1, 2.1, 4), photo(2)], { hasPulse: true, beatsSec: [2], downbeatsSec: [2] }, "beat");
    expect(result[0]!.holdSec).toBe(2.1);
    const far = snapPhotoBoundaries([photo(2), photo(2)], { hasPulse: true, beatsSec: [2.4], downbeatsSec: [2.4] }, "beat");
    expect(far[0]!.holdSec).toBe(2);
  });

  it("protects speech boundaries and uses the strongest nearby downbeat for a locked peak", () => {
    const protectedResult = snapPhotoBoundaries([photo(2.1), { ...photo(2), kind: "video" as const, hasSpeech: true }], { hasPulse: true, beatsSec: [2], downbeatsSec: [2] }, "beat");
    expect(protectedResult[0]!.holdSec).toBe(2.1);
    const peakResult = snapPhotoBoundaries([photo(2.1), { ...photo(2), locked: true, peak: true }], { hasPulse: true, beatsSec: [2, 2.2], downbeatsSec: [2, 2.2], downbeatStrength: [0.1, 0.9] }, "bar");
    expect(peakResult[0]!.holdSec).toBe(2.2);
  });

  it("falls back for a weak pulse", () => {
    const clips = [photo(2.1), photo(2)];
    expect(snapPhotoBoundaries(clips, { hasPulse: false, beatsSec: [2], downbeatsSec: [] }, "beat")[0]!.holdSec).toBe(2.1);
  });
});
