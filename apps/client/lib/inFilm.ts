import type { Timeline } from "@mosae/contracts";

export function getInFilmShotIds(timeline: Timeline | null | undefined): Set<string> {
  if (!timeline) return new Set();
  return new Set(timeline.videoClips.flatMap((clip) => "kind" in clip
    ? clip.spec.slots.flatMap((slot) => slot.shotId ? [slot.shotId] : [])
    : [clip.source.shotId]));
}
