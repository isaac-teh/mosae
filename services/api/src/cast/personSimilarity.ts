import { cosine } from "./clusterFaces.js";

export function closestPersonSimilarity(faces: { personId: string; vector: number[]; faceId?: string; shotId?: string; modelVersion?: string }[]): Map<string, { personId: string; similarity: number }> {
  const groups = new Map<string, { vector: number[]; modelVersion?: string }[]>();
  for (const face of faces) groups.set(face.personId, [...(groups.get(face.personId) ?? []), { vector: face.vector, modelVersion: face.modelVersion }]);
  const closest = new Map<string, { personId: string; similarity: number }>();
  for (const [personId, vectors] of groups) for (const [otherId, otherVectors] of groups) {
    if (personId === otherId) continue;
    const pairs = vectors.flatMap((left) => otherVectors.filter((right) => left.modelVersion === right.modelVersion).map((right) => cosine(left.vector, right.vector)));
    if (!pairs.length) continue;
    const similarity = pairs.reduce((sum, value) => sum + value, 0) / pairs.length;
    if (similarity > (closest.get(personId)?.similarity ?? -Infinity)) closest.set(personId, { personId: otherId, similarity });
  }
  return closest;
}
