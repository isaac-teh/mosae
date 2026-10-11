import type { AssembledClip } from "./assemble.js";
import type { Holds } from "./brief.js";
import { overlapSec } from "./transitions.js";
import { DIRECTING_RULES } from "./directingRules.js";

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
  /**
   * The length the film is now committed to: the requested target, or the
   * total actually reachable when the proposal had too little media for it.
   * The spec shortens the target rather than padding the film, so this is the
   * number validation must measure the film against — the requested one would
   * condemn a film that is as long as its media allows.
   */
  targetSec: number;
}

/**
 * How long the film actually runs: the clips' own lengths, less the overlap each
 * crossfade takes back off its predecessor. Fitting the raw sum instead leaves a
 * film with seven crossfades three and a half seconds shorter than it was fitted
 * to, which is a real miss of the target and not a rounding difference.
 */
function filmLength(clips: AssembledClip[]): number {
  let total = 0;
  clips.forEach((clip, index) => {
    total += clipLength(clip);
    if (index > 0) total -= overlapSec(clip.transition);
  });
  return Math.max(0, total);
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
  options: { minimumFilmSec?: number; maximumStretchedPhotoSec?: number; maximumStretchedPhotoMultiplier?: number; lockedMomentIds?: string[] } = {},
): FitResult {
  const notes: string[] = [];
  let effectiveTargetSec = targetSec;

  if (!clips.length) return { clips: [], notes, targetSec: effectiveTargetSec };

  // Deep clone to avoid mutating input unexpectedly
  const workingClips = JSON.parse(JSON.stringify(clips)) as AssembledClip[];

  for (let pass = 0; pass < 20; pass++) {
    const total = filmLength(workingClips);
    const drift = total - targetSec;

    // Within tolerance? Done.
    if (Math.abs(drift) <= targetSec * 0.05) break;

    // Find photo clips that can still be adjusted
    const photos = workingClips.filter(
      c =>
        c.holdSec != null &&
        !mustIncludeMomentIds.includes(c.itemId) &&
        ((drift > 0 && c.holdSec > holds.min) || (drift < 0 && c.holdSec < holds.max)),
    );

    if (!photos.length) {
      // Out of photo slack
      if (drift > 0) {
        // Too long: trim silent video clips from their tail
        let excess = drift;
        for (const clip of [...workingClips].reverse()) {
          if (excess <= 0.01 || clip.sourceOutSec == null || clip.hasSpeech || mustIncludeMomentIds.includes(clip.itemId) || options.lockedMomentIds?.includes(clip.itemId)) continue;
          const spare = (clip.sourceOutSec - (clip.sourceInSec ?? 0)) - DIRECTING_RULES.videoMinClipSec;
          const cut = Math.min(spare, excess);
          if (cut <= 0) continue;
          clip.sourceOutSec = Number((clip.sourceOutSec! - cut).toFixed(2));
          excess -= cut;
        }
        notes.push(`trimmed silent video by ${(drift - excess).toFixed(1)}s`);
        if (excess > 0.01) {
          effectiveTargetSec = filmLength(workingClips);
          notes.push(`photo holds exhausted at ${effectiveTargetSec.toFixed(1)}s (target was ${targetSec}s)`);
        }
      } else {
        // Too short: photo holds exhausted at min, can't pad
        const currentTotal = filmLength(workingClips);
        notes.push(`photo holds exhausted at ${currentTotal.toFixed(1)}s (target was ${targetSec}s)`);
        // Never pad. The target is what the media can reach.
        effectiveTargetSec = currentTotal;
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

  // With no duration tier selected, a very short composition gets one
  // deliberate stretch pass toward 20 seconds. The cadence bounds still
  // govern normal fitting; this pass can extend stills to four seconds each.
  if (options.minimumFilmSec !== undefined && (options.maximumStretchedPhotoSec !== undefined || options.maximumStretchedPhotoMultiplier !== undefined)) {
    // Before collage placement each fitted photo is a one-photo clip, so its
    // own cadence base is `holds.base`; collage placement applies the same
    // multiplier to the collage's N-photo base duration.
    const stretchLimit = options.maximumStretchedPhotoMultiplier !== undefined
      ? holds.base * options.maximumStretchedPhotoMultiplier
      : options.maximumStretchedPhotoSec!;
    for (let pass = 0; pass < 20; pass++) {
      const drift = options.minimumFilmSec - filmLength(workingClips);
      if (drift <= 0.01) break;
      const photos = workingClips.filter((clip) => clip.holdSec != null && clip.holdSec < stretchLimit);
      if (!photos.length) break;
      const step = drift / photos.length;
      for (const photo of photos) {
        photo.holdSec = Number(Math.min(stretchLimit, photo.holdSec! + step).toFixed(2));
      }
    }
    const residual = options.minimumFilmSec - filmLength(workingClips);
    if (residual > 0.01) {
      const lastStretchable = [...workingClips].reverse().find((clip) => clip.holdSec != null && clip.holdSec < stretchLimit);
      if (lastStretchable) {
        lastStretchable.holdSec = Number(Math.min(stretchLimit, lastStretchable.holdSec! + residual).toFixed(2));
      }
    }
    const stretchedLength = filmLength(workingClips);
    if (stretchedLength < options.minimumFilmSec - 0.01) {
      effectiveTargetSec = stretchedLength;
      notes.push(`maximum-stretched film is ${stretchedLength.toFixed(1)}s; Short tier applies`);
    } else {
      effectiveTargetSec = stretchedLength;
      notes.push(`tierless film reaches ${stretchedLength.toFixed(1)}s (20s minimum)`);
    }
  }

  const finalTotal = filmLength(workingClips);
  if (Math.abs(finalTotal - effectiveTargetSec) > effectiveTargetSec * 0.1) {
    notes.push(`final duration ${finalTotal.toFixed(1)}s not within 10% of ${effectiveTargetSec}s`);
  }

  return { clips: workingClips, notes, targetSec: effectiveTargetSec };
}
