export type TimelineTrimEdge = "start" | "end";

export type TrimRangeInput = {
  startSec: number;
  endSec: number;
  edge: TimelineTrimEdge;
  requestedSec: number;
  minSec: number;
  maxSec: number;
  minimumLengthSec?: number;
};

/** Clamp one edge of a source or timeline range while preserving its minimum length. */
export function trimRange({ startSec, endSec, edge, requestedSec, minSec, maxSec, minimumLengthSec = 0.5 }: TrimRangeInput): { startSec: number; endSec: number } {
  const availableLength = Math.max(0, maxSec - minSec);
  const minimumLength = Math.min(Math.max(0, minimumLengthSec), availableLength);
  if (edge === "start") {
    const latestStart = Math.min(endSec - minimumLength, maxSec - minimumLength);
    return { startSec: Math.max(minSec, Math.min(latestStart, requestedSec)), endSec };
  }
  const earliestEnd = Math.max(startSec + minimumLength, minSec + minimumLength);
  return { startSec, endSec: Math.min(maxSec, Math.max(earliestEnd, requestedSec)) };
}
