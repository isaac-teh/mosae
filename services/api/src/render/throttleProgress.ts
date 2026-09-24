/**
 * Throttle render progress on its way to Firestore.
 *
 * A five-minute film is 9,000 frames, and Remotion reports progress on every
 * one. Writing each of them is 9,000 document writes for one render, and the
 * Review screen cannot read them faster than it repaints anyway.
 *
 * The rule from the plan: at most one write per second, or per 5% moved —
 * *whichever is rarer*, so both conditions must be met. The final 1.0 always
 * gets through, because that is the value the screen waits for.
 */
export interface ProgressThrottle {
  /** Offer a progress value. Resolves once the write it triggered (if any) is done. */
  report(progress: number): Promise<void>;
  /** How many writes have actually been made. */
  readonly writes: number;
}

export function throttleProgress(
  write: (progress: number) => Promise<unknown>,
  options: { now?: () => number; minIntervalMs?: number; minDelta?: number } = {},
): ProgressThrottle {
  const now = options.now ?? Date.now;
  const minIntervalMs = options.minIntervalMs ?? 1_000;
  const minDelta = options.minDelta ?? 0.05;

  let lastAt = now();
  let lastValue = 0;
  let writes = 0;

  return {
    get writes() {
      return writes;
    },
    async report(progress) {
      const clamped = Math.max(0, Math.min(1, progress));
      const at = now();
      const due = clamped >= 1 || (at - lastAt >= minIntervalMs && clamped - lastValue >= minDelta);
      if (!due) return;
      lastAt = at;
      lastValue = clamped;
      writes += 1;
      await write(clamped);
    },
  };
}
