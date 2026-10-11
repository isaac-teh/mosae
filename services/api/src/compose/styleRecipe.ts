import type { CadenceId } from "@mosae/contracts";

export type StyleRecipe = {
  id: "memory";
  photoHold: readonly [number, number];
  buildTightening: number;
  closerHoldBoost: number;
  transitions: { default: "cut" | "crossfade"; crossfadeSec: number; peak: "cut" };
  photoMotion: "gentle-kenburns" | "none";
  cutOn: "beat" | "bar" | "free";
  musicMood: string[];
};

const MEMORY_RECIPE: StyleRecipe = {
  id: "memory",
  photoHold: [2.2, 3.2],
  buildTightening: 0.15,
  closerHoldBoost: 0.3,
  transitions: { default: "crossfade", crossfadeSec: 0.4, peak: "cut" },
  photoMotion: "gentle-kenburns",
  cutOn: "bar",
  musicMood: ["tender", "reflective", "warm", "nostalgic"],
};

const LIVELY_CADENCES: readonly CadenceId[] = ["playful", "energetic", "celebratory"];

/** Resolve the one shipped style and its cadence-specific pacing variant. */
export function styleRecipeForCadence(cadence: CadenceId): StyleRecipe {
  if (!LIVELY_CADENCES.includes(cadence)) return MEMORY_RECIPE;
  return {
    ...MEMORY_RECIPE,
    photoHold: [1.5, 2.2],
    cutOn: "beat",
    musicMood: ["playful", "energetic", "celebratory"],
  };
}
