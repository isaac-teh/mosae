import type { EditOp, Timeline } from "@mosae/contracts";

function clipId(clip: Timeline["videoClips"][number]) {
  return "kind" in clip ? clip.clipId : clip.id;
}

export function aiEditPlaybackStart(ops: EditOp[], current: Timeline, original: Timeline): number {
  const target = ops.find((op) => "clipId" in op || op.op === "add" || op.op === "mergeIntoCollage");
  if (!target) return 0;
  if (target.op === "mergeIntoCollage") {
    const merged = current.videoClips.find((item) => clipId(item) === `merge:${target.clipIds[0]}`);
    return merged?.startSec ?? 0;
  }
  if (target.op === "add") {
    if (!target.afterClipId) return 0;
    const anchor = current.videoClips.find((clip) => clipId(clip) === target.afterClipId);
    return anchor ? anchor.startSec + anchor.durationSec : 0;
  }
  if (!("clipId" in target)) return 0;
  const clip = current.videoClips.find((item) => clipId(item) === target.clipId)
    ?? original.videoClips.find((item) => clipId(item) === target.clipId);
  return clip?.startSec ?? 0;
}
