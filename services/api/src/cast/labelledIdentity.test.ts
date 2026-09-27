import { describe, expect, it } from "vitest";
import { iou, labelledIdentity, labelsCover } from "./labelledIdentity.js";

const labels = {
  people: { a: {}, b: {} },
  photos: {
    h1: [
      { bbox: [0.1, 0.1, 0.3, 0.3] as [number, number, number, number], personId: "a" },
      { bbox: [0.5, 0.5, 0.7, 0.7] as [number, number, number, number], personId: "b" },
    ],
  },
};

const face = (faceId: string, photoHash: string, bbox: [number, number, number, number]) => ({
  faceId,
  shotId: "s",
  photoHash,
  bbox,
});

describe("iou", () => {
  it("is 1 for identical boxes and 0 for disjoint", () => {
    expect(iou([0, 0, 1, 1], [0, 0, 1, 1])).toBeCloseTo(1);
    expect(iou([0, 0, 0.1, 0.1], [0.5, 0.5, 0.6, 0.6])).toBe(0);
  });
});

describe("labelledIdentity", () => {
  it("matches by overlap, not by index", () => {
    const map = labelledIdentity(labels).resolve([
      face("f0", "h1", [0.51, 0.5, 0.71, 0.7]),
      face("f1", "h1", [0.1, 0.11, 0.3, 0.31]),
    ]);
    expect(map.get("f0")).toBe("b");
    expect(map.get("f1")).toBe("a");
  });

  it("leaves faces with no label or low overlap unassigned (Review Focus #2)", () => {
    const map = labelledIdentity(labels).resolve([
      face("f0", "unknown", [0.1, 0.1, 0.3, 0.3]),
      face("f1", "h1", [0.25, 0.25, 0.45, 0.45]),
    ]);
    expect(map.size).toBe(0);
  });

  it("assigns each label at most once per photo", () => {
    const map = labelledIdentity(labels).resolve([
      face("f0", "h1", [0.1, 0.1, 0.3, 0.3]),
      face("f1", "h1", [0.11, 0.1, 0.31, 0.3]),
    ]);
    expect([...map.values()].filter((p) => p === "a")).toHaveLength(1);
  });

  it("reports coverage", () => {
    expect(labelsCover(labels, ["h1", "x"])).toBe(true);
    expect(labelsCover(labels, ["x", "y", "z"])).toBe(false);
  });
});
