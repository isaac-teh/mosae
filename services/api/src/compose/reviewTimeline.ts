import type { Timeline } from "@mosae/contracts";
import type { Candidate, Asset, TranscriptSegment } from "./buildCandidates.js";
import type { StyleRecipe } from "./styleRecipe.js";
import type { CutMusic } from "./musicCuts.js";
import { findSpeechBoundaryViolations, repairSpeechBoundaries } from "./speechBoundaries.js";
import { snapPhotoBoundaries } from "./musicCuts.js";
import { momentScore } from "./directingRules.js";

export interface ReviewTimelineOptions {
  candidates: ReadonlyMap<string, Candidate>;
  assets: ReadonlyMap<string, Asset>;
  shotIdByMoment: ReadonlyMap<string, string>;
  targetSec: number;
  recipe: StyleRecipe;
  transcriptByShot?: ReadonlyMap<string, readonly TranscriptSegment[]>;
  lockedMoments?: readonly { clipId: string; startSec: number; durationSec: number }[];
  music?: CutMusic;
}

export interface ReviewTimelineResult {
  timeline: Timeline;
  reviewNotes: string[];
  leftOut: { shotId: string; reason: string }[];
}

const idOf = (clip: Timeline["videoClips"][number]) => "kind" in clip ? clip.clipId : clip.id;
type PhotoClip = Exclude<Timeline["videoClips"][number], { kind: "collage" }> & { source: { kind: "photo" } };
const isPhoto = (clip: Timeline["videoClips"][number]): clip is PhotoClip => !("kind" in clip) && clip.source.kind === "photo";
const chapterFor = (timeline: Timeline, startSec: number) => timeline.chapters.reduce((idx, chapter, i) => chapter.startSec <= startSec ? i : idx, 0);
const round = (value: number) => Number(value.toFixed(3));

function descriptionSimilarity(a: string, b: string): number {
  const words = (text: string) => new Set(text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []);
  const left = words(a); const right = words(b);
  if (!left.size || !right.size) return falseSimilarity(a, b);
  const intersection = [...left].filter(word => right.has(word)).length;
  return intersection / (left.size + right.size - intersection);
}
function falseSimilarity(a: string, b: string): number { return a.toLowerCase().trim() === b.toLowerCase().trim() ? 1 : 0; }

function reflow(timeline: Timeline): void {
  const captionOwners = timeline.captions.map(caption => {
    const owner = timeline.videoClips
      .map(clip => ({ clip, overlap: Math.max(0, Math.min(caption.endSec, clip.startSec + clip.durationSec) - Math.max(caption.startSec, clip.startSec)) }))
      .sort((a, b) => b.overlap - a.overlap)[0]?.clip;
    return { caption, clipId: owner ? idOf(owner) : undefined, offsetStart: owner ? caption.startSec - owner.startSec : 0, offsetEnd: owner ? caption.endSec - owner.startSec : 0 };
  });
  let cursor = 0;
  timeline.videoClips.forEach((clip, index) => {
    if (index > 0) {
      const transition = "kind" in clip ? clip.transitionIn : clip.transitionIn;
      const overlap = transition?.kind === "crossfade" ? transition.durationSec : 0;
      clip.startSec = round(Math.max(0, cursor - overlap));
    } else clip.startSec = 0;
    cursor = clip.startSec + clip.durationSec;
  });
  timeline.durationSec = round(cursor);
  for (const { caption, clipId, offsetStart, offsetEnd } of captionOwners) {
    const clip = timeline.videoClips.find(item => idOf(item) === clipId);
    if (!clip) continue;
    caption.startSec = round(Math.max(0, clip.startSec + offsetStart));
    caption.endSec = round(Math.min(timeline.durationSec, Math.max(caption.startSec + 0.01, clip.startSec + offsetEnd)));
  }
  for (const audio of timeline.audioClips) {
    if (audio.source.kind !== "asset") continue;
    const assetId = audio.source.assetId;
    const clip = timeline.videoClips.find(item => !("kind" in item) && item.source.shotId === assetId);
    if (clip) {
      audio.startSec = clip.startSec;
      audio.source.sourceOutSec = round(Math.min(audio.source.sourceOutSec, audio.source.sourceInSec + clip.durationSec));
    }
  }
  for (const chapter of timeline.chapters) {
    const found = timeline.videoClips.find(clip => chapterFor(timeline, clip.startSec) === timeline.chapters.indexOf(chapter));
    if (found) chapter.startSec = found.startSec;
  }
  timeline.audioClips = timeline.audioClips.filter(clip =>
    clip.startSec < timeline.durationSec - 0.001
    && clip.source.sourceOutSec - clip.source.sourceInSec >= 1 / 30,
  );
  for (const clip of timeline.audioClips) {
    if (clip.role === "music") {
      const maxSourceOut = clip.source.sourceInSec + timeline.durationSec - clip.startSec;
      clip.source.sourceOutSec = round(Math.min(clip.source.sourceOutSec, maxSourceOut - 0.02));
    }
  }
  timeline.captions = timeline.captions.filter(caption => caption.startSec < timeline.durationSec).map(caption => ({ ...caption, endSec: round(Math.min(caption.endSec, timeline.durationSec)) }));
}

