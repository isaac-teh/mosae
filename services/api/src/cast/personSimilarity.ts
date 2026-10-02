import { cosine } from "./clusterFaces.js";

export function closestPersonSimilarity(faces: { personId: string; vector: number[]; faceId?: string; shotId?: string }[]): Map<string, { personId: string; similarity: number }> {
  const groups = new Map<string, number[][]>();
  for (const face of faces) groups.set(face.personId, [...(groups.get(face.personId) ?? []), face.vector]);
  const closest = new Map<string, { personId: string; similarity: number }>();
  for (const [personId, vectors] of groups) for (const [otherId, otherVectors] of groups) {
    if (personId === otherId) continue;
    const similarity = vectors.reduce((sum, left) => sum + otherVectors.reduce((inner, right) => inner + cosine(left, right), 0), 0) / (vectors.length * otherVectors.length);
    if (similarity > (closest.get(personId)?.similarity ?? -Infinity)) closest.set(personId, { personId: otherId, similarity });
  }
  return closest;
}
