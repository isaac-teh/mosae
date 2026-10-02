import { describe, expect, it } from "vitest";
import { closestPersonSimilarity } from "./personSimilarity.js";

describe("closestPersonSimilarity", () => {
  it("records each face group's strongest average cross-group cosine", () => {
    const result = closestPersonSimilarity([
      { faceId: "a1", shotId: "s1", vector: [1, 0], personId: "a" },
      { faceId: "a2", shotId: "s2", vector: [1, 0], personId: "a" },
      { faceId: "b1", shotId: "s3", vector: [0.8, 0.6], personId: "b" },
      { faceId: "c1", shotId: "s4", vector: [0, 1], personId: "c" },
    ]);
    expect(result.get("a")).toEqual({ personId: "b", similarity: 0.8 });
    expect(result.get("b")).toEqual({ personId: "a", similarity: 0.8 });
  });
});
