import { z } from "zod";
import { COLLAGE_LAYOUTS, CollageSpecSchema } from "./collage.js";
import { ALLOWED_COMBOS } from "./collageCombos.js";
import { collageSlotAspects, assignCollageSlots } from "./collageGeometry.js";
import { safeParseTimeline, type AudioClip, type Caption, type CollageClip, type Timeline, type VideoClip } from "./timeline.js";
import { finalMusicFadeOutSec, refitSoundtrackToDuration } from "./soundtrack.js";

const clipId = z.string().min(1);
const shotId = z.string().min(1);
const seconds = z.number().finite().nonnegative();
const positiveSeconds = z.number().finite().positive();

export const EditOpSchema = z.discriminatedUnion("op", [
  z.strictObject({ op: z.literal("swapShot"), clipId, shotId, kind: z.enum(["photo", "video"]).optional(), sourceInSec: seconds.optional(), sourceOutSec: positiveSeconds.optional(), sourceDurationSec: positiveSeconds.optional(), durationSec: positiveSeconds.optional(), width: positiveSeconds.optional(), height: positiveSeconds.optional(), sourceStartSec: seconds.optional(), sourceEndSec: positiveSeconds.optional() }),
  z.strictObject({ op: z.literal("trim"), clipId, inSec: seconds, outSec: positiveSeconds }),
  z.strictObject({ op: z.literal("setPhotoDuration"), clipId, sec: positiveSeconds }),
  z.strictObject({ op: z.literal("setCollageDuration"), clipId, sec: positiveSeconds }),
  z.strictObject({ op: z.literal("move"), clipId, toIndex: z.number().int().nonnegative() }),
  z.strictObject({ op: z.literal("remove"), clipId }),
  z.strictObject({ op: z.literal("duplicate"), clipId }),
  z.strictObject({ op: z.literal("add"), shotId, kind: z.enum(["photo", "video"]), afterClipId: clipId.nullable(), durationSec: positiveSeconds, sourceInSec: seconds.optional(), sourceOutSec: positiveSeconds.optional(), sourceDurationSec: positiveSeconds.optional() }),
  z.strictObject({ op: z.literal("setCollageLayout"), clipId, layoutId: z.string().min(1) }),
  z.strictObject({ op: z.literal("setCollageMotion"), clipId, motionId: z.string().min(1) }),
  z.strictObject({ op: z.literal("setCollageEffect"), clipId, effectId: z.string().min(1).nullable() }),
  z.strictObject({ op: z.literal("replaceCollageSlot"), clipId, slotId: z.string().min(1), shotId, kind: z.enum(["photo", "video"]), width: positiveSeconds.optional(), height: positiveSeconds.optional() }),
  z.strictObject({ op: z.literal("setCollageCrop"), clipId, slotId: z.string().min(1), crop: z.strictObject({ x: z.number().min(0).max(1), y: z.number().min(0).max(1), scale: z.number().min(1).max(4), rotationDeg: z.number().finite().min(-180).max(180).optional() }) }),
  z.strictObject({ op: z.literal("setPhotoCrop"), clipId, crop: z.strictObject({ x: z.number().min(0).max(1), y: z.number().min(0).max(1), scale: z.number().min(1).max(4), rotationDeg: z.number().finite().min(-180).max(180).optional() }) }),
  z.strictObject({ op: z.literal("setCollageSpec"), clipId, spec: CollageSpecSchema }),
  z.strictObject({ op: z.literal("addCollageSlot"), clipId, slotId: z.string().min(1), shotId, kind: z.enum(["photo", "video"]), width: positiveSeconds.optional(), height: positiveSeconds.optional() }),
  z.strictObject({ op: z.literal("removeCollageSlot"), clipId, slotId: z.string().min(1) }),
  z.strictObject({ op: z.literal("splitCollage"), clipId }),
  z.strictObject({ op: z.literal("mergeIntoCollage"), clipIds: z.array(clipId).min(2).max(4) }),
  z.strictObject({ op: z.literal("setAspect"), aspect: z.enum(["9:16", "16:9"]) }),
  z.strictObject({ op: z.literal("setSoundtrack"), soundtrackId: z.string().min(1) }),
  z.strictObject({ op: z.literal("setMusicVolume"), audioClipId: clipId, gainDb: z.number().finite().min(-60).max(12) }),
]);

