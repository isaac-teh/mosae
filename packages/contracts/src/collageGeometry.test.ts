import { describe, expect, it } from "vitest";
import { assignCollageSlots, collageSlotAspects } from "./collageGeometry.js";

describe("collage slot geometry", () => {
  it("converts normalized grid cells to the rendered frame aspect", () => {
    const wide = collageSlotAspects("grid-wide-top", "grid-wide-top", 3, 16 / 9);
    expect(wide[0]).toBeGreaterThan(3);
    expect(wide[1]).toBeCloseTo(16 / 9, 1);
    expect(collageSlotAspects("grid-three-columns", "grid-three-columns", 3, 16 / 9).every((ratio) => ratio < 1)).toBe(true);
  });
  it("assigns portrait sources to tall slots and landscape sources to wide slots", () => {
    expect(assignCollageSlots([0.56, 1.78], [1.78, 0.56])).toEqual([1, 0]);
  });
});
