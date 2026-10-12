import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  ALLOWED_COMBOS, COLLAGE_EFFECTS, COLLAGE_LAYOUTS, CollageSpecSchema,
  applyEdits, type CollageClip, type Timeline,
  collageSlotAspects, assignCollageSlots,
} from "@mosae/contracts";
import { hamming64 } from "../cluster/duplicates.js";
import { collageCountRange, collagePlacementOptions, DIRECTING_RULES, photoBaseDuration, requestedCollageCount } from "./directingRules.js";
import type { CadenceId } from "@mosae/contracts";
import { reflow } from "@mosae/contracts";

export type CollageSource = {
  assetId: string;
  width?: number;
  height?: number;
  chapterId: string;
  eventId?: string | null;
  localTime?: string | null;
  dHash?: string | null;
  dupOf?: string | null;
  hasSpeech?: boolean;
};
export type CollageStyle = { collageAmount?: "few" | "lots" | "none"; motionFeel?: "calm" | "playful"; cadenceId?: CadenceId; tierless?: boolean; stretchTargetSec?: number; lockedClipIds?: string[] };

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

function sameDayOrEvent(first: CollageSource, next: CollageSource): boolean {
  if (first.chapterId !== next.chapterId || first.hasSpeech || next.hasSpeech) return false;
  const firstDay = first.localTime?.slice(0, 10);
  const nextDay = next.localTime?.slice(0, 10);
  return Boolean((firstDay && firstDay === nextDay) || (first.eventId && first.eventId === next.eventId));
}

function stretchTierlessPhotos(timeline: Timeline, cadenceId: CadenceId, targetSec: number = DIRECTING_RULES.minimumFilmSec): Timeline {
  const plans = timeline.videoClips.map((clip) => {
    const count = "kind" in clip ? clip.spec.slots.length : clip.source.kind === "photo" ? 1 : 0;
    const cap = count ? Math.min(count === 1 ? DIRECTING_RULES.singlePhotoMaxSec : Infinity, photoBaseDuration(count, cadenceId) * DIRECTING_RULES.tierlessPhotoStretchMultiplier) : clip.durationSec;
    return {
      ...clip,
      id: idOf(clip),
      source: "source" in clip ? clip.source : { kind: "collage" },
      durationSec: clip.durationSec,
      transitionIn: clip.transitionIn ?? { kind: "cut" as const, durationSec: 0 },
      strength: 0,
      minHoldSec: 0,
      maxHoldSec: cap,
    };
  });
  let fitted = plans.map((plan) => ({ ...plan }));
  for (let pass = 0; pass < 20; pass++) {
    const duration = fitted.reduce((sum, clip, index) => sum + clip.durationSec - (index > 0 && clip.transitionIn.kind === "crossfade" ? clip.transitionIn.durationSec : 0), 0);
    const drift = targetSec - duration;
    const extendable = fitted.filter((clip) => clip.maxHoldSec > clip.durationSec);
    if (drift <= 0.01 || !extendable.length) break;
    const step = drift / extendable.length;
    fitted = fitted.map((clip) => extendable.includes(clip)
      ? { ...clip, durationSec: Math.min(clip.maxHoldSec, clip.durationSec + step) }
      : clip);
  }
  const flowed = reflow({ fps: timeline.fps, plans: fitted, chapters: [] });
  const videoClips = flowed.clips.map((clip, index) => {
    const original = timeline.videoClips[index]!;
    const { id: _id, source: _source, transitionIn: _transition, ...geometry } = clip;
    if ("kind" in original) return {
      ...original,
      startSec: geometry.startSec,
      durationSec: geometry.durationSec,
      spec: { ...original.spec, durationSec: geometry.durationSec },
    };
    return { ...original, startSec: geometry.startSec, durationSec: geometry.durationSec };
  });
  const music = timeline.audioClips.filter((clip) => clip.role === "music" && clip.source.kind === "soundtrack");
  const fitMusic = () => {
    if (music.length < 2) return timeline.audioClips.map((clip) => {
      if (clip.role !== "music" || clip.source.kind !== "soundtrack") return clip;
      return { ...clip, source: { ...clip.source, sourceOutSec: clip.source.sourceInSec + Math.min(clip.source.sourceOutSec - clip.source.sourceInSec, Math.max(0, flowed.durationSec - clip.startSec)) }, fadeOutSec: Math.min(clip.fadeOutSec, flowed.durationSec) };
    });
    const body = music[0]!;
    const outro = music.at(-1)!;
    if (body.source.kind !== "soundtrack" || outro.source.kind !== "soundtrack") return timeline.audioClips;
    const tailDuration = Math.min(outro.source.sourceOutSec - outro.source.sourceInSec, Math.max(1, flowed.durationSec / 3));
    const joinSec = flowed.durationSec - tailDuration;
    const crossfadeSec = Math.min(body.fadeOutSec, joinSec, tailDuration);
    return timeline.audioClips.map((clip) => {
      if (clip.id === body.id && clip.source.kind === "soundtrack") return { ...clip, source: { ...clip.source, sourceOutSec: joinSec + crossfadeSec }, fadeOutSec: crossfadeSec };
      if (clip.id === outro.id && clip.source.kind === "soundtrack") return { ...clip, startSec: joinSec, source: { ...clip.source, sourceInSec: clip.source.sourceOutSec - tailDuration }, fadeInSec: crossfadeSec, fadeOutSec: Math.min(1, tailDuration) };
      return clip;
    });
  };
  return {
    ...timeline,
    durationSec: flowed.durationSec,
    videoClips,
    chapters: timeline.chapters.map((chapter) => {
      const index = timeline.videoClips.findIndex((clip) => Math.abs(clip.startSec - chapter.startSec) < 1 / timeline.fps);
      return index < 0 ? chapter : { ...chapter, startSec: videoClips[index]!.startSec };
    }),
    audioClips: fitMusic(),
  };
}

