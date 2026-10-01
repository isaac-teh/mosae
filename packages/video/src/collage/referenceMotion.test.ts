import { describe, expect, it } from "vitest";
import { gridTileAt, scrapbookPhotoAt } from "./referenceMotion";

describe("reference clone motion", () => {
  it("matches the grid's alternating cubic tumble from the edges", () => {
    const first = gridTileAt(5 / 30, 0, 5);
    expect(first.translateX).toBeCloseTo(-100 * (2 / 3) ** 3);
    expect(first.rotation).toBeCloseTo(165 * (2 / 3) ** 3);
    expect(gridTileAt(6 / 30, 1, 5).translateX).toBeCloseTo(51.2);
    expect(gridTileAt(.6, 0, 5)).toEqual({ translateX: 0, rotation: 0, opacity: 1 });
    expect(gridTileAt(.7, 6, 5).opacity).toBe(0);
    expect(gridTileAt(2, 8, 5)).toEqual({ translateX: 0, rotation: 0, opacity: 1 });
  });
  it("lifts three scrapbook photos, lowers the fourth, and fades at the end", () => {
    expect(scrapbookPhotoAt(.2, 0, 5).translateY).toBeGreaterThan(0);
    expect(scrapbookPhotoAt(.2, 3, 5).translateY).toBeLessThan(0);
    expect(scrapbookPhotoAt(.2, 0, 5).opacity).toBe(0);
    expect(scrapbookPhotoAt(.4, 0, 5).opacity).toBeCloseTo(.4);
    expect(scrapbookPhotoAt(.8, 0, 5).opacity).toBe(1);
    expect(scrapbookPhotoAt(1, 0, 5)).toEqual({ translateY: 0, opacity: 1 });
    expect(scrapbookPhotoAt(4.8, 0, 5).opacity).toBeGreaterThan(0);
    expect(scrapbookPhotoAt(4.8, 0, 5).opacity).toBeLessThan(1);
    expect(scrapbookPhotoAt(5, 0, 5).opacity).toBe(0);
  });
});
