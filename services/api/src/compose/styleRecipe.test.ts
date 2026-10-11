import { describe, expect, it } from "vitest";
import { styleRecipeForCadence } from "./styleRecipe.js";
import { TRANSITION_SECONDS } from "./transitions.js";

describe("styleRecipeForCadence", () => {
  it.each(["tender", "reflective"] as const)("uses the slower Memory recipe for %s", (cadence) => {
    expect(styleRecipeForCadence(cadence)).toMatchObject({
      id: "memory",
      photoHold: [2.2, 3.2],
      buildTightening: 0.15,
      closerHoldBoost: 0.3,
      transitions: { default: "crossfade", crossfadeSec: 0.4, peak: "cut" },
      photoMotion: "gentle-kenburns",
      cutOn: "bar",
    });
  });

  it.each(["playful", "energetic", "celebratory"] as const)("uses lively pacing for %s", (cadence) => {
    expect(styleRecipeForCadence(cadence)).toMatchObject({
      id: "memory",
      photoHold: [1.5, 2.2],
      cutOn: "beat",
    });
  });

  it("provides soundtrack mood tags", () => {
    expect(styleRecipeForCadence("tender").musicMood.length).toBeGreaterThan(0);
  });

  it("feeds the crossfade duration used by the compose stages", () => {
    expect(TRANSITION_SECONDS.crossfade).toBe(0.4);
  });
});
