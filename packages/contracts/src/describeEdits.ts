import type { EditOp } from "./edits.js";
import type { Timeline } from "./timeline.js";

/** Plain-language replies for Ask for an edit, built only from the ops that were actually applied. */

const ORDINALS: Record<string, string> = { first: "first", second: "2nd", third: "3rd", fourth: "4th", fifth: "5th", last: "last", final: "last" };
const ordinalLabel = (word: string) => ORDINALS[word.toLowerCase()] ?? word.toLowerCase();

function joinClauses(clauses: string[]): string {
  if (!clauses.length) return "";
  const text = clauses.length === 1 ? clauses[0]! : `${clauses.slice(0, -1).join(", ")} and ${clauses.at(-1)}`;
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}.`;
}

export function describeApplied(text: string, ops: EditOp[], after: Timeline, soundtracks: { id: string; name: string }[] = [], before?: Timeline): string {
  const has = (...names: string[]) => ops.some(op => names.includes(op.op));
  const clauses: string[] = [];
  const timing = has("setPhotoDuration", "setCollageDuration", "trim");
  const targetSeconds = /\b(?:to|at|of)?\s*\d+(?:\.\d+)?\s*(?:seconds?|secs?|s|minutes?|mins?|m)\b/i.test(text);
  const pace = /\b(?:faster|quicker|speed(?:ier)? up)\b/i.test(text) ? "faster" : /\b(?:slower|more slowly|slow down|more relaxed)\b/i.test(text) ? "slower" : null;
  const relative = /\b(first|second|third|fourth|last|final)\b[^,.]*?\b(longer|shorter)\b/i.exec(text);
  if (timing && targetSeconds) clauses.push(`made it ${Math.round(after.durationSec)} seconds`);
  else if (timing && pace) {
    const clock = (sec: number) => `${Math.floor(Math.round(sec) / 60)}:${String(Math.round(sec) % 60).padStart(2, "0")}`;
    const range = before && Math.round(before.durationSec) !== Math.round(after.durationSec) ? `: ${clock(before.durationSec)} → ${clock(after.durationSec)}` : "";
    clauses.push(`made it ${pace}${range}`);
  }
  if (has("setAspect")) clauses.push(`switched to ${after.aspect === "16:9" ? "landscape" : "portrait"}`);
  const music = ops.find(op => op.op === "setSoundtrack");
  if (music?.op === "setSoundtrack") {
    const name = soundtracks.find(track => track.id === music.soundtrackId)?.name;
    clauses.push(name ? `changed the music to ${name}` : "changed the music");
  } else if (has("setMusicVolume")) clauses.push("changed the music volume");
  if (has("move")) {
    const focus = /\b(?:focus|feature|emphasize)\s+(?:on\s+)?(everyone|[^,.;]+?)(?=\s+(?:and|with)\b|[,.;]|$)/i.exec(text)?.[1]?.trim();
    clauses.push(focus ? `brought ${focus.toLowerCase() === "everyone" ? "everyone" : focus} forward` : "reordered the moments");
  }
  if (has("remove")) {
    const word = /\b(?:remove|delete|take out|drop)\s+(?:the\s+)?(\d+(?:st|nd|rd|th)|first|second|third|fourth|fifth|last|final)\b/i.exec(text)?.[1];
    clauses.push(word ? `removed the ${ordinalLabel(word)} moment` : "removed that moment");
  }
  if (timing && !targetSeconds && !pace) {
    if (relative) clauses.push(relative[2]!.toLowerCase() === "longer" ? `showed the ${ordinalLabel(relative[1]!)} one longer` : `made the ${ordinalLabel(relative[1]!)} one shorter`);
    else clauses.push("changed how long moments are shown");
  }
  const merges = ops.filter((op): op is Extract<EditOp, { op: "mergeIntoCollage" }> => op.op === "mergeIntoCollage");
  if (merges.length) {
    const photos = merges.reduce((sum, op) => sum + op.clipIds.length, 0);
    clauses.push(`grouped ${photos} photos into ${merges.length === 1 ? "a collage" : `${merges.length} collages`}`);
  }
  const splits = ops.filter(op => op.op === "splitCollage").length;
  if (splits) {
    const remaining = after.videoClips.filter(clip => "kind" in clip).length;
    clauses.push(remaining === 0 ? (splits === 1 ? "split the collage back into single photos" : "split all collages back into single photos") : `split ${splits === 1 ? "a collage" : `${splits} collages`} back into single photos`);
  }
  if (has("setCollageSpec", "setCollageLayout", "setCollageMotion", "setCollageEffect", "addCollageSlot", "removeCollageSlot")) clauses.push("updated the collage");
  const focusTarget = /\b(?:focus|feature|emphasize)\s+(?:on\s+)?(everyone|[^,.;]+?)(?=\s+(?:and|with)\b|[,.;]|$)/i.exec(text)?.[1]?.trim();
  if (has("setPhotoCrop", "setCollageCrop")) clauses.push("adjusted the framing");
  if (has("swapShot", "replaceCollageSlot")) clauses.push(focusTarget && !has("move") ? `used a moment featuring ${focusTarget}` : "replaced a photo");
  if (has("add")) clauses.push(focusTarget && !has("move") ? `added a photo featuring ${focusTarget}` : "added a moment");
  else if (has("duplicate")) clauses.push("duplicated a moment");
  return joinClauses(clauses) || "Made the change.";
}

