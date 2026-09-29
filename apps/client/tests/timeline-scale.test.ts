import { describe, expect, it } from "vitest";
import { timeToX, xToTime, timelineContentWidth } from "../components/editor/timelineScale";

describe("unified timeline scale", () => {
  it.each([20, 40, 80, 120])("maps times to positions and back at %ipx/s", (scale) => {
    for (const seconds of [0, 2, 17.5, 120]) {
      expect(xToTime(timeToX(seconds, scale, 195), scale, 195)).toBeCloseTo(seconds);
    }
  });

  it("includes half viewport padding at both ends", () => {
    expect(timelineContentWidth(42, 390, 40)).toBe(2070);
  });
});
