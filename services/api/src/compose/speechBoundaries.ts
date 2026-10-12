import type { Timeline } from "@mosae/contracts";
import { syncCollageDurations } from "@mosae/contracts";
import type { TranscriptSegment } from "./buildCandidates.js";

export const SPEECH_BOUNDARY_TOLERANCE_SEC = 0.15;
export const MAX_COMPLETE_SPEECH_CLIP_SEC = 8;

export interface SpeechBoundaryViolation {
  clipId: string;
  shotId: string;
  edge: "start" | "end";
  boundarySec: number;
  segment: TranscriptSegment;
}
const clipId = (clip: Timeline["videoClips"][number]) => "kind" in clip ? clip.clipId : clip.id;

/** Find video source edges that land inside a transcript segment. */
export function findSpeechBoundaryViolations(
  timeline: Timeline,
  segmentsByShot: ReadonlyMap<string, readonly TranscriptSegment[]>,
  toleranceSec = SPEECH_BOUNDARY_TOLERANCE_SEC,
): SpeechBoundaryViolation[] {
  const violations: SpeechBoundaryViolation[] = [];
  for (const clip of timeline.videoClips) {
    if (!("source" in clip) || clip.source.kind !== "video") continue;
    const id = clipId(clip);
    const segments = segmentsByShot.get(clip.source.shotId) ?? [];
    for (const segment of segments) {
      for (const [edge, boundarySec] of [["start", clip.source.sourceInSec], ["end", clip.source.sourceOutSec]] as const) {
        if (boundarySec > segment.startSec + toleranceSec && boundarySec < segment.endSec - toleranceSec) {
          violations.push({ clipId: id, shotId: clip.source.shotId, edge, boundarySec, segment });
        }
      }
    }
  }
  return violations;
}

/** Extend illegal edges to full sentence boundaries when the result stays <= 8s. */
export function repairSpeechBoundaries(
  timeline: Timeline,
  segmentsByShot: ReadonlyMap<string, readonly TranscriptSegment[]>,
  toleranceSec = SPEECH_BOUNDARY_TOLERANCE_SEC,
): Timeline {
  const repaired = structuredClone(timeline);
  const changes: Array<{ clipId: string; shotId: string; oldStart: number; oldEnd: number; delta: number; sourceIn: number; sourceOut: number }> = [];
  for (const clip of repaired.videoClips) {
    if (!("source" in clip) || clip.source.kind !== "video") continue;
    const segments = segmentsByShot.get(clip.source.shotId) ?? [];
    let start = clip.source.sourceInSec;
    let end = clip.source.sourceOutSec;
    for (const segment of segments) {
      if (start > segment.startSec + toleranceSec && start < segment.endSec - toleranceSec) start = segment.startSec;
      if (end > segment.startSec + toleranceSec && end < segment.endSec - toleranceSec) end = segment.endSec;
    }
    if (end - start <= MAX_COMPLETE_SPEECH_CLIP_SEC + toleranceSec) {
      const oldStart = clip.startSec;
      const oldEnd = oldStart + clip.durationSec;
      const delta = end - start - clip.durationSec;
      clip.source.sourceInSec = Number(start.toFixed(2));
      clip.source.sourceOutSec = Number(end.toFixed(2));
      clip.durationSec = Number((end - start).toFixed(2));
      if (Math.abs(delta) > 0.001) changes.push({ clipId: clipId(clip), shotId: clip.source.shotId, oldStart, oldEnd, delta, sourceIn: start, sourceOut: end });
    }
  }
  // Keep downstream picture, source audio, captions, chapters and total length
  // in sync when a repair extends a clip. The overlap into the clip is kept
  // unchanged by shifting later clip starts by the same amount.
  for (const change of changes) {
    for (const clip of repaired.videoClips) {
      const originalStart = clip.startSec;
      if (clipId(clip) !== change.clipId && originalStart > change.oldStart + toleranceSec) clip.startSec = Number((originalStart + change.delta).toFixed(2));
    }
    for (const audio of repaired.audioClips) {
      if (audio.source.kind === "asset" && audio.source.assetId === change.shotId && audio.role === "speech") {
        audio.source.sourceInSec = change.sourceIn;
        audio.source.sourceOutSec = change.sourceOut;
        audio.startSec = repaired.videoClips.find(clip => clipId(clip) === change.clipId)?.startSec ?? audio.startSec;
      } else if (audio.startSec > change.oldStart + toleranceSec) {
        audio.startSec = Number((audio.startSec + change.delta).toFixed(2));
      }
    }
    for (const caption of repaired.captions) {
      if (caption.startSec >= change.oldStart - toleranceSec && caption.endSec <= change.oldEnd + toleranceSec) {
        caption.endSec = Number((caption.endSec + change.delta).toFixed(2));
      } else if (caption.startSec > change.oldStart + toleranceSec) {
        caption.startSec = Number((caption.startSec + change.delta).toFixed(2));
        caption.endSec = Number((caption.endSec + change.delta).toFixed(2));
      }
    }
    for (const chapter of repaired.chapters) {
      if (chapter.startSec > change.oldStart + toleranceSec) chapter.startSec = Number((chapter.startSec + change.delta).toFixed(2));
    }
    repaired.durationSec = Number((repaired.durationSec + change.delta).toFixed(2));
  }
  return syncCollageDurations(repaired);
}
