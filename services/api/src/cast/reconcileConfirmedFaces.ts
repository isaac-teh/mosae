import { FACE_RECONCILE_THRESHOLD } from "../config.js";
import { cosine } from "./clusterFaces.js";

export type ReconciliationFace = { faceId: string; shotId: string; vector: number[]; characterId?: string };

/** Find individual pending faces that closely match a user's confirmed identity. */
export function reconcileConfirmedFaces(
  faces: ReconciliationFace[],
  confirmedPersonId: string,
  threshold = FACE_RECONCILE_THRESHOLD,
  pendingPersonIds?: ReadonlySet<string>,
): Map<string, string> {
  const references = faces.filter((face) => face.characterId === confirmedPersonId);
  if (references.length === 0) return new Map();
  const referenceShots = new Set(references.map((face) => face.shotId));
  const matches = new Map<string, string>();
  for (const candidate of faces) {
    if (candidate.characterId === confirmedPersonId || referenceShots.has(candidate.shotId)) continue;
    if (pendingPersonIds && (!candidate.characterId || !pendingPersonIds.has(candidate.characterId))) continue;
    if (references.some((reference) => cosine(candidate.vector, reference.vector) >= threshold)) matches.set(candidate.faceId, confirmedPersonId);
  }
  return matches;
}
