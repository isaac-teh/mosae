import { photoRoles, type BBox } from "./prominence.js";
import type { Cast } from "./types.js";

export type LeaveOutShot = { shotId: string; faces: { bbox: BBox; personId: string | null }[] };
export type LeftOut = { shotId: string; reason: string };

/** Returns user-hidden shots and photos whose subjects should not enter planning. */
export function leaveOutShots(shots: LeaveOutShot[], cast: Cast, hiddenShotIds: string[]): LeftOut[] {
  const hidden = new Set(hiddenShotIds);
  const inCast = new Set(cast.people.map((person) => person.personId));
  const excluded = new Map(cast.people.filter((person) => person.excluded).map((person) => [person.personId, person.name ?? "someone you left out"]));
  const out: LeftOut[] = [];
  for (const shot of shots) {
    if (hidden.has(shot.shotId)) { out.push({ shotId: shot.shotId, reason: "Hidden by you." }); continue; }
    if (shot.faces.length === 0) continue;
    const roles = photoRoles(shot.faces.map((face) => face.bbox));
    const subjects = shot.faces.filter((_, index) => roles[index] === "subject");
    const excludedSubject = subjects.find((face) => face.personId && excluded.has(face.personId));
    if (excludedSubject) {
      out.push({ shotId: shot.shotId, reason: `Left out: ${excluded.get(excludedSubject.personId!)} is the main subject.` });
      continue;
    }
    const castSubject = subjects.some((face) => face.personId && inCast.has(face.personId) && !excluded.has(face.personId));
    const strangerSubject = subjects.some((face) => !face.personId || !inCast.has(face.personId));
    if (!castSubject && strangerSubject) out.push({ shotId: shot.shotId, reason: "Left out: someone outside the family is the main subject." });
  }
  return out;
}
