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

  it("leaves a face unassigned when it appears in only one photo", () => {
    const resolver = embeddingIdentity({ threshold: 0.85, groupMergeThreshold: 0.78 });
    const result = resolver.resolveVectors([...faces, { faceId: "singleton", shotId: "only-photo", vector: [-1, 0] }]);

    expect(result.has("singleton")).toBe(false);
    expect(result.get("a1")).toBe(result.get("a2"));
  });

  it("keeps assigned ids for recurring groups and leaves a singleton unassigned", () => {
    const resolver = embeddingIdentity({ threshold: 0.85, groupMergeThreshold: 0.78 });
    const result = resolver.resolveVectors([
      { faceId: "x", shotId: "shared", vector: [1, 0], characterId: "picked" },
      { faceId: "y", shotId: "shared", vector: [1, 0], characterId: "other" },
      { faceId: "z", shotId: "s2", vector: [1, 0] },
    ]);
    expect(result.get("x")).toBe("picked");
    expect(result.has("y")).toBe(false);
    expect(result.get("z")).toBe("picked");
  });
});
