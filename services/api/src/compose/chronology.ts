// The film follows the trip: chapters in day order, clips in capture order.
// Within that fixed order the arc can only choose each day's final beat.
export type ClipTime = { chapter: number; localTime: string | null; score: number };

export function orderByChronology<T extends { itemId: string }>(clips: T[], timeOf: Map<string, ClipTime>): T[] {
  const key = (clip: T) => timeOf.get(clip.itemId) ?? { chapter: Number.MAX_SAFE_INTEGER, localTime: null, score: 0 };
  return clips.map((clip, i) => ({ clip, i })).sort((x, y) => {
    const a = key(x.clip), b = key(y.clip);
    if (a.chapter !== b.chapter) return a.chapter - b.chapter;
    if (a.localTime && b.localTime) return a.localTime.localeCompare(b.localTime) || x.i - y.i;
    if (a.localTime) return -1;
    if (b.localTime) return 1;
    return x.i - y.i;
  }).map(({ clip }) => clip);
}

export function applyArc<T extends { itemId: string }>(clips: T[], timeOf: Map<string, ClipTime>): { clips: T[]; reasons: string[] } {
  const chapters = [...new Set(clips.map((c) => timeOf.get(c.itemId)?.chapter ?? 0))];
  if (chapters.length < 2) return { clips, reasons: [] };
  const out: T[] = [];
  chapters.forEach((chapter, index) => {
    const group = clips.filter((c) => (timeOf.get(c.itemId)?.chapter ?? 0) === chapter);
    if (index === chapters.length - 1 || group.length < 2) { out.push(...group); return; }
    const peak = group.reduce((best, clip) => (timeOf.get(clip.itemId)?.score ?? 0) > (timeOf.get(best.itemId)?.score ?? 0) ? clip : best);
    out.push(...group.filter((clip) => clip !== peak), peak);
  });
  return { clips: out, reasons: ["Each day builds to its best moment."] };
}
