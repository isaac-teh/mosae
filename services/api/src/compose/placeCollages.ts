import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  ALLOWED_COMBOS, COLLAGE_EFFECTS, COLLAGE_LAYOUTS, CollageSpecSchema,
  applyEdits, type CollageClip, type Timeline,
} from "@mosae/contracts";
import { hamming64 } from "../cluster/duplicates.js";

export type CollageSource = {
  assetId: string;
  chapterId: string;
  eventId?: string | null;
  localTime?: string | null;
  dHash?: string | null;
  dupOf?: string | null;
  hasSpeech?: boolean;
};

export type CollageReview = { combos: Array<{ layoutId: string; motionId: string; verdict: string }> };
const defaultReviewPath = fileURLToPath(new URL("../../../../docs/design/collage-review.json", import.meta.url));

/** A missing review file uses only the combinations approved in contracts. */
export function loadCollageReview(path = defaultReviewPath): CollageReview {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as CollageReview;
    if (!Array.isArray(parsed.combos)) throw new Error("missing combos");
    return parsed;
  } catch (error) {
    console.warn(`collage review unavailable at ${path}; using reviewed combinations`, error);
    return { combos: ALLOWED_COMBOS.map((combo) => ({ ...combo, verdict: "keep" })) };
  }
}

const idOf = (clip: Timeline["videoClips"][number]) => "kind" in clip ? clip.clipId : clip.id;
const hash = (value: string) => {
  let result = 2166136261;
  for (const char of value) result = Math.imul(result ^ char.charCodeAt(0), 16777619);
  return result >>> 0;
};
const milliseconds = (localTime: string | null | undefined) => localTime ? Date.parse(`${localTime}Z`) : Number.NaN;
const hashDistance = (a: string | null | undefined, b: string | null | undefined) => {
  if (!a || !b || !/^[0-9a-f]{16}$/i.test(a) || !/^[0-9a-f]{16}$/i.test(b)) return Infinity;
  return hamming64(Number.parseInt(a.slice(0, 8), 16), Number.parseInt(a.slice(8), 16), Number.parseInt(b.slice(0, 8), 16), Number.parseInt(b.slice(8), 16));
};

function related(
  first: CollageSource,
  next: CollageSource,
  allPhotos: boolean,
): boolean {
  if (first.chapterId !== next.chapterId || first.hasSpeech || next.hasSpeech) return false;
  const elapsed = Math.abs(milliseconds(first.localTime) - milliseconds(next.localTime));
  const sameEventRun = allPhotos && first.eventId && next.eventId === first.eventId && elapsed <= 600_000;
  const duplicateGroup = first.dupOf || next.dupOf
    ? (first.dupOf ?? first.assetId) === (next.dupOf ?? next.assetId)
    : false;
  const nearDuplicate = elapsed <= 10_000 && hashDistance(first.dHash, next.dHash) <= 6;
  return Boolean(sameEventRun || duplicateGroup || nearDuplicate);
}

/** Replace eligible contiguous selected clips; never draws from unused moments. */
export function placeCollages(timeline: Timeline, sources: Map<string, CollageSource>, seed: string, review: CollageReview): Timeline {
  const approved = review.combos.filter((combo) => combo.verdict === "keep" && ALLOWED_COMBOS.some((allowed) => allowed.layoutId === combo.layoutId && allowed.motionId === combo.motionId));
  const clips = timeline.videoClips;
  const replacements = new Map<number, { end: number; collage: CollageClip }>();
  const usedChapters = new Set<string>();
  let removedCount = 0;
  let lastLayout: string | undefined;

  for (let index = 0; index < clips.length;) {
    const first = clips[index];
    const origin = sources.get(idOf(first));
    if (!origin || "kind" in first || usedChapters.has(origin.chapterId)) { index++; continue; }
    const group = [first];
    let videos = first.source.kind === "video" ? 1 : 0;
    for (let nextIndex = index + 1; nextIndex < clips.length && group.length < 6; nextIndex++) {
      const next = clips[nextIndex];
      const metadata = sources.get(idOf(next));
      if (!metadata || "kind" in next || videos + Number(next.source.kind === "video") > 1) break;
      if (!related(origin, metadata, videos === 0 && next.source.kind === "photo")) break;
      group.push(next);
      videos += Number(next.source.kind === "video");
    }
    if (group.length < 3) { index++; continue; }
    const finalCount = clips.length - removedCount - (group.length - 1);
    if ((replacements.size + 1) / finalCount > 0.25) { index += group.length; continue; }
    const combinations = approved.filter((combo) => {
      const layout = COLLAGE_LAYOUTS.find((item) => item.id === combo.layoutId);
      return layout && group.length >= layout.minSlots && group.length <= layout.maxSlots && layout.aspect.some((aspect) => aspect === timeline.aspect);
    });
    if (!combinations.length) { index += group.length; continue; }
    const varied = combinations.filter((combo) => combo.layoutId !== lastLayout);
    const choices = varied.length ? varied : combinations;
    const chosen = choices[hash(`${seed}:${index}:combo`) % choices.length];
    const effect = COLLAGE_EFFECTS[hash(`${seed}:${index}:effect`) % COLLAGE_EFFECTS.length];
    const durationSec = Math.min(5, Math.max(3, group.length));
    const spec = CollageSpecSchema.parse({
      layoutId: chosen.layoutId, motionId: chosen.motionId, effectId: effect.id,
      seed: `${seed}:${idOf(first)}`, durationSec,
      slots: group.map((clip) => ({ slotId: idOf(clip), shotId: clip.source.shotId, kind: clip.source.kind })),
      caption: { place: [...timeline.chapters].reverse().find((chapter) => chapter.startSec <= first.startSec)?.title ?? "", date: origin.localTime?.slice(0, 10) },
    });
    const collage: CollageClip = {
      kind: "collage", clipId: `collage:${idOf(first)}`,
      chapterId: origin.chapterId, startSec: first.startSec, durationSec,
      transitionIn: first.transitionIn, spec,
    };
    replacements.set(index, { end: index + group.length, collage });
    usedChapters.add(origin.chapterId);
    removedCount += group.length - 1;
    lastLayout = chosen.layoutId;
    index += group.length;
  }

  if (!replacements.size) return { ...timeline, schemaVersion: 2 };
  const skipped = new Set([...replacements.entries()].flatMap(([start, entry]) => Array.from({ length: entry.end - start - 1 }, (_, offset) => start + offset + 1)));
  const visual = clips.flatMap((clip, index) => {
    const replacement = replacements.get(index);
    if (replacement) return [replacement.collage];
    return skipped.has(index) ? [] : [clip];
  });
  const provisional: Timeline = { ...timeline, schemaVersion: 2, videoClips: visual };
  const relaid = applyEdits(provisional, [{ op: "move", clipId: idOf(visual[0]), toIndex: 0 }]);
  if (!relaid.ok) throw new Error(`collage placement failed: ${relaid.error}`);
  return relaid.timeline;
}
