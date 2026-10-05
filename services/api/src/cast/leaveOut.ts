import { photoRoles, type BBox } from "./prominence.js";
import type { Cast } from "./types.js";

/** `stranger` marks a face known not to be family; an unrecognised face is just unknown. */
export type LeaveOutShot = { shotId: string; blurry?: boolean; dupOf?: string | null; faces: { bbox: BBox; personId: string | null; stranger?: boolean }[] };
export type LeftOut = { shotId: string; reason: string };

/** Returns hidden, low-quality, duplicate, and cast-excluded photos for review. */
export function leaveOutShots(shots: LeaveOutShot[], cast: Cast, hiddenShotIds: string[]): LeftOut[] {
  const hidden = new Set(hiddenShotIds);
  const inCast = new Set(cast.people.map((person) => person.personId));
  const excluded = new Map(cast.people.filter((person) => person.excluded).map((person) => [person.personId, person.name ?? "someone you left out"]));
  const out: LeftOut[] = [];
  for (const shot of shots) {
    if (hidden.has(shot.shotId)) { out.push({ shotId: shot.shotId, reason: "Hidden by you." }); continue; }
    if (shot.blurry) { out.push({ shotId: shot.shotId, reason: "Blurry photo" }); continue; }
    if (shot.dupOf) { out.push({ shotId: shot.shotId, reason: "Similar photo — best one kept" }); continue; }
    if (shot.faces.length === 0) continue;
    const roles = photoRoles(shot.faces.map((face) => face.bbox));
    const subjects = shot.faces.filter((_, index) => roles[index] === "subject");
    const excludedSubject = subjects.find((face) => face.personId && excluded.has(face.personId));
    if (excludedSubject) {
      out.push({ shotId: shot.shotId, reason: `Left out: ${excluded.get(excludedSubject.personId!)} is the main subject.` });
      continue;
    }
    const castSubject = subjects.some((face) => face.personId && inCast.has(face.personId) && !excluded.has(face.personId));
    // Only a face known to be someone else counts. An unrecognised face may be
    // family the recogniser missed, and a missed match must never drop a photo.
    const strangerSubject = subjects.some((face) => face.stranger || (face.personId !== null && !inCast.has(face.personId)));
    if (!strangerSubject) continue;
    // A stranger as prominent as the family spoils the photo even with the
    // family in it; only a small background stranger (a photobomber) is kept.
    out.push({ shotId: shot.shotId, reason: castSubject
      ? "Left out: someone outside the family is as prominent as the family."
      : "Left out: someone outside the family is the main subject." });
  }
  return out;
}
