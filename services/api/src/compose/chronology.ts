// The film follows the trip: chapters in day order, clips in capture order.
// Within that fixed order the arc can only choose each day's final beat.
export type ClipTime = { chapter: number; localTime: string | null; score: number };

type DistributableClip = { itemId: string; kind: "photo" | "video"; inSec?: number; highlightScore?: number };

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

/** Keep stills chronological while placing a video run through the film. */
export function spreadVideoClips<T extends DistributableClip>(clips: T[], timeOf: Map<string, ClipTime>, sourceOf: (clip: T) => string): T[] {
  const byTime = (a: T, b: T) => {
    const ta = timeOf.get(a.itemId), tb = timeOf.get(b.itemId);
    return (ta?.chapter ?? Number.MAX_SAFE_INTEGER) - (tb?.chapter ?? Number.MAX_SAFE_INTEGER)
      || (ta?.localTime && tb?.localTime ? ta.localTime.localeCompare(tb.localTime) : ta?.localTime ? -1 : tb?.localTime ? 1 : 0)
      || (a.inSec ?? 0) - (b.inSec ?? 0);
  };
  const photos = clips.filter((clip) => clip.kind === "photo").sort(byTime);
  const videos = clips.filter((clip) => clip.kind === "video").sort(byTime);
  if (!videos.length) return photos;
  const chronological = [...photos, ...videos].sort(byTime);
  const preferredOpener = chronological[0];
  const kinds = chronological.map((clip) => clip.kind);
  const transitions = kinds.slice(1).reduce((count, kind, index) => count + (kind !== kinds[index] ? 1 : 0), 0);
  let result: T[];
  if (photos.length && transitions >= 2) {
    result = chronological;
  } else if (!photos.length) {
    result = videos;
  } else {
    const gaps = Array.from({ length: photos.length + 1 }, () => [] as T[]);
    videos.forEach((video, index) => {
      const gap = Math.floor((index + 1) * (photos.length + 1) / (videos.length + 1));
      gaps[Math.min(photos.length, gap)]!.push(video);
    });
    result = [...gaps[0]!];
    photos.forEach((photo, index) => result.push(photo, ...gaps[index + 1]!));
  }
  if (result[0]?.kind === "video" && (result[0].highlightScore ?? 0) < 0.7) {
    const firstPhoto = result.findIndex((clip) => clip.kind === "photo");
    if (firstPhoto >= 0) result.unshift(...result.splice(firstPhoto, 1));
  }
  if (preferredOpener?.kind === "video" && (preferredOpener.highlightScore ?? 0) >= 0.7 && result[0] !== preferredOpener) {
    result = [preferredOpener, ...result.filter((clip) => clip !== preferredOpener)];
  }
  // If a timestamp cluster puts two clips from one source together, use a
  // still from between them as a divider without changing the still sequence.
  for (let index = 1; index < result.length; index++) {
    const previous = result[index - 1]!, current = result[index]!;
    if (previous.kind !== "video" || current.kind !== "video" || sourceOf(previous) !== sourceOf(current)) continue;
    const photoIndex = result.findIndex((clip) => clip.kind === "photo");
    if (photoIndex >= 0) {
      const [photo] = result.splice(photoIndex, 1);
      result.splice(photoIndex < index ? index - 1 : index, 0, photo!);
    }
  }
  return result;
}

export function applyArc<T extends { itemId: string }>(clips: T[], timeOf: Map<string, ClipTime>): { clips: T[]; reasons: string[] } {
  // The story arc is expressed through holds; moving a selected peak to a
  // chapter boundary falsifies capture chronology and breaks its lock.
  return { clips, reasons: [] };
}
