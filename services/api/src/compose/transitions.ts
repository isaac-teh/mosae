/**
 * How long each transition lasts. One table, because three places need to agree
 * about it: `fitDuration` subtracts crossfade overlaps when it measures the
 * film, `runCompose` writes them onto the clips, and `reflow` resolves them into
 * geometry. A second copy of 0.5 anywhere is a film that is not the length it
 * was fitted to.
 */
export const TRANSITION_SECONDS: Record<"cut" | "crossfade" | "dip", number> = {
  cut: 0,
  crossfade: 0.5,
  dip: 0.3,
};

/** How much a transition pulls its clip back over its predecessor. Only a crossfade overlaps. */
export function overlapSec(kind: "cut" | "crossfade" | "dip"): number {
  return kind === "crossfade" ? TRANSITION_SECONDS.crossfade : 0;
}
