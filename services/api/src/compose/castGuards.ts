import type { AssembledClip } from "./assemble.js";

export type GuardInput = {
  clips: AssembledClip[];
  unused: AssembledClip[];
  core: string[];
  focus: string[];
  peopleByMoment: Map<string, Set<string>>;
  subjectsByMoment: Map<string, Set<string>>;
  chapterOf: Map<string, number>;
  label: (personId: string) => string;
};

export function applyCastGuards(input: GuardInput): { clips: AssembledClip[]; reasons: string[]; opened: boolean; closed: boolean } {
  if (input.core.length === 0) return { clips: input.clips, reasons: [], opened: false, closed: false };
  const clips = [...input.clips];
  const unused = [...input.unused];
  const reasons: string[] = [];
  const chapters = [...input.chapterOf.values()];
  const firstChapter = chapters.length ? Math.min(...chapters) : 1;
  const lastChapter = chapters.length ? Math.max(...chapters) : 1;
  const castOn = (clip: AssembledClip) => input.peopleByMoment.get(clip.itemId) ?? new Set<string>();
  const counts = () => {
    const out = new Map<string, number>();
    for (const clip of clips) for (const id of castOn(clip)) out.set(id, (out.get(id) ?? 0) + 1);
    return out;
  };

  // Coverage swaps the least populated replaceable clip for an unused core photo.
  let coverageChanged = false;
  for (const person of input.core) {
    if (clips.some((clip) => castOn(clip).has(person))) continue;
    const replacement = unused.findIndex((clip) => castOn(clip).has(person) && clips.some((selected) => input.chapterOf.get(selected.itemId) === input.chapterOf.get(clip.itemId)));
    if (replacement < 0 || clips.length === 0) continue;
    const replacementChapter = input.chapterOf.get(unused[replacement]!.itemId);
    const currentCounts = counts();
    const removable = clips.map((clip, index) => ({ clip, index, people: castOn(clip) }))
      .filter(({ clip }) => input.chapterOf.get(clip.itemId) === replacementChapter)
      .filter(({ people }) => [...people].every((id) => !input.core.includes(id) || (currentCounts.get(id) ?? 0) > 1))
      .sort((a, b) => a.people.size - b.people.size || a.index - b.index)[0];
    if (!removable) continue;
    const [added] = unused.splice(replacement, 1);
    unused.push(removable.clip);
    clips[removable.index] = { ...added!, order: removable.index };
    coverageChanged = true;
    reasons.push(`Added a photo of ${input.label(person)} so everyone in the family is in the film.`);
  }
  if (!coverageChanged && input.core.every((person) => clips.some((clip) => castOn(clip).has(person)))) reasons.push("Everyone in the family is in the film.");

  // Focus share counts only clips where a focus person is a subject.
  let swaps = 0;
  let focused = false;
  while (swaps < clips.length) {
    const peopleClips = clips.filter((clip) => castOn(clip).size > 0);
    const subjectsOn = (clip: AssembledClip) => input.subjectsByMoment.get(clip.itemId) ?? new Set<string>();
    const focusClips = peopleClips.filter((clip) => [...subjectsOn(clip)].some((id) => input.focus.includes(id)));
    if (peopleClips.length === 0 || focusClips.length / peopleClips.length >= 0.5) break;
    const addIndex = unused.findIndex((clip) => [...subjectsOn(clip)].some((id) => input.focus.includes(id))
      && clips.some((selected) => input.chapterOf.get(selected.itemId) === input.chapterOf.get(clip.itemId)));
    if (addIndex < 0) break;
    const addChapter = input.chapterOf.get(unused[addIndex]!.itemId);
    const currentCounts = counts();
    const removeIndex = clips.findIndex((clip) => input.chapterOf.get(clip.itemId) === addChapter && castOn(clip).size > 0 && ![...subjectsOn(clip)].some((id) => input.focus.includes(id))
      && [...castOn(clip)].every((id) => !input.core.includes(id) || (currentCounts.get(id) ?? 0) > 1));
    if (removeIndex < 0) break;
    const [added] = unused.splice(addIndex, 1);
    unused.push(clips[removeIndex]!);
    clips[removeIndex] = { ...added!, order: removeIndex };
    swaps++;
    focused = true;
  }
  if (focused) reasons.push(`Centred the film on ${input.focus.map(input.label).join(" and ")}.`);
  else {
    const peopleClips = clips.filter((clip) => castOn(clip).size > 0);
    const focusClips = peopleClips.filter((clip) => [...(input.subjectsByMoment.get(clip.itemId) ?? new Set<string>())].some((id) => input.focus.includes(id)));
    if (peopleClips.length > 0 && focusClips.length / peopleClips.length >= 0.5) reasons.push(`Centred the film on ${input.focus.map(input.label).join(" and ")}.`);
  }

  let closed = false;
  const together = clips.map((clip, index) => ({ clip, index }))
    .filter(({ clip }) => input.chapterOf.get(clip.itemId) === lastChapter && input.core.every((id) => castOn(clip).has(id))).at(-1);
  if (together) {
    closed = true;
    if (together.index !== clips.length - 1) {
      clips.splice(together.index, 1);
      clips.push(together.clip);
    }
    reasons.push("Closing on the whole family together.");
  }
  const establishing = clips.findIndex((clip) => input.chapterOf.get(clip.itemId) === firstChapter && castOn(clip).size === 0);
  let opened = false;
  if (establishing > 0) {
    const [opener] = clips.splice(establishing, 1);
    clips.unshift(opener!);
    reasons.push("Opening on the place before the people.");
    opened = true;
  }
  return { clips: clips.map((clip, order) => ({ ...clip, order })), reasons, opened, closed };
}
