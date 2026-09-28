import type { Cast, FaceRef } from "./types.js";

export function castSummary(
  cast: Cast,
  faces: FaceRef[],
  identities: Map<string, string>,
): string | null {
  // Firestore casts created before prominence counts were introduced have no
  // subjectCount. Read them as zero while preserving the stored object.
  const people = cast.people.map((person) => ({ ...person, subjectCount: person.subjectCount ?? 0 }));
  if (people.length === 0) {
    return null;
  }

  const parents = people.filter((p) => p.role === "parent").length;
  const children = people.filter((p) => p.role === "child").length;

  const focusText = children > 0 ? "children" : "the family";

  let k = 0;
  if (cast.core.length > 0) {
    const shotPeople = new Map<string, Set<string>>();
    for (const f of faces) {
      if (f.prominence !== "background" && identities.has(f.faceId)) {
        const personId = identities.get(f.faceId)!;
        let set = shotPeople.get(f.shotId);
        if (!set) {
          set = new Set<string>();
          shotPeople.set(f.shotId, set);
        }
        set.add(personId);
      }
    }

    for (const personSet of shotPeople.values()) {
      if (cast.core.every((coreId) => personSet.has(coreId))) {
        k++;
      }
    }
  }

  return `${parents} parents, ${children} children; focus: ${focusText}; all core together in ${k} photos.`;
}
