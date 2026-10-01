import { describe, expect, it } from "vitest";
import { embeddingIdentity } from "./embeddingIdentity.js";

const faces = [
  { faceId: "a1", shotId: "s1", vector: [1, 0] },
  { faceId: "a2", shotId: "s2", vector: [1, 0] },
  { faceId: "b1", shotId: "s3", vector: [0, 1] },
  { faceId: "b2", shotId: "s4", vector: [0, 1] },
];

describe("embeddingIdentity", () => {
  it("returns deterministic embedding identities for recurring people", () => {
    const resolver = embeddingIdentity({ threshold: 0.85, groupMergeThreshold: 0.78 });
    const result = resolver.resolveVectors(faces);
    expect(resolver.source).toBe("embeddings");
    expect(result.get("a1")).toBe(result.get("a2"));
    expect(result.get("b1")).toBe(result.get("b2"));
    expect(result.get("a1")).not.toBe(result.get("b1"));
  });

  it("keeps assigned character ids and prevents assigned groups merging across a shared shot", () => {
    const resolver = embeddingIdentity({ threshold: 0.85, groupMergeThreshold: 0.78 });
    const result = resolver.resolveVectors([
      { faceId: "x", shotId: "shared", vector: [1, 0], characterId: "picked" },
      { faceId: "y", shotId: "shared", vector: [1, 0], characterId: "other" },
      { faceId: "z", shotId: "s2", vector: [1, 0] },
    ]);
    expect(result.get("x")).toBe("picked");
    expect(result.get("y")).toBe("other");
    expect(result.get("z")).toBe("picked");
  });
});
