import type { Cast, FaceRef } from "./types.js";

export function castSummary(
  cast: Cast,
  faces: FaceRef[],
  identities: Map<string, string>,
  explicitFocus?: string,
): string | null {
  // Firestore casts created before prominence counts were introduced have no
  // subjectCount. Read them as zero while preserving the stored object.
  const people = cast.people.map((person) => ({ ...person, subjectCount: person.subjectCount ?? 0 }));
  if (people.length === 0) {
    return null;
  }

  const parents = people.filter((p) => p.role === "parent").length;
  const children = people.filter((p) => p.role === "child").length;

  const selectedIds = explicitFocus && explicitFocus !== "family" ? [...new Set(explicitFocus.split(",").filter(Boolean))] : [];
  const selected = selectedIds.map(id => people.find(person => person.personId === id && !person.excluded)).filter((person): person is typeof people[number] => person !== undefined);
  const personLabel = (person: typeof people[number]) => person.name?.trim() || (person.role === "parent" ? "a parent" : person.role === "child" ? "your child" : "this person");
  const focusText = explicitFocus === undefined ? (children > 0 ? "children" : "the family")
    : explicitFocus === "family" ? "everyone"
    : selected.map(personLabel).join(" and ");

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
    for (const person of people) for (const shotId of person.manualShots ?? []) {
      if ((person.removedShots ?? []).includes(shotId)) continue;
      let set = shotPeople.get(shotId);
      if (!set) { set = new Set<string>(); shotPeople.set(shotId, set); }
      set.add(person.personId);
    }

    for (const personSet of shotPeople.values()) {
      if (cast.core.every((coreId) => personSet.has(coreId))) {
        k++;
      }
    }
  }

  return `${parents} parents, ${children} children; focus: ${focusText}; all core together in ${k} photos.`;
}
