import type { AudioClip, Timeline } from "./timeline.js";

type SoundtrackClip = Omit<AudioClip, "source"> & { source: { kind: "soundtrack"; soundtrackId: string; sourceInSec: number; sourceOutSec: number } };
const isSoundtrackClip = (clip: AudioClip): clip is SoundtrackClip => clip.role === "music" && clip.source.kind === "soundtrack";

/** Refit soundtrack source windows and fades after the picture duration changes. */
export function refitSoundtrackToDuration(
  timeline: Timeline,
  sourceDurations: ReadonlyMap<string, number> = new Map(),
): Timeline {
  if (!(timeline.durationSec > 0)) return timeline;
  const music = timeline.audioClips.filter(isSoundtrackClip);
  if (!music.length) return timeline;

  let clips: AudioClip[] = timeline.audioClips.filter((clip) => !isSoundtrackClip(clip));
  const byTrack = new Map<string, SoundtrackClip[]>();
  for (const clip of music) {
    if (clip.source.kind !== "soundtrack") continue;
    const list = byTrack.get(clip.source.soundtrackId) ?? [];
    list.push(clip);
    byTrack.set(clip.source.soundtrackId, list);
  }

  for (const [soundtrackId, segments] of byTrack) {
    segments.sort((a, b) => a.startSec - b.startSec);
    const duration = sourceDurations.get(soundtrackId) ?? Infinity;
    const first = segments[0]!;
    const last = segments.at(-1)!;
    const start = Math.max(0, first.startSec);
    const targetSourceOut = Math.min(duration, last.source.sourceOutSec + Math.max(0, timeline.durationSec - (last.startSec + last.source.sourceOutSec - last.source.sourceInSec)));
    const availableToExtend = Math.max(0, targetSourceOut - last.source.sourceOutSec);
    let fittedSegments = segments.map((segment) => ({ ...segment }));
    if (availableToExtend > 0 && last.startSec + (last.source.sourceOutSec - last.source.sourceInSec) < timeline.durationSec) {
      const extended = { ...last, source: { ...last.source, sourceOutSec: targetSourceOut }, fadeOutSec: Math.min(1, timeline.durationSec * 0.05) };
      fittedSegments = [...segments.slice(0, -1), extended];
      if (last.startSec + (targetSourceOut - last.source.sourceInSec) >= timeline.durationSec) {
        clips.push(...fittedSegments);
        continue;
      }
    }
    const existingEnd = Math.max(...fittedSegments.map((segment) => segment.startSec + segment.source.sourceOutSec - segment.source.sourceInSec));
    const fittedToFilm = fittedSegments.map((segment) => {
      const available = Math.max(0, Math.min(timeline.durationSec, segment.startSec + segment.source.sourceOutSec - segment.source.sourceInSec) - segment.startSec);
      return { ...segment, source: { ...segment.source, sourceOutSec: segment.source.sourceInSec + Math.min(segment.source.sourceOutSec - segment.source.sourceInSec, available) }, fadeOutSec: segment === last ? Math.min(1, timeline.durationSec * 0.05) : segment.fadeOutSec };
    }).filter((segment) => segment.source.sourceOutSec > segment.source.sourceInSec);
    clips.push(...fittedToFilm);
    if (existingEnd >= timeline.durationSec - 1e-6) continue;

    const segmentLength = Math.min(duration, Math.max(...fittedSegments.map((segment) => segment.source.sourceOutSec - segment.source.sourceInSec)));
    if (!(segmentLength > 0)) continue;
    const transition = Math.min(0.5, segmentLength / 2);
    let nextStart = Math.max(start, existingEnd - transition);
    let coveredEnd = existingEnd;
    let suffix = 1;
    let previousId = last.id;
    while (coveredEnd < timeline.durationSec - 1e-6) {
      const length = Math.min(segmentLength, timeline.durationSec - nextStart);
      const fade = Math.min(0.5, length / 2);
      const previousIndex = clips.findIndex((clip) => clip.id === previousId);
      if (previousIndex >= 0) clips[previousIndex] = { ...clips[previousIndex]!, fadeOutSec: fade };
      const next: AudioClip = { ...last, id: `${last.id}-loop-${suffix++}`, startSec: nextStart, source: { ...last.source, sourceInSec: 0, sourceOutSec: length }, fadeInSec: fade, fadeOutSec: Math.min(1, timeline.durationSec * 0.05) };
      clips.push(next);
      previousId = next.id;
      const previousCoveredEnd = coveredEnd;
      coveredEnd = Math.max(coveredEnd, nextStart + length);
      nextStart += Math.max(length - fade, length * 0.75);
      if (coveredEnd <= previousCoveredEnd) break;
    }
  }

  const originalOrder = new Map(timeline.audioClips.map((clip, index) => [clip.id, index]));
  const orderOf = (clip: AudioClip) => originalOrder.get(clip.id)
    ?? [...originalOrder].find(([id]) => clip.id.startsWith(`${id}-loop-`))?.[1]
    ?? Number.MAX_SAFE_INTEGER;
  clips.sort((a, b) => orderOf(a) - orderOf(b) || a.startSec - b.startSec);
  return { ...timeline, audioClips: clips };
}