/** Deterministic final polish pass. It owns only the explicitly listed repairs. */
export function reviewTimeline(timeline: Timeline, options: ReviewTimelineOptions): ReviewTimelineResult {
  const repaired = structuredClone(timeline);
  const reviewNotes: string[] = [];
  const leftOut: ReviewTimelineResult["leftOut"] = [];
  const chapterByClip = new Map(repaired.videoClips.map(clip => [idOf(clip), chapterFor(repaired, clip.startSec)]));

  if (options.transcriptByShot) {
    const violations = findSpeechBoundaryViolations(repaired, options.transcriptByShot);
    if (violations.length) {
      const next = repairSpeechBoundaries(repaired, options.transcriptByShot);
      repaired.videoClips = next.videoClips;
      repaired.audioClips = next.audioClips;
      repaired.captions = next.captions;
      repaired.chapters = next.chapters;
      repaired.durationSec = next.durationSec;
      reviewNotes.push(`sentence cut repaired: ${violations.map(v => `${v.clipId}.${v.edge}`).join(", ")}`);
    }
  }

  // Swap an adjacent duplicate or adjacent excerpt from one source with the next distinct clip in its chapter.
  for (let i = 0; i < repaired.videoClips.length - 1; i++) {
    const current = repaired.videoClips[i]!;
    const next = repaired.videoClips[i + 1]!;
    const currentId = idOf(current); const nextId = idOf(next);
    const a = options.candidates.get(currentId); const b = options.candidates.get(nextId);
    const aAsset = a && options.assets.get(a.itemId); const bAsset = b && options.assets.get(b.itemId);
    const sameSource = !("kind" in current) && !("kind" in next) && current.source.kind === "video" && next.source.kind === "video" && current.source.shotId === next.source.shotId;
    const dup = !!(aAsset?.dupOf && (aAsset.dupOf === b?.itemId || bAsset?.dupOf === a?.itemId));
    const similar = !!(a && b && a.chapterIndex === b.chapterIndex && (dup || descriptionSimilarity(a.description, b.description) >= 0.8));
    if (!sameSource && !similar) continue;
    const chapter = a?.chapterIndex ?? chapterByClip.get(currentId);
    const swapIndex = repaired.videoClips.findIndex((candidate, index) => {
      if (index <= i + 1 || (options.candidates.get(idOf(candidate))?.chapterIndex ?? chapterByClip.get(idOf(candidate))) !== chapter) return false;
      const replacement = options.candidates.get(idOf(candidate));
      const replacementAsset = replacement && options.assets.get(replacement.itemId);
      const duplicate = !!((aAsset?.dupOf && aAsset.dupOf === replacement?.itemId) || (replacementAsset?.dupOf && replacementAsset.dupOf === a?.itemId));
      const nearIdentical = !!(a && replacement && descriptionSimilarity(a.description, replacement.description) >= 0.8);
      const repeatsVideo = !("kind" in current) && !("kind" in candidate) && current.source.kind === "video" && candidate.source.kind === "video" && current.source.shotId === candidate.source.shotId;
      return !duplicate && !nearIdentical && !repeatsVideo;
    });
    if (swapIndex < 0) continue;
    [repaired.videoClips[i + 1], repaired.videoClips[swapIndex]] = [repaired.videoClips[swapIndex]!, repaired.videoClips[i + 1]!];
    reviewNotes.push(sameSource ? `adjacent same-video clips spread: ${currentId}` : `adjacent near-identical shots swapped: ${currentId}`);
    reflow(repaired);
  }

  for (const clip of repaired.videoClips) {
    if (!isPhoto(clip)) continue;
    const locked = options.lockedMoments?.some(moment => moment.clipId === idOf(clip));
    if (locked) continue;
    const bounded = Math.min(options.recipe.photoHold[1], Math.max(options.recipe.photoHold[0], clip.durationSec));
    if (Math.abs(bounded - clip.durationSec) > 0.001) {
      reviewNotes.push(`photo hold fitted to recipe: ${idOf(clip)} ${round(clip.durationSec)}s→${round(bounded)}s`);
      clip.durationSec = bounded;
      reflow(repaired);
    }
  }

  for (const lock of options.lockedMoments ?? []) {
    const clip = repaired.videoClips.find(item => idOf(item) === lock.clipId);
    if (!clip) continue;
    if (Math.abs(clip.startSec - lock.startSec) > 0.001 || Math.abs(clip.durationSec - lock.durationSec) > 0.001) {
      clip.startSec = lock.startSec;
      clip.durationSec = lock.durationSec;
      reviewNotes.push(`locked moment restored: ${lock.clipId}`);
    }
  }
  if (reviewNotes.some(note => note.startsWith("locked moment restored:"))) reflow(repaired);

  while (repaired.durationSec > options.targetSec * 1.1) {
    const removable = repaired.videoClips.filter(isPhoto).filter(clip => !options.lockedMoments?.some(lock => lock.clipId === idOf(clip)))
      .sort((left, right) => {
        const score = (clip: PhotoClip) => {
          const candidate = options.candidates.get(idOf(clip));
          return momentScore({ quality: candidate?.quality, emotion: candidate?.emotion, energy: candidate?.energy });
        };
        return score(left) - score(right) || idOf(left).localeCompare(idOf(right));
      })[0];
    if (!removable) break;
    const candidate = options.candidates.get(idOf(removable));
    const shotId = candidate ? options.shotIdByMoment.get(candidate.itemId) ?? removable.source.shotId : removable.source.shotId;
    repaired.videoClips = repaired.videoClips.filter(clip => clip !== removable);
    leftOut.push({ shotId, reason: "film exceeds chosen length" });
    reviewNotes.push(`overlength photo dropped to leftOut: ${idOf(removable)}`);
    reflow(repaired);
  }

  if (options.music?.hasPulse && options.music.beatsSec.length > 1) {
    const before = repaired.videoClips.map(clip => clip.durationSec);
    const snapped = snapPhotoBoundaries(repaired.videoClips.map(clip => ({
      kind: "kind" in clip ? "collage" as const : clip.source.kind,
      holdSec: clip.durationSec,
      minHoldSec: options.recipe.photoHold[0], maxHoldSec: options.recipe.photoHold[1],
      locked: options.lockedMoments?.some(lock => lock.clipId === idOf(clip)),
      transitionOverlapSec: clip.transitionIn?.kind === "crossfade" ? clip.transitionIn.durationSec : 0,
    })), options.music, options.recipe.cutOn, 0.5);
    snapped.forEach((clip, index) => { repaired.videoClips[index]!.durationSec = round(clip.holdSec); });
    reflow(repaired);
    if (snapped.some((clip, index) => Math.abs(clip.holdSec - before[index]!) > 0.001)) {
      reviewNotes.push("photo cut re-snapped to music beat");
    }
  }
  return { timeline: repaired, reviewNotes, leftOut };
}
