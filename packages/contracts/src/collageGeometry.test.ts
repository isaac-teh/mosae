import { describe, expect, it } from "vitest";
import { assignCollageSlots, collageGridRects, collageLayoutForCount, collageSlotAspects } from "./collageGeometry.js";

describe("collage slot geometry", () => {
  it.each(["9:16", "16:9"] as const)("chooses a full-frame layout for each photo count in %s", (aspect) => {
    const expectedWide = ["simple-full", "simple-offset", "simple-three-top", "simple-grid-2x2", "simple-five-middle", "simple-grid-2x3"];
    for (let count = 2; count <= 6; count++) {
      const layoutId = collageLayoutForCount(count, aspect);
      const area = collageGridRects(layoutId, count, aspect).reduce((sum, cell) => sum + cell.w * cell.h, 0);
      expect(area, `${aspect}/${count}/${layoutId}`).toBeGreaterThanOrEqual(9000);
      if (aspect === "16:9") expect(layoutId).toBe(expectedWide[count - 1]);
    }
  });
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