export type EditOp = z.infer<typeof EditOpSchema>;
export type EditResult = { ok: true; timeline: Timeline; leftOutShotIds: string[] } | { ok: false; error: string; opIndex: number };

type VisualClip = Timeline["videoClips"][number];
type AttachedCaption = { text: string; offsetStart: number; offsetEnd: number };
type AttachedAudio = { clip: AudioClip; offset: number };
type WorkClip = { clip: VisualClip; chapter: number; captions: AttachedCaption[]; audio: AttachedAudio[] };

const idOf = (clip: VisualClip) => "kind" in clip ? clip.clipId : clip.id;
const shotIdsOf = (clip: VisualClip) => "kind" in clip
  ? clip.spec.slots.flatMap((slot) => slot.shotId ? [slot.shotId] : [])
  : [clip.source.shotId];

function attach(firstCut: Timeline): WorkClip[] {
  const chapterStarts = firstCut.chapters.map((chapter) => chapter.startSec);
  const captionOwners = firstCut.captions.map((caption) => firstCut.videoClips.reduce((owner, clip, index) => {
    const contains = caption.startSec >= clip.startSec - 1e-6 && caption.endSec <= clip.startSec + clip.durationSec + 1e-6;
    return contains && (owner < 0 || clip.startSec > firstCut.videoClips[owner].startSec) ? index : owner;
  }, -1));
  return firstCut.videoClips.map((clip, clipIndex) => {
    let chapter = 0;
    chapterStarts.forEach((start, index) => { if (start <= clip.startSec + 1e-6) chapter = index; });
    const captions = firstCut.captions
      .filter((_, captionIndex) => captionOwners[captionIndex] === clipIndex)
      .map((caption) => ({ text: caption.text, offsetStart: caption.startSec - clip.startSec, offsetEnd: caption.endSec - clip.startSec }));
    const audio = firstCut.audioClips
      .filter((track) => track.source.kind === "asset" && "source" in clip && track.source.assetId === clip.source.shotId && track.startSec >= clip.startSec - 1e-6 && track.startSec < clip.startSec + clip.durationSec)
      .map((track) => ({ clip: track, offset: track.startSec - clip.startSec }));
    return { clip, chapter, captions, audio };
  });
}

