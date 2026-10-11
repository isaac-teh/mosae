import { z } from "zod";
import type { Candidate } from "./buildCandidates.js";
import type { Holds } from "./brief.js";

/**
 * The structured output schema for the composition model.
 * Per clip: candidateId, optional holdSec, transition, optional textOverlay, audio role.
 * Plus music cues. One call through generateStructured; no tool loop, no agent.
 */

export const ComposeClipSchema = z.object({
  candidateId: z.string(),
  holdSec: z.number().optional(),
  transition: z.enum(["cut", "crossfade", "dip"]),
  textOverlay: z.string().optional(),
  audio: z.enum(["keep", "duck", "mute"]),
});

export const MusicCueSchema = z.object({
  atSec: z.number(),
  cue: z.string(),
});
export const StoryChoiceSchema = z.object({ candidateId: z.string(), reason: z.string().min(1) });

export const ComposeResponseSchema = z.object({
  clips: z.array(ComposeClipSchema),
  musicCues: z.array(MusicCueSchema),
  openerId: StoryChoiceSchema.optional(),
  peakId: StoryChoiceSchema.optional(),
  closerId: StoryChoiceSchema.optional(),
});

export type ComposePicks = z.infer<typeof ComposeResponseSchema>;
export type ComposeClipPick = z.infer<typeof ComposeClipSchema>;

/** Drop reason recorded when a pick is rejected. */
export interface DropReason {
  candidateId: string;
  reason: string;
}

/** An assembled clip plan ready for reflow — carries the original Candidate fields plus model decisions. */
export interface AssembledClip extends Candidate {
  order: number;
  transition: "cut" | "crossfade" | "dip";
  audio: "keep" | "duck" | "mute";
  textOverlay?: string;
  holdSec?: number; // for photos only
  sourceInSec?: number; // for videos only
  sourceOutSec?: number; // for videos only
  hasSpeech?: boolean; // for videos only
}

const MAX_PER_ITEM = 3;

/**
 * Assemble model picks into ClipPlan[] with drop tracking.
 * Drops are not failures — they are expected rejections of invalid picks.
 * If every pick is dropped, the result signals failure (no film possible).
 */
export function assemble(
  picks: ComposePicks,
  candidates: Map<string, Candidate>,
  holds: Holds,
): { clips: AssembledClip[]; dropped: DropReason[] } {
  const usedCandidates = new Set<string>();
  const perItem = new Map<string, number>();
  const clips: AssembledClip[] = [];
  const dropped: DropReason[] = [];

  for (const pick of picks.clips) {
    const candidate = candidates.get(pick.candidateId);

    // Rule 1: Unknown candidateId
    if (!candidate) {
      dropped.push({ candidateId: pick.candidateId, reason: `unknown candidate ${pick.candidateId}` });
      continue;
    }

    // Rule 2: Same candidate twice
    if (usedCandidates.has(candidate.candidateId)) {
      dropped.push({ candidateId: pick.candidateId, reason: `repeat of clip ${candidate.candidateId}` });
      continue;
    }

    // Rule 3: More than MAX_PER_ITEM clips from one asset
    const used = perItem.get(candidate.itemId) || 0;
    if (used >= MAX_PER_ITEM) {
      dropped.push({ candidateId: pick.candidateId, reason: `${candidate.itemId}: more than ${MAX_PER_ITEM} clips` });
      continue;
    }

    // Rule 4: Same still twice in a row
    const lastClip = clips.at(-1);
    if (lastClip?.itemId === candidate.itemId && candidate.kind === "photo") {
      dropped.push({ candidateId: pick.candidateId, reason: `${candidate.itemId}: same still twice in a row` });
      continue;
    }

    // Accept the pick
    usedCandidates.add(candidate.candidateId);
    perItem.set(candidate.itemId, used + 1);

    const clip: AssembledClip = {
      ...candidate,
      order: clips.length + 1,
      transition: pick.transition,
      audio: pick.audio,
      ...(pick.textOverlay ? { textOverlay: pick.textOverlay } : {}),
    };

    if (candidate.kind === "photo") {
      // Clamp holdSec to holds range; use base if not provided
      clip.holdSec = Math.min(holds.max, Math.max(holds.min, pick.holdSec ?? holds.base));
    } else {
      // Video clip carries source range from candidate
      clip.sourceInSec = candidate.inSec;
      clip.sourceOutSec = candidate.outSec;
      clip.hasSpeech = candidate.hasSpeech;
    }

    clips.push(clip);
  }

  return { clips, dropped };
}

/**
 * Check if the result is a failure (every pick was dropped).
 */
export function isEmptyResult(dropped: DropReason[], totalPicks: number): boolean {
  return dropped.length === totalPicks && totalPicks > 0;
}
