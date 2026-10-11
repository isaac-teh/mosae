import { describe, expect, it } from "vitest";
import { budgetSlotCount, collageCountRange, collagePlacementOptions, deterministicPlacement, DIRECTING_RULES, fadeOutSec, leftOutLengthHint, momentScore, photoBaseDuration, photoHoldRange, requestedCollageCount, videoTargetLength } from "./directingRules.js";

describe("deterministic directing rules", () => {
  it.each([1, 2, 3, 4, 5, 6])("uses photo-count base pace for %i photos", (n) => expect(photoBaseDuration(n, "playful")).toBeCloseTo(1 + 0.2 * n));
  it.each([["tender", 2], ["reflective", 1.8], ["playful", 1], ["energetic", 1], ["celebratory", 1.2]] as const)("applies %s multiplier and variance", (cadence, multiplier) => {
    const range = photoHoldRange(1, cadence);
    expect(range.base).toBeCloseTo(1.2 * multiplier);
    expect(range.min).toBeCloseTo(range.base * 0.8);
    expect(range.max).toBeCloseTo(range.base * 1.2);
  });
  it.each([["tender", 3.6], ["reflective", 3.24], ["playful", 1.8], ["energetic", 1.8], ["celebratory", 2.16]] as const)("sets a four-photo collage base from the photo-count table for %s", (cadence, expected) => {
    expect(photoBaseDuration(4, cadence)).toBeCloseTo(expected);
    const range = photoHoldRange(4, cadence);
    expect(range.min).toBeCloseTo(expected * 0.8);
    expect(range.max).toBeCloseTo(expected * 1.2);
  });
  it.each([[7, 0], [8, 1], [19, 1], [20, 2], [49, 2], [50, 3]] as const)("caps collage count at media boundary N=%i", (n, max) => expect(collageCountRange(n).max).toBe(max));
  it("applies none/few/lots at the allowed edges", () => {
    expect(requestedCollageCount(30, "none")).toBe(0);
    expect(requestedCollageCount(30, "few")).toBe(1);
    expect(requestedCollageCount(30, "lots")).toBe(2);
    expect(requestedCollageCount(60, "few")).toBe(2);
    expect(requestedCollageCount(60, "lots")).toBe(3);
  });
  it("lists all permitted one, two and three-collage positions", () => {
    expect(collagePlacementOptions(8, 1)).toEqual([[0], [1], [2], [3], [4], [5], [6], [7]]);
    expect(collagePlacementOptions(8, 2, [0, 4, 7])).toEqual([[1, 2], [2, 3], [5, 6]]);
    expect(deterministicPlacement(8, 2, "same")).toEqual(deterministicPlacement(8, 2, "same"));
  });
  it("budgets slots at the comfortable hold and scores moments deterministically", () => {
    expect(budgetSlotCount(60)).toBe(22);
    expect(budgetSlotCount(60, 2)).toBe(30);
    expect(momentScore({ quality: 1, emotion: 1, energy: 1, peopleRelevance: 1, intentMatch: 1 })).toBeCloseTo(1);
  });
  it("suggests the next length only when more than 40 percent of good moments overflow", () => {
    expect(leftOutLengthHint({ durationSec: 30, nextDurationSec: 60, goodMomentCount: 15, photoCount: 15, videoSec: 0, lockedPhotoCount: 3 })).toBeUndefined();
    expect(leftOutLengthHint({ durationSec: 30, nextDurationSec: 60, goodMomentCount: 40, photoCount: 40, videoSec: 0, lockedPhotoCount: 3 })).toEqual({ fromDurationSec: 30, nextDurationSec: 60 });
  });
  it("limits collage photo capacity and minimum hold stretching", () => {
    expect(DIRECTING_RULES.collageMaxPhotos).toBe(6);
    expect(DIRECTING_RULES.singlePhotoMaxSec).toBe(4);
    expect(photoBaseDuration(1, "playful") * DIRECTING_RULES.tierlessPhotoStretchMultiplier).toBeCloseTo(4);
    expect(photoBaseDuration(4, "playful") * DIRECTING_RULES.tierlessPhotoStretchMultiplier).toBeCloseTo(6);
    expect(DIRECTING_RULES.minimumFilmSec).toBe(20);
    for (const n of [3, 6, 10]) expect(n * photoHoldRange(1, "playful").base).toBeLessThan(20);
    expect(10 * DIRECTING_RULES.singlePhotoMaxSec).toBeGreaterThanOrEqual(20);
  });
  it("fades out over exactly the final second or the full sub-second film", () => {
    expect(fadeOutSec(60)).toBe(1);
    expect(fadeOutSec(0.5)).toBe(0.5);
  });
  it.each([["tender", 4, 6], ["reflective", 4, 6], ["playful", 2, 3], ["energetic", 2, 3], ["celebratory", 3, 4]] as const)("uses the full %s video cadence range", (cadence, min, max) => {
    expect(videoTargetLength(cadence, 10, 0)).toBe(min);
    expect(videoTargetLength(cadence, 10, 1)).toBe(max);
    expect(videoTargetLength(cadence, 10, 0.5)).toBeCloseTo((min + max) / 2);
  });
  it("uses all available short footage and records directing limits", () => {
    expect(videoTargetLength("tender", 2.5)).toBe(2.5);
    expect(DIRECTING_RULES.videoMaxSpeechSec).toBe(8);
    expect(DIRECTING_RULES.videoShareMax).toBe(0.5);
    expect(DIRECTING_RULES.videoHighlightBoundaryMin).toBe(0.7);
  });
});
