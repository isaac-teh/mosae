// The film's star: the child most often the subject of a photo. A second child
// close behind is a co-star. With no children, the most prominent core person.
import type { CastPerson } from "./types.js";

export const COSTAR_RATIO = 0.7;

export function chooseFocus(people: CastPerson[], core: string[]): string[] {
  const eligible = people.filter((person) => !person.excluded && core.includes(person.personId) && person.subjectCount > 0);
  const children = eligible.filter((person) => person.role === "child").sort((a, b) => b.subjectCount - a.subjectCount);
  if (children.length > 0) {
    const top = children[0]!.subjectCount;
    return children.filter((child) => child.subjectCount >= top * COSTAR_RATIO).map((child) => child.personId);
  }
  const best = [...eligible].sort((a, b) => b.subjectCount - a.subjectCount)[0];
  return best ? [best.personId] : [];
}
