import { describe, expect, it } from "vitest";

type FaceInput = { faceId: string; shotId: string; vector: number[] };
const loadClusterFaces = async () => (await import("./clusterFaces.js") as typeof import("./clusterFaces.js") & { clusterFaces?: (faces: FaceInput[], options: { threshold: number; minPhotos: number }) => string[][] }).clusterFaces;

describe("clusterFaces", () => {
  it("does not compare vectors from different model versions", async () => {
    const clusterFaces = await loadClusterFaces();
    expect(clusterFaces).toBeTypeOf("function");
    if (!clusterFaces) return;
    expect(clusterFaces([
      { faceId: "a", shotId: "a", vector: [1, 0], modelVersion: "arcface-buffalo_l-v1" },
      { faceId: "b", shotId: "b", vector: [1, 0], modelVersion: "gemini-embedding-2" },
    ], { threshold: 0.3, minPhotos: 1 })).toEqual([["a"], ["b"]]);
  });
  it("groups identical vectors across different photos", async () => {
    const clusterFaces = await loadClusterFaces();
    expect(clusterFaces).toBeTypeOf("function");
    if (!clusterFaces) return;
    expect(clusterFaces([
      { faceId: "f1", shotId: "s1", vector: [1, 0] },
      { faceId: "f2", shotId: "s2", vector: [1, 0] },
    ], { threshold: 0.9, minPhotos: 2 })).toEqual([["f1", "f2"]]);
  });

  it("keeps orthogonal vectors in separate groups", async () => {
    const clusterFaces = await loadClusterFaces();
    expect(clusterFaces).toBeTypeOf("function");
    if (!clusterFaces) return;
    expect(clusterFaces([
      { faceId: "a", shotId: "s1", vector: [1, 0] },
      { faceId: "b", shotId: "s2", vector: [0, 1] },
    ], { threshold: 0.9, minPhotos: 1 })).toEqual([["a"], ["b"]]);
  });

  it("never groups two faces from the same shot even when vectors are identical", async () => {
    const clusterFaces = await loadClusterFaces();
    expect(clusterFaces).toBeTypeOf("function");
    if (!clusterFaces) return;
    expect(clusterFaces([
      { faceId: "a", shotId: "same-shot", vector: [1, 0] },
      { faceId: "b", shotId: "same-shot", vector: [1, 0] },
    ], { threshold: 0.9, minPhotos: 1 })).toEqual([["a"], ["b"]]);
  });

  it("drops groups that occur in fewer than minPhotos distinct shots", async () => {
    const clusterFaces = await loadClusterFaces();
    expect(clusterFaces).toBeTypeOf("function");
    if (!clusterFaces) return;
    expect(clusterFaces([
      { faceId: "main-1", shotId: "s1", vector: [1, 0] },
      { faceId: "main-2", shotId: "s2", vector: [1, 0] },
      { faceId: "stranger", shotId: "s3", vector: [0, 1] },
    ], { threshold: 0.9, minPhotos: 2 })).toEqual([["main-1", "main-2"]]);
  });

  it("returns the same sorted groups for every input order", async () => {
    const clusterFaces = await loadClusterFaces();
    expect(clusterFaces).toBeTypeOf("function");
    if (!clusterFaces) return;
    const faces = [
      { faceId: "z2", shotId: "s2", vector: [1, 0] },
      { faceId: "a1", shotId: "s1", vector: [1, 0] },
      { faceId: "y2", shotId: "s4", vector: [0, 1] },
      { faceId: "b1", shotId: "s3", vector: [0, 1] },
    ];
    const expected = [["a1", "z2"], ["b1", "y2"]];

    expect(clusterFaces(faces, { threshold: 0.9, minPhotos: 2 })).toEqual(expected);
    expect(clusterFaces([...faces].reverse(), { threshold: 0.9, minPhotos: 2 })).toEqual(expected);
  });
});
