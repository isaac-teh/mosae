import type { CadenceId } from "@mosae/contracts";

/** Deterministic first-cut rules shared by prompting, fitting and collage placement. */
export const DIRECTING_RULES = {
  basePhotoSec: 1,
  secondsPerPhoto: 0.2,
  holdVariance: 0.2,
  collageMaxPhotos: 6,
  minimumFilmSec: 20,
  singlePhotoMaxSec: 4,
  tierlessPhotoStretchMultiplier: 10 / 3,
  shortTierMinSec: 1.2,
  cadenceMultiplier: { tender: 2, reflective: 1.8, playful: 1, energetic: 1, celebratory: 1.2 } satisfies Record<CadenceId, number>,
  videoLength: { tender: [4, 6], reflective: [4, 6], playful: [2, 3], energetic: [2, 3], celebratory: [3, 4] } satisfies Record<CadenceId, readonly [number, number]>,
  videoMaxSpeechSec: 8,
  videoShareMax: 0.5,
  videoHighlightBoundaryMin: 0.7,
} as const;

export function videoTargetLength(cadence: CadenceId, availableSec: number): number {
  if (availableSec < 4) return Math.max(0, availableSec);
  const [min, max] = DIRECTING_RULES.videoLength[cadence];
  return Number(Math.min(max, availableSec).toFixed(2));
}

export function photoBaseDuration(photoCount: number, cadence: CadenceId): number {
  const count = Math.max(1, Math.min(DIRECTING_RULES.collageMaxPhotos, Math.floor(photoCount)));
  return (DIRECTING_RULES.basePhotoSec + DIRECTING_RULES.secondsPerPhoto * count) * DIRECTING_RULES.cadenceMultiplier[cadence];
}

export function photoHoldRange(photoCount: number, cadence: CadenceId): { base: number; min: number; max: number } {
  const base = photoBaseDuration(photoCount, cadence);
  return { base, min: Number((base * (1 - DIRECTING_RULES.holdVariance)).toFixed(2)), max: Number((base * (1 + DIRECTING_RULES.holdVariance)).toFixed(2)) };
}

export function collageCountRange(mediaCount: number): { min: number; max: number; minPhotos: number; maxPhotos: number } {
  if (mediaCount < 8) return { min: 0, max: 0, minPhotos: 0, maxPhotos: 0 };
  if (mediaCount < 20) return { min: 1, max: 1, minPhotos: 3, maxPhotos: 4 };
  if (mediaCount < 50) return { min: 1, max: 2, minPhotos: 2, maxPhotos: 6 };
  return { min: 2, max: 3, minPhotos: 2, maxPhotos: DIRECTING_RULES.collageMaxPhotos };
}

export function requestedCollageCount(mediaCount: number, amount: "few" | "lots" | "none" = "few"): number {
  const { min, max } = collageCountRange(mediaCount);
  if (amount === "none") return 0;
  if (amount === "lots") return max;
  return min;
}

/** Boundary slots permitted by the approved placement rules; chosen by seeded story score. */
export function collagePlacementOptions(clipCount: number, collageCount: number): number[][] {
  if (collageCount === 1 && clipCount >= 1) return [[0], [clipCount - 1]];
  if (collageCount === 2 && clipCount >= 2) return [[0, 1], [0, clipCount - 1], [clipCount - 2, clipCount - 1]];
  if (collageCount === 3 && clipCount >= 3) return [[0, 1, clipCount - 1], [0, 1, Math.floor(clipCount / 2)], [0, clipCount - 2, clipCount - 1], [Math.floor(clipCount / 2), clipCount - 2, clipCount - 1]];
  return [];
}

export function deterministicPlacement(clipCount: number, collageCount: number, seed: string): number[] {
  const options = collagePlacementOptions(clipCount, collageCount);
  let value = 2166136261;
  for (const char of seed) value = Math.imul(value ^ char.charCodeAt(0), 16777619);
  return options.length ? options[(value >>> 0) % options.length]! : [];
}

export function fadeOutSec(filmSec: number): number {
  return Math.max(0, Math.min(1, filmSec));
}
