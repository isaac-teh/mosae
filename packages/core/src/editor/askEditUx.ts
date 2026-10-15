import type { EditOp, Timeline } from "@mosae/contracts";

const idOf = (clip: Timeline["videoClips"][number]) => "kind" in clip ? clip.clipId : clip.id;
const stable = (value: unknown) => JSON.stringify(value);

/** IDs whose visible timeline clip data differs between two applied states. */
export function changedClipIds(before: Timeline, after: Timeline): string[] {
  const previous = new Map(before.videoClips.map((clip) => [idOf(clip), clip]));
  const next = new Map(after.videoClips.map((clip) => [idOf(clip), clip]));
  return [...new Set([...previous.keys(), ...next.keys()])].filter((id) => stable(previous.get(id)) !== stable(next.get(id)));
}

export function askEditSummary(ops: EditOp[], durationSec?: number, soundtrackName?: string): string {
  const op = ops[0];
  if (!op) return durationSec !== undefined ? `Film is now ${Math.floor(durationSec / 60)}:${String(Math.floor(durationSec % 60)).padStart(2, "0")}` : "Updated your film";
  if (durationSec !== undefined && ops.every((item) => item.op === "setPhotoDuration" || item.op === "setCollageDuration")) return `Film is now ${Math.floor(durationSec / 60)}:${String(Math.floor(durationSec % 60)).padStart(2, "0")}`;
  if (ops.every((item) => item.op === "move")) return `Moved ${ops.length} ${ops.length === 1 ? "moment" : "moments"} earlier`;
  if (ops.every((item) => item.op === "remove")) return `Removed ${ops.length} ${ops.length === 1 ? "moment" : "moments"}`;
  if (op.op === "setSoundtrack") return `Switched music to ${soundtrackName || op.soundtrackId}`;
  if (op.op === "setAspect") return `Changed to ${op.aspect === "16:9" ? "landscape" : "portrait"}`;
  if (["setPhotoDuration", "setCollageDuration"].includes(op.op)) return `Showed a moment longer`;
  if (op.op === "swapShot") return "Replaced a moment";
  if (op.op === "duplicate" || op.op === "add") return "Added a moment";
  if (op.op.startsWith("setCollage") || op.op === "replaceCollageSlot" || op.op === "addCollageSlot" || op.op === "removeCollageSlot" || op.op === "splitCollage") return "Updated a collage";
  if (op.op === "trim") return `Trimmed a moment`;
  if (op.op === "setMusicVolume") return "Changed music volume";
  if (durationSec !== undefined) return `Film is now ${Math.floor(durationSec / 60)}:${String(Math.floor(durationSec % 60)).padStart(2, "0")}`;
  return "Updated your film";
}

export function suggestedAskRequests(scope: "film" | "clip" | "slot", people: string[] = [], aspect: "9:16" | "16:9" = "9:16"): string[] {
  if (scope === "film") return ["Focus on everyone", ...people.slice(0, 3).map((name) => `Focus on ${name}`), "Make it faster", "Make it slower", "Change the music", "Make it 30 seconds", aspect === "9:16" ? "Make it landscape" : "Make it portrait"];
  return ["Remove this moment", "Show it longer", "Replace this photo", "Move it earlier"];
}
