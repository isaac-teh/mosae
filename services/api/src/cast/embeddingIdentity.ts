import { clusterFaces, type FaceVector } from "./clusterFaces.js";
import type { FaceRef, IdentityResolver } from "./types.js";

export type EmbeddedFace = FaceVector & { characterId?: string };

export function embeddingIdentity(opts: { threshold: number }): IdentityResolver & {
  resolveVectors(faces: EmbeddedFace[]): Map<string, string>;
} {
  const resolveVectors = (faces: EmbeddedFace[]): Map<string, string> => {
    const vectors = faces.filter((face) => Array.isArray(face.vector) && face.vector.length > 0);
    const groups = clusterFaces(vectors, { threshold: opts.threshold, minPhotos: 1 }).map((ids) =>
      ids.map((id) => vectors.find((face) => face.faceId === id)!).filter(Boolean))
      .filter((group) => new Set(group.map((face) => face.shotId)).size >= 2);
    const result = new Map<string, string>();
    groups.sort((a, b) => a[0]!.faceId.localeCompare(b[0]!.faceId));
    for (const group of groups) {
      const assigned = [...new Set(group.map((face) => face.characterId).filter((id): id is string => Boolean(id)))].sort();
      const personId = assigned[0] ?? `person-${group.map((face) => face.faceId).sort()[0]}`;
      for (const face of group) result.set(face.faceId, face.characterId ?? personId);
    }
    return result;
  };
  return {
    source: "embeddings",
    resolve: (faces: FaceRef[]) => resolveVectors(faces.filter((face): face is FaceRef & { vector: number[] } => Array.isArray(face.vector)) as EmbeddedFace[]),
    resolveVectors,
  };
}