/** Replace eligible contiguous selected clips; never draws from unused moments. */
export function placeCollages(timeline: Timeline, sources: Map<string, CollageSource>, seed: string, review: CollageReview, style: CollageStyle = {}, mediaCount = sources.size): Timeline {
  const collageAmount = style.collageAmount ?? "few";
  const motionFeel = style.motionFeel ?? "calm";
  const cadenceId = style.cadenceId ?? "playful";
  const collageLimit = requestedCollageCount(mediaCount, collageAmount);
  if (collageLimit === 0) {
    const upgraded = { ...timeline, schemaVersion: 2 as const };
    return style.stretchTargetSec !== undefined ? stretchTierlessPhotos(upgraded, cadenceId, style.stretchTargetSec) : upgraded;
  }
  const approved = review.combos.filter((combo) => combo.verdict === "keep" && ALLOWED_COMBOS.some((allowed) => allowed.layoutId === combo.layoutId && allowed.motionId === combo.motionId));
  const countRules = collageCountRange(mediaCount).maxPhotos;
  const maxCandidateSlots = Math.min(countRules, DIRECTING_RULES.collageMaxPhotos, Math.max(2, ...COLLAGE_LAYOUTS.filter((layout) => layout.aspect.some((aspect) => aspect === timeline.aspect) && approved.some((combo) => combo.layoutId === layout.id)).map((layout) => layout.maxSlots)));
  const clips = timeline.videoClips;
  const replacements = new Map<number, { end: number; collage: CollageClip }>();
  const chapterCounts = new Map<string, number>();
  const usedShots = new Set<string>();
  let removedCount = 0;
  let lastLayout: string | undefined;
  const maxPerChapter = collageLimit;
  const lockedClipIds = new Set(style.lockedClipIds ?? []);
  const preferredMotions = motionFeel === "calm"
    ? new Set(["page-turn", "print-drop", "focus-relay"])
    : new Set(["stack-deal", "tape-slap", "crash-zoom"]);

  for (let index = 0; index < clips.length && replacements.size < collageLimit;) {
    const first = clips[index];
    const origin = sources.get(idOf(first));
    if (!origin || lockedClipIds.has(idOf(first)) || "kind" in first || (chapterCounts.get(origin.chapterId) ?? 0) >= maxPerChapter) { index++; continue; }
    const group = [first];
    // Video clips remain independent timeline clips; never convert them into collage slots.
    if (first.source.kind === "video") { index++; continue; }
    for (let nextIndex = index + 1; nextIndex < clips.length && group.length < maxCandidateSlots; nextIndex++) {
      const next = clips[nextIndex];
      const metadata = sources.get(idOf(next));
      if (!metadata || lockedClipIds.has(idOf(next)) || "kind" in next || next.source.kind === "video") break;
      if (!related(origin, metadata, true)) break;
      group.push(next);
    }
    // Ordinary trips rarely have sub-minute duplicate bursts. If the tight
    // candidate set is too small for a reviewed layout, use a coherent run
    // from one day or one event to reach its minimum slot count.
    const requiredMin = collageCountRange(mediaCount).minPhotos;
    if (group.length < requiredMin) {
      group.length = 1;
      for (let nextIndex = index + 1; nextIndex < clips.length && group.length < maxCandidateSlots; nextIndex++) {
        const next = clips[nextIndex];
        const metadata = sources.get(idOf(next));
        if (!metadata || lockedClipIds.has(idOf(next)) || "kind" in next || next.source.kind !== "photo" || first.source.kind !== "photo" || !sameDayOrEvent(origin, metadata)) break;
        group.push(next);
      }
    }
    const minGroup = requiredMin;
    if (group.length < minGroup) { index++; continue; }
    const shotIds = group.map((clip) => clip.source.shotId);
    if (new Set(shotIds).size !== shotIds.length || shotIds.some((shotId) => usedShots.has(shotId))) { index++; continue; }
    const finalCount = clips.length - removedCount - (group.length - 1);
    const combinations = approved.filter((combo) => {
      const layout = COLLAGE_LAYOUTS.find((item) => item.id === combo.layoutId);
      return layout && group.length >= layout.minSlots && group.length <= layout.maxSlots && layout.aspect.some((aspect) => aspect === timeline.aspect);
    });
    if (!combinations.length) { index += group.length; continue; }
    if ((replacements.size + 1) / finalCount > 0.4) { index += group.length; continue; }
    const preferred = combinations.filter((combo) => preferredMotions.has(combo.motionId));
    const motionChoices = preferred.length ? preferred : combinations;
    const varied = motionChoices.filter((combo) => combo.layoutId !== lastLayout);
    const choices = varied.length ? varied : motionChoices;
    const sourceAspects = group.map((clip) => {
      const source = clip.source;
      const dimensions = sources.get(idOf(clip));
      return dimensions?.width && dimensions.height ? dimensions.width / dimensions.height : source.width && source.height ? source.width / source.height : timeline.aspect === "16:9" ? 16 / 9 : 9 / 16;
    });
    const frameAspect = timeline.aspect === "16:9" ? 16 / 9 : 9 / 16;
    const score = (layoutId: string) => {
      const slots = collageSlotAspects(layoutId, layoutId, group.length, frameAspect);
      const assignment = assignCollageSlots(sourceAspects, slots);
      return assignment.reduce((sum, slotIndex, sourceIndex) => sum + Math.abs(Math.log(sourceAspects[sourceIndex]! / (slots[slotIndex] ?? sourceAspects[sourceIndex]!))), 0);
    };
    const bestScore = Math.min(...choices.map((combo) => score(combo.layoutId)));
    const bestChoices = choices.filter((combo) => score(combo.layoutId) <= bestScore + 0.08);
    const chosen = bestChoices[hash(`${seed}:${index}:combo`) % bestChoices.length];
    const effect = COLLAGE_EFFECTS[hash(`${seed}:${index}:effect`) % COLLAGE_EFFECTS.length];
    // Collage duration belongs to its photo count and cadence. Member holds
    // are independent shot choices and must not be summed into the collage.
    const collageBaseSec = photoBaseDuration(group.length, cadenceId);
    const durationSec = collageBaseSec;
    const spec = CollageSpecSchema.parse({
      layoutId: chosen.layoutId, motionId: chosen.motionId, effectId: effect.id,
      seed: `${seed}:${idOf(first)}`, durationSec,
      slots: (() => {
        const aspects = collageSlotAspects(chosen.layoutId, chosen.layoutId, group.length, frameAspect);
        const assignment = assignCollageSlots(sourceAspects, aspects);
        return group.map((clip, sourceIndex) => ({ clip, sourceIndex })).sort((a,b)=>assignment[a.sourceIndex]!-assignment[b.sourceIndex]!).map(({clip}) => ({
          slotId: idOf(clip), shotId: clip.source.shotId, kind: clip.source.kind,
          ...((sources.get(idOf(clip))?.width && sources.get(idOf(clip))?.height) ? { width: sources.get(idOf(clip))!.width!, height: sources.get(idOf(clip))!.height! } : clip.source.width && clip.source.height ? { width: clip.source.width, height: clip.source.height } : {}),
          ...(clip.source.kind === "photo" && clip.source.crop ? { crop: clip.source.crop } : {}),
        }));
      })(),
    });
    const collage: CollageClip = {
      kind: "collage", clipId: `collage:${idOf(first)}`,
      chapterId: origin.chapterId, startSec: first.startSec, durationSec,
      transitionIn: first.transitionIn, spec,
    };
    replacements.set(index, { end: index + group.length, collage });
    chapterCounts.set(origin.chapterId, (chapterCounts.get(origin.chapterId) ?? 0) + 1);
    for (const shotId of shotIds) usedShots.add(shotId);
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
  // A stable seed selects a permitted boundary arrangement. Prefer a choice
  // based on story metadata, but only if it preserves the already-directed
  // order of every story beat around each collage.
  const collageCount = replacements.size;
  const collageClips = [...replacements.values()].map(({ collage }) => collage);
  const placementSeed = `${seed}:${collageClips.map((collage) => `${collage.chapterId}:${collage.spec.slots.map((slot) => slot.shotId).join(",")}`).join("|")}`;
  const lockedSlots = visual.flatMap((clip, index) => lockedClipIds.has(idOf(clip)) ? [index] : []);
  const positionOptions = collagePlacementOptions(visual.length, collageCount, lockedSlots);
  const preservesArc = (positions: number[]) => {
    const moved = [...visual];
    for (let index = 0; index < positions.length; index++) {
      const collage = collageClips[index]!;
      const from = moved.findIndex((clip) => idOf(clip) === collage.clipId);
      const [clip] = moved.splice(from, 1);
      moved.splice(positions[index]!, 0, clip!);
    }
    return collageClips.every((collage) => {
      const beforeOriginal = visual.slice(0, visual.findIndex((clip) => idOf(clip) === collage.clipId)).map(idOf);
      const beforeMoved = moved.slice(0, moved.findIndex((clip) => idOf(clip) === collage.clipId)).map(idOf);
      return beforeOriginal.length === beforeMoved.length && beforeOriginal.every((clipId, index) => clipId === beforeMoved[index]);
    });
  };
  const safeOptions = positionOptions.filter(preservesArc);
  let placement: number[] = [];
  if (safeOptions.length) {
    let value = 2166136261;
    for (const char of placementSeed) value = Math.imul(value ^ char.charCodeAt(0), 16777619);
    placement = safeOptions[(value >>> 0) % safeOptions.length]!;
  }
  const targets = placement.map((position, index) => ({ clipId: collageClips[index]!.clipId, position }));
  const provisional: Timeline = { ...timeline, schemaVersion: 2, videoClips: visual };
  let relaid = provisional;
  for (const target of targets) {
    const moved = applyEdits(relaid, [{ op: "move", clipId: target.clipId, toIndex: target.position }]);
    if (!moved.ok) throw new Error(`collage placement failed: ${moved.error}`);
    relaid = moved.timeline;
  }
  // applyEdits performs reflow after each move and preserves clip identities.
  return style.stretchTargetSec !== undefined || style.tierless ? stretchTierlessPhotos(relaid, cadenceId, style.stretchTargetSec ?? DIRECTING_RULES.minimumFilmSec) : relaid;
}
