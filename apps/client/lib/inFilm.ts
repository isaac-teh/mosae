import type { Moment } from "@mosae/core";
import type { Timeline } from "@mosae/contracts";

export function getInFilmShotIds(timeline: Timeline | null | undefined): Set<string> {
  if (!timeline) return new Set();
  return new Set(timeline.videoClips.flatMap((clip) => "kind" in clip
    ? clip.spec.slots.flatMap((slot) => slot.shotId ? [slot.shotId] : [])
    : [clip.source.shotId]));
}

// Uploaded replacements and collage sources may not appear in the original plan.
export function includeTimelineMedia(moments: Moment[], timeline: Timeline | null | undefined, sources: Record<string, string>, thumbnails: Record<string, string>): Moment[] {
  const library = new Map(moments.filter(moment => moment.shotId).map(moment => [moment.shotId!, moment]));
  for (const clip of timeline?.videoClips ?? []) {
    const media = "kind" in clip ? clip.spec.slots : [clip.source];
    for (const item of media) {
      if (!item.shotId || library.has(item.shotId)) continue;
      const video = item.kind === "video";
      library.set(item.shotId, {
        id: `timeline-${item.shotId}`, shotId: item.shotId, title: video ? "Video clip" : "Photo", meta: "In film",
        tag: { emoji: video ? "🎬" : "📷", label: video ? "Video" : "Photo" },
        kind: video ? "video" : "photo", imageKey: video ? thumbnails[item.shotId] ?? "" : sources[item.shotId] ?? "",
        selected: false, favorite: false,
        ...("sourceInSec" in item ? { sourceInSec: item.sourceInSec, sourceOutSec: item.sourceOutSec, sourceDurationSec: item.sourceDurationSec } : {}),
        ...(item.width !== undefined ? { width: item.width } : {}), ...(item.height !== undefined ? { height: item.height } : {}),
      });
    }
  }
  return [...library.values()];
}
