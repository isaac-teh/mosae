import type { AssembledClip } from "./assemble.js";
import type { Holds } from "./brief.js";

/**
 * Fit assembled clips to target duration by adjusting photo holds and trimming silent video.
 * Lands within 10% of target. Shortens ordinary clips toward minHoldSec first, strongest last.
 * If target is unreachable, shortens the target rather than padding. Never pads or repeats clips.
 */

export interface FitResult {
  /** Clips with adjusted durations. */
  clips: AssembledClip[];
  /** Notes about what was done to fit duration. */
  notes: string[];
}

/** Duration of a single clip (photo holdSec or video sourceOutSec - sourceInSec). */
function clipLength(clip: AssembledClip): number {
  if (clip.holdSec != null) return clip.holdSec;
  if (clip.sourceInSec != null && clip.sourceOutSec != null) {
    return clip.sourceOutSec - clip.sourceInSec;
  }
  return 0;
}

/**
 * Fit clips to target duration.
 * @param clips - Assembled clips (mutated in place).
 * @param targetSec - Target film duration in seconds.
 * @param holds - Hold range from cadence.
 * @param mustIncludeMomentIds - Moment IDs that should keep their full hold.
 */
export function fitDuration(
  clips: AssembledClip[],
  targetSec: number,
  holds: Holds,
  mustIncludeMomentIds: string[] = [],
): FitResult {
  const notes: string[] = [];

  if (!clips.length) return { clips: [], notes };

  // Deep clone to avoid mutating input unexpectedly
  const workingClips = JSON.parse(JSON.stringify(clips)) as AssembledClip[];

  for (let pass = 0; pass < 20; pass++) {
    const total = workingClips.reduce((sum, c) => sum + clipLength(c), 0);
    const drift = total - targetSec;

    // Within tolerance? Done.
    if (Math.abs(drift) <= targetSec * 0.05) break;

    // Find photo clips that can still be adjusted
    const photos = workingClips.filter(
      c =>
        c.holdSec != null &&
        ((drift > 0 && c.holdSec > holds.min) || (drift < 0 && c.holdSec < holds.max)),
    );

    if (!photos.length) {
      // Out of photo slack
      if (drift > 0) {
        // Too long: trim silent video clips from their tail
        let excess = drift;
        for (const clip of [...workingClips].reverse()) {
          if (excess <= 0.01 || clip.sourceOutSec == null || clip.hasSpeech) continue;
          const spare = (clip.sourceOutSec - (clip.sourceInSec ?? 0)) - 1.5;
          const cut = Math.min(spare, excess);
          if (cut <= 0) continue;
          clip.sourceOutSec = Number((clip.sourceOutSec! - cut).toFixed(2));
          excess -= cut;
        }
        notes.push(`trimmed silent video by ${(drift - excess).toFixed(1)}s`);
      } else {
        // Too short: photo holds exhausted at min, can't pad
        const currentTotal = workingClips.reduce((sum, c) => sum + clipLength(c), 0);
        notes.push(`photo holds exhausted at ${currentTotal.toFixed(1)}s (target was ${targetSec}s)`);
      }
      break;
    }

    // Adjust photo holds: step per clip to reduce drift
    const step = drift / photos.length;
    for (const photo of photos) {
      if (mustIncludeMomentIds.includes(photo.itemId)) continue; // Protect must-include clips
      photo.holdSec = Number(Math.min(holds.max, Math.max(holds.min, photo.holdSec! - step)).toFixed(2));
    }
  }

  const finalTotal = workingClips.reduce((sum, c) => sum + clipLength(c), 0);
  if (Math.abs(finalTotal - targetSec) > targetSec * 0.1) {
    notes.push(`final duration ${finalTotal.toFixed(1)}s not within 10% of ${targetSec}s`);
  }

  return { clips: workingClips, notes };
}