function buildTimeline(firstCut: Timeline, work: WorkClip[], soundtrackId?: string, musicGains: Map<string, number> = new Map()): Timeline {
  let cursor = 0;
  const videoClips = work.map((item, index) => {
    const overlap = index > 0 && item.clip.transitionIn?.kind === "crossfade"
      ? Math.min(item.clip.transitionIn.durationSec, work[index - 1].clip.durationSec, cursor)
      : 0;
    const clip = { ...item.clip, startSec: cursor - overlap };
    cursor = clip.startSec + clip.durationSec;
    if ("kind" in clip) return { ...clip, spec: { ...clip.spec, durationSec: clip.durationSec } };
    return clip;
  });
  const durationSec = cursor;
  const chapters = firstCut.chapters.flatMap((chapter, index) => {
    const members = videoClips.filter((_, clipIndex) => work[clipIndex].chapter === index);
    if (!members.length) return [];
    const startSec = members[0].startSec;
    const endSec = members.at(-1)!.startSec + members.at(-1)!.durationSec;
    return [{ title: chapter.title, startSec, durationSec: endSec - startSec }];
  }).sort((a, b) => a.startSec - b.startSec);
  const captions: Caption[] = work.flatMap((item, index) => item.captions.flatMap((caption) => {
    const startSec = videoClips[index].startSec + Math.min(caption.offsetStart, item.clip.durationSec);
    const endSec = videoClips[index].startSec + Math.min(caption.offsetEnd, item.clip.durationSec);
    return endSec > startSec ? [{ text: caption.text, startSec, endSec }] : [];
  }));
  let soundtrackReplacementWritten = false;
  const audioClips: AudioClip[] = firstCut.audioClips.flatMap((track) => {
    if (track.source.kind === "soundtrack" && track.role === "music" && soundtrackId !== undefined) {
      if (soundtrackReplacementWritten) return [];
      soundtrackReplacementWritten = true;
    }
    const refit = track.source.kind === "soundtrack" && track.role === "music"
      ? soundtrackId !== undefined
        ? { ...track, startSec: 0, gainDb: musicGains.get(track.id) ?? track.gainDb, source: { ...track.source, soundtrackId, sourceInSec: 0, sourceOutSec: durationSec }, fadeOutSec: finalMusicFadeOutSec(durationSec) }
        : { ...track, gainDb: musicGains.get(track.id) ?? track.gainDb }
      : track;
    const available = durationSec - refit.startSec;
    if (available <= 0) return [];
    const sourceLength = refit.source.sourceOutSec - refit.source.sourceInSec;
    const fittedLength = Math.min(sourceLength, available);
    if (fittedLength <= 0) return [];
    return [{ ...refit, source: { ...refit.source, sourceOutSec: refit.source.sourceInSec + fittedLength } }];
  });
  if (soundtrackId && !audioClips.some((track) => track.source.kind === "soundtrack")) {
    audioClips.push({ id: "editor-soundtrack", source: { kind: "soundtrack", soundtrackId, sourceInSec: 0, sourceOutSec: durationSec }, role: "music", startSec: 0, gainDb: musicGains.get("editor-soundtrack") ?? -18, fadeInSec: 0.5, fadeOutSec: finalMusicFadeOutSec(durationSec) });
  }
  work.forEach((item, index) => item.audio.forEach(({ clip, offset }) => {
    if (clip.source.kind !== "asset") return;
    const remaining = item.clip.durationSec - offset;
    const length = Math.min(clip.source.sourceOutSec - clip.source.sourceInSec, remaining);
    if (length <= 0) return;
    audioClips.push({ ...clip, startSec: videoClips[index].startSec + offset, source: { ...clip.source, sourceOutSec: clip.source.sourceInSec + length } });
  }));
  return { ...firstCut, schemaVersion: 2, durationSec, chapters, videoClips, audioClips, captions };
}

function collageWithSpec(clip: CollageClip, spec: CollageClip["spec"]): CollageClip | string {
  const parsed = CollageSpecSchema.safeParse(spec);
  if (!parsed.success) return parsed.error.issues.map((issue) => issue.message).join("; ");
  return { ...clip, spec: parsed.data };
}

