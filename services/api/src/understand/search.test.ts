import { describe, expect, it } from "vitest";
import { cosineSimilarity, rankShots } from "./search.js";
describe("shot search ranking", () => {
  it("handles orthogonal and zero vectors", () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBe(0);
    expect(cosineSimilarity([0, 0], [1, 1])).toBe(0);
  });
  it("ranks descending and limits results", () => {
    expect(rankShots([1, 0], [{ id: "a", assetId: "a", embedding: [1, 0] }, { id: "b", assetId: "b", embedding: [0, 1] }], 1)).toEqual([{ id: "a", assetId: "a", score: 1 }]);
  });
});
