import { describe, expect, it } from "vitest";

const cropRect = async () => (await import("./faceCrops.js") as typeof import("./faceCrops.js") & { faceCropRect?: (face: { bbox: [number, number, number, number]; prominence?: string; faceVisible?: boolean }, size: { width: number; height: number }) => { left: number; top: number; width: number; height: number } | null }).faceCropRect;

describe("face crop rectangles", () => {
  it("adds 10% padding and clamps the crop to the image edges", async () => {
    const makeCropRect = await cropRect();
    expect(makeCropRect).toBeTypeOf("function");
    if (!makeCropRect) return;

    expect(makeCropRect({ bbox: [0, 0.02, 0.6, 0.52] }, { width: 100, height: 100 })).toEqual({ left: 0, top: 0, width: 57, height: 66 });
  });

  it("skips tiny faces and faces marked as background or not visible", async () => {
    const makeCropRect = await cropRect();
    expect(makeCropRect).toBeTypeOf("function");
    if (!makeCropRect) return;
    const size = { width: 500, height: 300 };

    expect(makeCropRect({ bbox: [0.2, 0.2, 0.3, 0.26] }, size)).toBeNull();
    expect(makeCropRect({ bbox: [0.2, 0.2, 0.6, 0.5], prominence: "background" }, size)).toBeNull();
    expect(makeCropRect({ bbox: [0.2, 0.2, 0.6, 0.5], faceVisible: false }, size)).toBeNull();
  });

  it("skips unusually tall and image-sized boxes", async () => {
    const makeCropRect = await cropRect();
    expect(makeCropRect).toBeTypeOf("function");
    if (!makeCropRect) return;
    const size = { width: 500, height: 300 };

    expect(makeCropRect({ bbox: [0.1, 0.4, 0.8, 0.55] }, size)).toBeNull();
    expect(makeCropRect({ bbox: [0, 0, 0.8, 0.8] }, size)).toBeNull();
  });

  it("measures tallness in pixels for portrait images", async () => {
    const makeCropRect = await cropRect();
    expect(makeCropRect).toBeTypeOf("function");
    if (!makeCropRect) return;
    const portrait = { width: 1367, height: 2048 };

    expect(makeCropRect({ bbox: [0.2, 0.2, 0.3, 0.3] }, portrait)).not.toBeNull();
    expect(makeCropRect({ bbox: [0.1, 0.2, 0.35, 0.4] }, portrait)).toBeNull();
  });
});
