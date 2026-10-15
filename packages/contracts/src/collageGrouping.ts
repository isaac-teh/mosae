import type { EditOp } from "./edits.js";
import type { Timeline } from "./timeline.js";

export type CollageGroupingInput = {
  timeline: Timeline;
  /** Confirmed people per shot (shotId -> personIds). Missing shots count as having no known people. */
  peopleByShot?: ReadonlyMap<string, readonly string[]>;
};

const idOf = (clip: Timeline["videoClips"][number]) => "kind" in clip ? clip.clipId : clip.id;

type Run = { ids: string[]; shotPeople: Set<string>[] };
export type CollageGroup = { clipIds: string[]; score: number; start: number };

function chapterIndexOf(timeline: Timeline, startSec: number): number {
  let chapter = 0;
  timeline.chapters.forEach((item, index) => { if (item.startSec <= startSec + 1e-6) chapter = index; });
  return chapter;
}

function cohesion(people: Set<string>[]): number {
  let shared = 0;
  for (let index = 1; index < people.length; index++) if ([...people[index]!].some((id) => people[index - 1]!.has(id))) shared++;
  return shared + 0.01 * people.length;
}

/** Partition one run of adjacent eligible photos into groups of 2-4, preferring groups whose neighbours share people. */
function partition(run: Run, offset: number): CollageGroup[] {
  const n = run.ids.length;
  const best: { score: number; groups: CollageGroup[] }[] = Array.from({ length: n + 1 }, () => ({ score: -Infinity, groups: [] }));
  best[0] = { score: 0, groups: [] };
  for (let end = 1; end <= n; end++) {
    if (best[end - 1]!.score > best[end]!.score) best[end] = best[end - 1]!;
    for (let size = 2; size <= 4 && size <= end; size++) {
      const previous = best[end - size]!;
      const group = { clipIds: run.ids.slice(end - size, end), score: cohesion(run.shotPeople.slice(end - size, end)), start: offset + end - size };
      const total = previous.score + group.score;
      if (total > best[end]!.score + 1e-9) best[end] = { score: total, groups: [...previous.groups, group] };
    }
  }
  return best[n]!.groups;
}

function eligibleGroups(input: CollageGroupingInput, keepEnds: boolean): CollageGroup[] {
  const { timeline, peopleByShot } = input;
  const clips = timeline.videoClips;
  const runs: { run: Run; offset: number; chapter: number }[] = [];
  let current: { run: Run; offset: number; chapter: number } | null = null;
  clips.forEach((clip, index) => {
    const isEnd = index === 0 || index === clips.length - 1;
    if ("kind" in clip || clip.source.kind !== "photo" || (keepEnds && isEnd)) { current = null; return; }
    const chapter = chapterIndexOf(timeline, clip.startSec);
    if (!current || current.chapter !== chapter) {
      current = { run: { ids: [], shotPeople: [] }, offset: index, chapter };
      runs.push(current);
    }
    current.run.ids.push(idOf(clip));
    current.run.shotPeople.push(new Set(peopleByShot?.get(clip.source.shotId) ?? []));
  });
  return runs.flatMap(({ run, offset }) => run.ids.length >= 2 ? partition(run, offset) : []);
}

/**
 * Choose disjoint groups of 2-4 adjacent photos that can become new collages.
 * Never uses videos or existing collages, never crosses a chapter boundary and
 * keeps the film's first and last moment as single photos when anything else
 * can be grouped. Chapters stand in for day and place; people break ties.
 */
export function planCollageGroups(input: CollageGroupingInput): CollageGroup[] {
  const kept = eligibleGroups(input, true);
  return kept.length ? kept : eligibleGroups(input, false);
}

export function planCollageMerges(input: CollageGroupingInput, intent: "more" | "most"): EditOp[] {
  const groups = planCollageGroups(input);
  const chosen = intent === "most"
    ? groups
    : [...groups].sort((a, b) => b.score - a.score || a.start - b.start).slice(0, input.timeline.videoClips.length >= 6 ? 2 : 1).sort((a, b) => a.start - b.start);
  return chosen.map((group): EditOp => ({ op: "mergeIntoCollage", clipIds: group.clipIds }));
}