export function applyEdits(firstCut: Timeline, ops: EditOp[]): EditResult {
  const base = safeParseTimeline(firstCut);
  if (!base.ok) return { ok: false, error: base.errors.join("; "), opIndex: -1 };
  if (ops.length === 0) return { ok: true, timeline: base.timeline, leftOutShotIds: [] };
  let work = attach(base.timeline);
  const videoBounds = new Map(work.flatMap((item) => "source" in item.clip && item.clip.source.kind === "video"
    ? [[idOf(item.clip), { inSec: item.clip.source.sourceStartSec ?? (item.clip.source.sourceDurationSec !== undefined ? 0 : item.clip.source.sourceInSec), outSec: item.clip.source.sourceEndSec ?? item.clip.source.sourceDurationSec ?? item.clip.source.sourceOutSec }] as const]
    : []));
  let soundtrackId: string | undefined;
  let aspect = base.timeline.aspect;
  const musicGains = new Map<string, number>();
  const leftOutShotIds: string[] = [];
  for (let opIndex = 0; opIndex < ops.length; opIndex++) {
    const parsed = EditOpSchema.safeParse(ops[opIndex]);
    if (!parsed.success) return { ok: false, error: parsed.error.issues.map((issue) => issue.message).join("; "), opIndex };
    const op = parsed.data;
    const index = "clipId" in op ? work.findIndex((item) => idOf(item.clip) === op.clipId) : -1;
    if ("clipId" in op && index < 0) return { ok: false, error: `unknown clipId: ${op.clipId}`, opIndex };
    const fail = (error: string): EditResult => ({ ok: false, error, opIndex });
    const item = index >= 0 ? work[index] : undefined;

    switch (op.op) {
      case "swapShot": {
        if (!item || !("source" in item.clip)) return fail("swapShot requires a photo or video clip");
        const source = item.clip.source;
        const replacementKind = op.kind ?? source.kind;
        if (replacementKind === "video") {
          const sourceInSec = op.sourceInSec ?? (source.kind === "video" ? source.sourceInSec : 0);
          const sourceOutSec = op.sourceOutSec ?? (source.kind === "video" ? source.sourceOutSec : sourceInSec + (op.durationSec ?? item.clip.durationSec));
          if (sourceOutSec <= sourceInSec) return fail("video replacement range must be positive");
          const sourceDurationSec = op.sourceDurationSec;
          item.clip = { ...item.clip, durationSec: op.durationSec ?? sourceOutSec - sourceInSec, source: {
            kind: "video", shotId: op.shotId, sourceInSec, sourceOutSec,
            ...(sourceDurationSec !== undefined ? { sourceDurationSec } : {}),
            ...(op.width !== undefined ? { width: op.width } : {}), ...(op.height !== undefined ? { height: op.height } : {}),
            ...(op.sourceStartSec !== undefined ? { sourceStartSec: op.sourceStartSec } : {}), ...(op.sourceEndSec !== undefined ? { sourceEndSec: op.sourceEndSec } : {}),
          } } as VideoClip;
          videoBounds.set(op.clipId, { inSec: op.sourceStartSec ?? sourceInSec, outSec: op.sourceEndSec ?? sourceOutSec });
        } else {
          item.clip = { ...item.clip, durationSec: op.durationSec ?? item.clip.durationSec, source: { kind: "photo", shotId: op.shotId, ...(op.width !== undefined ? { width: op.width } : {}), ...(op.height !== undefined ? { height: op.height } : {}) } } as VideoClip;
          videoBounds.delete(op.clipId);
        }
        break;
      }
      case "trim": {
        if (!item || !("source" in item.clip) || item.clip.source.kind !== "video") return fail("trim requires a video clip");
        if (op.outSec - op.inSec < 0.5) return fail("trim requires at least half a second");
        const bounds = videoBounds.get(op.clipId) ?? { inSec: item.clip.source.sourceInSec, outSec: item.clip.source.sourceOutSec };
        if (op.inSec < bounds.inSec || op.outSec > bounds.outSec) return fail("trim must stay within the source clip");
        item.clip = { ...item.clip, durationSec: op.outSec - op.inSec, source: { ...item.clip.source, sourceInSec: op.inSec, sourceOutSec: op.outSec } };
        break;
      }
      case "setPhotoDuration": {
        if (!item || !("source" in item.clip) || item.clip.source.kind !== "photo") return fail("setPhotoDuration requires a photo clip");
        if (op.sec < 0.5 || op.sec > 6) return fail("photo duration must be 0.5–6 seconds");
        item.clip = { ...item.clip, durationSec: op.sec };
        break;
      }
      case "setCollageDuration": {
        if (!item || !("kind" in item.clip)) return fail("setCollageDuration requires a collage clip");
        if (op.sec < 0.5) return fail("collage duration must be at least half a second");
        item.clip = { ...item.clip, durationSec: op.sec, spec: { ...item.clip.spec, durationSec: op.sec } };
        break;
      }
      case "move": {
        if (op.toIndex >= work.length) return fail("move index is outside the timeline");
        if (op.toIndex === index) break;
        const [moving] = work.splice(index, 1);
        work.splice(op.toIndex, 0, moving);
        moving.chapter = work[op.toIndex - 1]?.chapter ?? work[op.toIndex + 1]?.chapter ?? moving.chapter;
        break;
      }
      case "remove": {
        if (work.length === 1) return fail("cannot remove the last clip");
        leftOutShotIds.push(...shotIdsOf(work[index].clip));
        work.splice(index, 1);
        break;
      }
      case "duplicate": {
        const original = work[index]!;
        const id = `duplicate:${op.clipId}:${ops.slice(0, opIndex + 1).filter((prior) => prior.op === "duplicate" && prior.clipId === op.clipId).length}`;
        const copy: WorkClip = {
          ...original,
          clip: "kind" in original.clip ? { ...original.clip, clipId: id } : { ...original.clip, id },
          captions: original.captions.map((caption) => ({ ...caption })),
          audio: original.audio.map((attached) => ({ ...attached, clip: { ...attached.clip, source: { ...attached.clip.source } } })),
        };
        work.splice(index + 1, 0, copy);
        break;
      }
      case "add": {
        const afterIndex = op.afterClipId === null ? -1 : work.findIndex((entry) => idOf(entry.clip) === op.afterClipId);
        if (op.afterClipId !== null && afterIndex < 0) return fail(`unknown clipId: ${op.afterClipId}`);
        if (op.kind === "video" && (op.sourceInSec === undefined || op.sourceOutSec === undefined || op.sourceOutSec - op.sourceInSec < op.durationSec)) return fail("video add requires a source range covering its duration");
        if (op.kind === "video" && op.sourceDurationSec !== undefined && op.sourceOutSec! > op.sourceDurationSec) return fail("video add source range exceeds the asset duration");
        const count = ops.slice(0, opIndex + 1).filter((prior) => prior.op === "add" && prior.shotId === op.shotId).length;
        const id = `add:${op.shotId}:${count}`;
        if (op.kind === "video") videoBounds.set(id, { inSec: op.sourceInSec!, outSec: op.sourceOutSec! });
        const source = op.kind === "photo" ? { kind: "photo" as const, shotId: op.shotId } : { kind: "video" as const, shotId: op.shotId, sourceInSec: op.sourceInSec!, sourceOutSec: op.sourceOutSec!, sourceStartSec: op.sourceInSec!, sourceEndSec: op.sourceOutSec!, ...(op.sourceDurationSec !== undefined ? { sourceDurationSec: op.sourceDurationSec } : {}) };
        const chapter = work[afterIndex]?.chapter ?? work[0]?.chapter ?? 0;
        work.splice(afterIndex + 1, 0, { clip: { id, source, startSec: 0, durationSec: op.durationSec, transitionIn: { kind: "cut", durationSec: 0 } }, chapter, captions: [], audio: [] });
        break;
      }
      case "setPhotoCrop": {
        if (!item || !("source" in item.clip) || item.clip.source.kind !== "photo") return fail("setPhotoCrop requires a photo clip");
        item.clip = { ...item.clip, source: { ...item.clip.source, crop: op.crop } };
        break;
      }
      case "setCollageSpec": {
        if (!item || !("kind" in item.clip)) return fail("setCollageSpec requires a collage clip");
        const changed = collageWithSpec(item.clip, { ...op.spec, durationSec: item.clip.durationSec });
        if (typeof changed === "string") return fail(changed);
        const remainingShotIds = new Set(changed.spec.slots.flatMap((slot) => slot.shotId ? [slot.shotId] : []));
        leftOutShotIds.push(...item.clip.spec.slots.flatMap((slot) => slot.shotId && !remainingShotIds.has(slot.shotId) ? [slot.shotId] : []));
        item.clip = changed;
        break;
      }
      case "setCollageLayout":
      case "setCollageMotion":
      case "setCollageEffect":
      case "replaceCollageSlot":
      case "setCollageCrop":
      case "addCollageSlot":
      case "removeCollageSlot": {
        if (!item || !("kind" in item.clip)) return fail(`${op.op} requires a collage clip`);
        const spec = item.clip.spec;
        if ((op.op === "replaceCollageSlot" || op.op === "setCollageCrop" || op.op === "removeCollageSlot") && !spec.slots.some((slot) => slot.slotId === op.slotId)) return fail(`unknown slotId: ${op.slotId}`);
        if (op.op === "addCollageSlot") {
          const layout = COLLAGE_LAYOUTS.find((candidate) => candidate.id === spec.layoutId)!;
          if (spec.slots.length >= layout.maxSlots) return fail(`This layout holds up to ${layout.maxSlots} photos`);
          if (spec.slots.some((slot) => slot.slotId === op.slotId)) return fail(`duplicate slotId: ${op.slotId}`);
          if (op.kind === "video" && spec.slots.filter((slot) => slot.kind === "video").length >= layout.maxVideoCells) return fail("This layout holds up to 1 video cell");
        }
        if (op.op === "removeCollageSlot") {
          const layout = COLLAGE_LAYOUTS.find((candidate) => candidate.id === spec.layoutId)!;
          if (spec.slots.length <= layout.minSlots) return fail(`This layout needs at least ${layout.minSlots} photos`);
        }
        const parsedNext = opIndex + 1 < ops.length ? EditOpSchema.safeParse(ops[opIndex + 1]) : null;
        const nextOp = parsedNext?.success ? parsedNext.data : null;
        const layoutChange = op.op === "setCollageLayout" ? op : nextOp?.op === "setCollageLayout" && nextOp.clipId === op.clipId ? nextOp : null;
        const motionChange = op.op === "setCollageMotion" ? op : nextOp?.op === "setCollageMotion" && nextOp.clipId === op.clipId ? nextOp : null;
        const isLayoutMotionPair = Boolean(layoutChange && motionChange && ((op.op === "setCollageLayout" && nextOp?.op === "setCollageMotion") || (op.op === "setCollageMotion" && nextOp?.op === "setCollageLayout")));
        const next = isLayoutMotionPair ? { ...spec, layoutId: layoutChange!.layoutId, motionId: motionChange!.motionId, slots: spec.slots.map((slot) => slot.manualCrop ? slot : ({ ...slot, crop: undefined })) }
          : op.op === "setCollageLayout" ? { ...spec, layoutId: op.layoutId, slots: spec.slots.map((slot) => slot.manualCrop ? slot : ({ ...slot, crop: undefined })) }
          : op.op === "setCollageMotion" ? { ...spec, motionId: op.motionId }
          : op.op === "setCollageEffect" ? { ...spec, effectId: op.effectId }
          : op.op === "replaceCollageSlot" ? { ...spec, slots: spec.slots.map((slot) => slot.slotId === op.slotId ? { slotId: slot.slotId, shotId: op.shotId, kind: op.kind, ...(op.width !== undefined ? { width: op.width } : {}), ...(op.height !== undefined ? { height: op.height } : {}) } : slot) }
          : op.op === "setCollageCrop" ? { ...spec, slots: spec.slots.map((slot) => slot.slotId === op.slotId ? { ...slot, crop: op.crop, manualCrop: true } : slot) }
          : op.op === "addCollageSlot" ? { ...spec, slots: [...spec.slots, { slotId: op.slotId, shotId: op.shotId, kind: op.kind, ...(op.width !== undefined ? { width: op.width } : {}), ...(op.height !== undefined ? { height: op.height } : {}) }] }
          : { ...spec, slots: spec.slots.filter((slot) => slot.slotId !== op.slotId) };
        const changed = collageWithSpec(item.clip, next as CollageClip["spec"]);
        if (typeof changed === "string") return fail(changed);
        item.clip = changed;
        if (isLayoutMotionPair) opIndex += 1;
        break;
      }
      case "splitCollage": {
        if (!item || !("kind" in item.clip)) return fail("splitCollage requires a collage clip");
        const collage = item.clip;
        const populatedSlots = collage.spec.slots.filter((slot) => slot.shotId);
        if (!populatedSlots.length) return fail("Cannot split a collage with no populated slots");
        const each = collage.durationSec / populatedSlots.length;
        const split = populatedSlots.map((slot): WorkClip => ({
          clip: { id: `${collage.clipId}:${slot.slotId}`, source: { kind: "photo", shotId: slot.shotId! }, startSec: 0, durationSec: each, transitionIn: { kind: "cut", durationSec: 0 } },
          chapter: item.chapter, captions: [], audio: [],
        }));
        work.splice(index, 1, ...split);
        break;
      }
      case "mergeIntoCollage": {
        const indices = op.clipIds.map((id) => work.findIndex((entry) => idOf(entry.clip) === id));
        if (indices.some((found) => found < 0)) return fail(`unknown clipId: ${op.clipIds[indices.findIndex((found) => found < 0)]}`);
        if (new Set(op.clipIds).size !== op.clipIds.length) return fail("mergeIntoCollage clipIds must be unique");
        if (indices.some((found, position) => position > 0 && found !== indices[position - 1]! + 1)) return fail("mergeIntoCollage requires adjacent clips in timeline order");
        const members = indices.map((found) => work[found]!);
        if (members.some((member) => "kind" in member.clip || member.clip.source.kind !== "photo")) return fail("mergeIntoCollage only combines photo moments");
        if (members.some((member) => member.chapter !== members[0]!.chapter)) return fail("mergeIntoCollage cannot combine moments across chapters");
        const photos = members.map((member) => member.clip as VideoClip & { source: { kind: "photo"; shotId: string; width?: number; height?: number } });
        const frameAspect = aspect === "16:9" ? 16 / 9 : 9 / 16;
        const sources = photos.map((photo) => photo.source.width && photo.source.height ? photo.source.width / photo.source.height : frameAspect);
        const sizesKnown = photos.every((photo) => photo.source.width && photo.source.height);
        const candidates = COLLAGE_LAYOUTS.filter((layout) => layout.id.startsWith("simple-") && layout.minSlots <= photos.length && layout.maxSlots >= photos.length
          && layout.aspect.some((supported: string) => supported === aspect) && ALLOWED_COMBOS.some((combo) => combo.layoutId === layout.id && combo.motionId === "print-drop"))
          .map((layout) => {
            // Without known photo sizes every layout fits equally; keep the library order (first simple layout).
            if (!sizesKnown) return { layout, assignment: photos.map((_, position) => position), cost: 0 };
            const targets = collageSlotAspects(layout.id, layout.id, photos.length, frameAspect);
            const assignment = assignCollageSlots(sources, targets);
            const cost = assignment.reduce((sum, slotIndex, sourceIndex) => sum + Math.abs(Math.log(sources[sourceIndex]! / (targets[slotIndex] ?? sources[sourceIndex]!))), 0);
            return { layout, assignment, cost };
          });
        const chosen = candidates.reduce<(typeof candidates)[number] | undefined>((best, candidate) => !best || candidate.cost < best.cost - 1e-9 ? candidate : best, undefined);
        if (!chosen) return fail(`no collage layout fits ${photos.length} photos`);
        const clipId = `merge:${idOf(members[0]!.clip)}`;
        if (work.some((entry, position) => !indices.includes(position) && idOf(entry.clip) === clipId)) return fail(`duplicate clipId: ${clipId}`);
        const ordered = photos.map((photo, sourceIndex) => ({ photo, sourceIndex })).sort((a, b) => chosen.assignment[a.sourceIndex]! - chosen.assignment[b.sourceIndex]!);
        const slots = ordered.map(({ photo }, slotIndex) => ({
          slotId: `${clipId}:slot-${slotIndex + 1}`, shotId: photo.source.shotId, kind: "photo" as const,
          ...(photo.source.width && Number.isInteger(photo.source.width) ? { width: photo.source.width } : {}),
          ...(photo.source.height && Number.isInteger(photo.source.height) ? { height: photo.source.height } : {}),
        }));
        const total = photos.reduce((sum, photo) => sum + photo.durationSec, 0);
        const durationSec = Math.round(Math.min(Math.max(total, 3), 8) * 10) / 10;
        const scale = durationSec / total;
        let elapsed = 0;
        const captions = members.flatMap((member, memberIndex) => {
          const shift = elapsed;
          elapsed += photos[memberIndex]!.durationSec;
          return member.captions.map((caption) => ({ text: caption.text, offsetStart: (caption.offsetStart + shift) * scale, offsetEnd: (caption.offsetEnd + shift) * scale }));
        });
        const spec = { layoutId: chosen.layout.id, slots, motionId: "print-drop" as const, effectId: null, seed: clipId, durationSec };
        const collage: CollageClip = { kind: "collage", clipId, startSec: 0, durationSec, ...(members[0]!.clip.transitionIn ? { transitionIn: members[0]!.clip.transitionIn } : {}), spec };
        const checked = collageWithSpec(collage, spec);
        if (typeof checked === "string") return fail(checked);
        work.splice(indices[0]!, photos.length, { clip: checked, chapter: members[0]!.chapter, captions, audio: [] });
        break;
      }
      case "setAspect": {
        aspect = op.aspect;
        work = work.map((entry) => {
          if (!("kind" in entry.clip)) return entry;
          const spec = entry.clip.spec;
          const oldLayout = COLLAGE_LAYOUTS.find((layout) => layout.id === spec.layoutId)!;
          if (oldLayout.aspect.some((supported: string) => supported === aspect)) return entry;
          const candidates = COLLAGE_LAYOUTS.filter((layout) => layout.aspect.some((supported: string) => supported === aspect) && spec.slots.length >= layout.minSlots && spec.slots.length <= layout.maxSlots)
            .sort((a, b) => Number(b.preferredSlots === spec.slots.length) - Number(a.preferredSlots === spec.slots.length));
          const replacement = candidates.flatMap((layout) => ALLOWED_COMBOS.filter((combo) => combo.layoutId === layout.id).map((combo) => ({ ...entry.clip as CollageClip, spec: { ...spec, layoutId: layout.id, motionId: combo.motionId } }))).at(0);
          return replacement ? { ...entry, clip: replacement } : entry;
        });
        break;
      }
      case "setSoundtrack": soundtrackId = op.soundtrackId; break;
      case "setMusicVolume": {
        const music = base.timeline.audioClips.find((track) => track.id === op.audioClipId && track.role === "music" && track.source.kind === "soundtrack");
        const newSoundtrackCreated = op.audioClipId === "editor-soundtrack" && soundtrackId !== undefined;
        if (!music && !newSoundtrackCreated) return fail("setMusicVolume requires a soundtrack music clip");
        musicGains.set(op.audioClipId, op.gainDb);
        break;
      }
    }
    const result = safeParseTimeline({ ...buildTimeline(base.timeline, work, soundtrackId, musicGains), aspect });
    if (!result.ok) return fail(result.errors.join("; "));
  }
  const result = safeParseTimeline({ ...buildTimeline(base.timeline, work, soundtrackId, musicGains), aspect });
  if (!result.ok) return { ok: false, error: result.errors.join("; "), opIndex: Math.max(0, ops.length - 1) };
  return { ok: true, timeline: refitSoundtrackToDuration(result.timeline), leftOutShotIds };
}

export function mergeOps(ops: EditOp[]): EditOp[] {
  const merged: EditOp[] = [];
  for (const op of ops) {
    if (op.op === "setCollageSpec") {
      // A full collage spec supersedes earlier edits to that collage. Dropping
      // those snapshots also lets a current edit recover histories that contain
      // layout IDs removed since they were saved.
      for (let index = merged.length - 1; index >= 0; index--) {
        const previous = merged[index]!;
        if ("clipId" in previous && previous.clipId === op.clipId && [
          "setCollageSpec", "setCollageLayout", "setCollageMotion", "setCollageEffect",
          "replaceCollageSlot", "setCollageCrop", "addCollageSlot", "removeCollageSlot",
        ].includes(previous.op)) merged.splice(index, 1);
      }
    }
    const previous = merged.at(-1);
    if (previous && ((op.op === "trim" || op.op === "setPhotoDuration" || op.op === "move") && previous.op === op.op && previous.clipId === op.clipId || op.op === "setMusicVolume" && previous.op === "setMusicVolume" && previous.audioClipId === op.audioClipId)) {
      merged[merged.length - 1] = op;
    } else merged.push(op);
  }
  return merged;
}
