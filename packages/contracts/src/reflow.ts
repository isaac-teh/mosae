import type { z } from "zod";
import type { TransitionSchema } from "./timeline.js";

type TransitionType = z.infer<typeof TransitionSchema>;

/**
 * An ordered clip before geometry exists: it has a duration and transition,
 * but no startSec — that is what reflow computes.
 */
export interface ClipPlan {
  id: string;
  source: unknown; // shotId + range info (video) or just shotId (photo)
  durationSec: number;
  transitionIn: TransitionType;
  strength: number;
  minHoldSec: number;
  maxHoldSec: number;
  crop?: { x: number; y: number; w: number; h: number };
  motion?: { kind: "slow-zoom"; from: number; to: number };
}

/**
 * Round a time value to the nearest frame boundary at the given fps.
 */
export function quantize(sec: number, fps: number): number {
  const frameTime = 1 / fps;
  return Math.round(sec / frameTime) * frameTime;
}

/**
 * Reflow an ordered list of clip plans into a final geometry with absolute
 * startSec values, chapter starts recomputed from the first clip in each
 * chapter, and all times quantized to frame boundaries.
 *
 * Pure function: same input → same output, no clock, no randomness, no I/O.
 */
export interface ReflowOptions {
  fps: number;
  /** Ordered clips with durations but no startSec. */
  plans: ClipPlan[];
  /** Chapter boundaries — each chapter maps to a range of clip indices. */
  chapters: { id: string; title: string; summary: string; momentIds: string[] }[];
  /** Target duration in seconds (used for validation, not enforced by reflow itself). */
  targetSec?: number;
}

export interface ReflowResult {
  /** Clips with computed startSec values. */
  clips: Array<ClipPlan & { startSec: number }>;
  /** Total film duration after overlap resolution. */
  durationSec: number;
  /** Chapter starts recomputed from the first clip in each chapter. */
  chapters: Array<{ id: string; title: string; summary: string; momentIds: string[]; startSec: number }>;
}

export function reflow(options: ReflowOptions): ReflowResult {
  const { plans, fps, chapters } = options;
  const frameTime = 1 / fps;

  if (plans.length === 0) {
    return { clips: [], durationSec: 0, chapters: [] };
  }

  // Step 1: Compute startSec for each clip by walking with a cursor.
  // `transitionIn` is the transition INTO a clip, so the boundary between clips
  // N-1 and N is governed by clip N — never by its predecessor. A crossfade on
  // clip N means clip N starts at `cursor - N.transitionIn.durationSec`,
  // clamped at 0. A cut and a dip start exactly at the cursor.
  const clips: Array<ClipPlan & { startSec: number }> = [];

  for (let index = 0; index < plans.length; index++) {
    // Both ends of a clip land on a frame. Quantizing only the starts lets the
    // Player and the renderer round a duration differently, which is exactly
    // the drift one shared composition exists to make impossible.
    const plan = { ...plans[index], durationSec: quantize(plans[index].durationSec, fps) };

    if (index === 0) {
      // First clip always starts at 0
      clips.push({ ...plan, startSec: quantize(0, fps) });
      continue;
    }

    const prevClip = clips[index - 1];
    const cursor = prevClip.startSec + prevClip.durationSec;

    if (plan.transitionIn.kind === "crossfade") {
      // Crossfade: this clip starts before the previous one ends
      const overlap = quantize(plan.transitionIn.durationSec, fps);
      let startSec = cursor - overlap;
      // Clamp at 0 — an overlap longer than everything before it should not go negative
      startSec = Math.max(0, startSec);
      clips.push({ ...plan, startSec: quantize(startSec, fps) });
    } else {
      // Cut or dip: clip starts exactly where the previous one ends
      clips.push({ ...plan, startSec: quantize(cursor, fps) });
    }
  }

  // Step 2: Compute total duration — where the cursor lands after the last clip.
  const lastClip = clips[clips.length - 1];
  const durationSec = quantize(lastClip.startSec + lastClip.durationSec, fps);

  // Step 3: Recompute chapter starts from the first clip belonging to each chapter.
  // Each chapter's momentIds map to specific clips (by index or by source).
  // For now, we assign chapters sequentially: chapter i covers clips that belong
  // to its moments. We need a mapping from momentId to clip index.
  const chapterStarts = computeChapterStarts(chapters, plans, clips);

  return {
    clips,
    durationSec,
    chapters: chapters.map((ch, i) => ({
      ...ch,
      startSec: chapterStarts[i] ?? quantize(0, fps),
    })),
  };
}

/**
 * Map each chapter to the index of its first clip.
 * Chapters are assigned sequentially based on momentIds in the proposal.
 */
function computeChapterStarts(
  chapters: { id: string; title: string; summary: string; momentIds: string[] }[],
  plans: ClipPlan[],
  clips: Array<ClipPlan & { startSec: number }>,
): number[] {
  // Build a map from momentId to clip index.
  // In practice, each clip plan corresponds to one moment in the proposal.
  // The order of plans matches the chapter structure from buildCandidates.
  const momentToClipIndex = new Map<string, number>();

  // We need to know which moment each clip belongs to.
  // For now, assume clips are ordered by chapter and within-chapter by moment order.
  let currentMomentIndex = 0;
  for (let chIdx = 0; chIdx < chapters.length; chIdx++) {
    const chapter = chapters[chIdx];
    for (const momentId of chapter.momentIds) {
      // Find the clip that corresponds to this moment.
      // In a real implementation, each ClipPlan would have a momentId field.
      // For now, we use sequential assignment based on plan order.
      if (currentMomentIndex < clips.length) {
        momentToClipIndex.set(momentId, currentMomentIndex);
        currentMomentIndex++;
      }
    }
  }

  // Compute chapter starts: the startSec of the first clip for each chapter's moments.
  const starts: number[] = [];
  for (const chapter of chapters) {
    let minStartSec = Infinity;
    for (const momentId of chapter.momentIds) {
      const clipIdx = momentToClipIndex.get(momentId);
      if (clipIdx !== undefined && clips[clipIdx]) {
        minStartSec = Math.min(minStartSec, clips[clipIdx].startSec);
      }
    }
    starts.push(minStartSec === Infinity ? quantize(0, 30) : minStartSec);
  }

  return starts;
}
