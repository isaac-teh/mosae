import { FACE_RECONCILE_MARGIN, FACE_RECONCILE_THRESHOLD } from "../config.js";
import { cosine } from "./clusterFaces.js";

export type ReconciliationFace = { faceId: string; shotId: string; vector: number[]; characterId?: string; modelVersion?: string };

/** Find individual pending faces that closely match a user's confirmed identity. */
export function reconcileConfirmedFaces(
  faces: ReconciliationFace[],
  confirmedPersonId: string,
  threshold = FACE_RECONCILE_THRESHOLD,
  pendingPersonIds?: ReadonlySet<string>,
  margin = FACE_RECONCILE_MARGIN,
): Map<string, string> {
  const references = faces.filter((face) => face.characterId === confirmedPersonId);
  if (references.length === 0) return new Map();
  const otherReferences = new Map<string, ReconciliationFace[]>();
  for (const face of faces) {
    if (!face.characterId || face.characterId === confirmedPersonId || pendingPersonIds?.has(face.characterId)) continue;
    otherReferences.set(face.characterId, [...(otherReferences.get(face.characterId) ?? []), face]);
  }
  const matches = new Map<string, string>();
  for (const candidate of faces) {
    if (candidate.characterId === confirmedPersonId || references.some((reference) => reference.shotId === candidate.shotId)) continue;
    if (pendingPersonIds && (!candidate.characterId || !pendingPersonIds.has(candidate.characterId))) continue;
    const bestByPerson = new Map<string, number>();
    for (const reference of references) if (candidate.modelVersion === reference.modelVersion) bestByPerson.set(confirmedPersonId, Math.max(bestByPerson.get(confirmedPersonId) ?? -1, cosine(candidate.vector, reference.vector)));
    for (const [personId, personFaces] of otherReferences) for (const reference of personFaces) {
      if (candidate.modelVersion !== reference.modelVersion) continue;
      bestByPerson.set(personId, Math.max(bestByPerson.get(personId) ?? -1, cosine(candidate.vector, reference.vector)));
    }
    const ranked = [...bestByPerson].sort((a, b) => b[1] - a[1]);
    if (ranked[0]?.[0] === confirmedPersonId && ranked[0][1] >= threshold && ranked[0][1] - (ranked[1]?.[1] ?? -1) >= margin) matches.set(candidate.faceId, confirmedPersonId);
  }
  return matches;
}
