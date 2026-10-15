import type { EditOp, Timeline } from "@mosae/contracts";

const idOf = (clip: Timeline["videoClips"][number]) => "kind" in clip ? clip.clipId : clip.id;
const stable = (value: unknown) => JSON.stringify(value);

/** IDs whose visible timeline clip data differs between two applied states. */
export function changedClipIds(before: Timeline, after: Timeline): string[] {
  const previous = new Map(before.videoClips.map((clip) => [idOf(clip), clip]));
  const next = new Map(after.videoClips.map((clip) => [idOf(clip), clip]));
  return [...new Set([...previous.keys(), ...next.keys()])].filter((id) => stable(previous.get(id)) !== stable(next.get(id)));
}

export function askEditSummary(ops: EditOp[], durationSec?: number, soundtrackName?: string, requestText?: string): string {
  const op = ops[0];
  const focus = requestText?.match(/\bfocus\s+on\s+(everyone|[^.!?]+)|\bchange\s+the\s+focus\s+to\s+(everyone|[^.!?]+)/i);
  const focusName = focus?.[1] ?? focus?.[2];
  const moves = ops.filter((item) => item.op === "move");
  const filmLength = durationSec === undefined ? null : Math.max(0, Math.round(durationSec));
  const filmLengthLabel = filmLength === null ? null : `${Math.floor(filmLength / 60)}:${String(filmLength % 60).padStart(2, "0")}`;
  const changedMoments = new Set(ops.flatMap((item) => "clipId" in item ? [item.clipId] : [])).size;
  if (focusName && moves.length) return `Focused on ${focusName.toLowerCase() === "everyone" ? "everyone" : focusName}: moved ${moves.length} ${moves.length === 1 ? "moment" : "moments"} earlier`;
  if (!op) return filmLengthLabel ? `Film is now ${filmLengthLabel}` : "Updated your film";
  if (focusName) return `Focused on ${focusName.toLowerCase() === "everyone" ? "everyone" : focusName}${changedMoments ? `: updated ${changedMoments} ${changedMoments === 1 ? "moment" : "moments"}` : ""}`;
  if (durationSec !== undefined && ops.every((item) => item.op === "setPhotoDuration" || item.op === "setCollageDuration")) return `Film is now ${filmLengthLabel}`;
  if (moves.length) return `Moved ${moves.length} ${moves.length === 1 ? "moment" : "moments"} earlier`;
  const removals = ops.filter((item) => item.op === "remove");
  if (removals.length) return `Removed ${removals.length} ${removals.length === 1 ? "moment" : "moments"}`;
  const soundtrack = ops.find((item) => item.op === "setSoundtrack");
  if (soundtrack?.op === "setSoundtrack") return `Switched music to ${soundtrackName || soundtrack.soundtrackId}`;
  const aspect = ops.find((item) => item.op === "setAspect");
  if (aspect?.op === "setAspect") return `Changed to ${aspect.aspect === "16:9" ? "landscape" : "portrait"}`;
  const merges = ops.filter((item) => item.op === "mergeIntoCollage").length;
  if (merges) return `Combined photos into ${merges === 1 ? "a collage" : `${merges} collages`}${filmLengthLabel && durationSec !== undefined ? `; film is now ${filmLengthLabel}` : ""}`;
  if (ops.some((item) => ["setPhotoDuration", "setCollageDuration"].includes(item.op))) return `Showed a moment longer`;
  if (ops.some((item) => item.op === "swapShot" || item.op === "replaceCollageSlot")) return "Replaced a moment";
  if (ops.some((item) => item.op === "duplicate" || item.op === "add")) return "Added a moment";
  if (ops.some((item) => item.op.startsWith("setCollage") || item.op === "addCollageSlot" || item.op === "removeCollageSlot" || item.op === "splitCollage")) return "Updated a collage";
  if (ops.some((item) => item.op === "trim")) return `Trimmed a moment`;
  if (ops.some((item) => item.op === "setMusicVolume")) return "Changed music volume";
  if (filmLengthLabel) return `Film is now ${filmLengthLabel}`;
  return "Updated your film";
}

export function suggestedAskRequests(scope: "film" | "clip" | "slot", people: string[] = [], aspect: "9:16" | "16:9" = "9:16"): string[] {
  if (scope === "film") return ["Focus on everyone", ...people.slice(0, 3).map((name) => `Focus on ${name}`), "Make it faster", "Make it slower", "Change the music", "Make it 30 seconds", aspect === "9:16" ? "Make it landscape" : "Make it portrait"];
  return ["Remove this moment", "Show it longer", "Replace this photo", "Move it earlier"];
}
