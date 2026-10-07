import { bestWindow, type ScoredShot } from "./videoWindow.js";

export type LateVideoDecision = "insert" | "offer" | "skip";

/** A late video only joins the exact untouched, unsaved cut it was composed for. */
export function lateVideoDecision(input: {
  status: "playable" | "saved" | "rendering" | "failed" | "composing";
  composedRevision: number;
  currentRevision: number;
  hasShot: boolean;
}): LateVideoDecision {
  if (!input.hasShot) return "skip";
  if (input.status !== "playable") return input.status === "saved" ? "offer" : "skip";
  return input.currentRevision === input.composedRevision ? "insert" : "offer";
}

/** Pick the best legal late-join window using the compose scorer unchanged. */
export function lateVideoWindow(shot: ScoredShot, durationSec: number) {
  const length = Math.min(4, Math.max(2, durationSec));
  return bestWindow(shot, length);
}
