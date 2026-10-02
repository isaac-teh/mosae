import { describe, expect, it } from "vitest";
import { gainDbToVolumePercent, volumePercentToGainDb } from "../components/editor/musicVolume";

describe("music volume slider conversion", () => {
  it("maps mute and unity exactly and uses logarithmic gain between them", () => {
    expect(volumePercentToGainDb(0)).toBe(-60);
    expect(volumePercentToGainDb(100)).toBe(0);
    expect(volumePercentToGainDb(50)).toBeCloseTo(-6.0206, 3);
  });

  it("maps stored dB gain back to a bounded volume percentage", () => {
    expect(gainDbToVolumePercent(-60)).toBe(0);
    expect(gainDbToVolumePercent(0)).toBe(100);
    expect(gainDbToVolumePercent(12)).toBe(100);
    expect(gainDbToVolumePercent(-6)).toBe(50);
  });
});
