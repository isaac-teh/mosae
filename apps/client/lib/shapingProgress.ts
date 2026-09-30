export type ShapingStatus = "queued" | "composing" | "playable" | "rendering" | "saved" | "failed";

export type ShapingProgress = { progress: number; stepsDone: number };

const clamp = (value: number) => Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));

/** A film is ready when composition is published; rendering belongs to Save. */
export function mapShapingProgress(status: ShapingStatus, renderProgress = 0, compositionProgress = 0): ShapingProgress {
  if (status === "queued" || status === "composing") {
    return { progress: clamp(compositionProgress) / 3, stepsDone: 0 };
  }
  if (status === "playable") return { progress: 1, stepsDone: 3 };
  if (status === "saved") return { progress: 1, stepsDone: 3 };
  if (status === "failed") return { progress: 0, stepsDone: 0 };

  const render = clamp(renderProgress);
  return { progress: 1 / 3 + render * (2 / 3), stepsDone: render >= 0.5 ? 2 : 1 };
}
