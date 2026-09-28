import { z } from "zod";
import { CollageSpecSchema } from "./collage.js";
import { safeParseTimeline, type AudioClip, type Caption, type CollageClip, type Timeline, type VideoClip } from "./timeline.js";

const clipId = z.string().min(1);
const shotId = z.string().min(1);
const seconds = z.number().finite().nonnegative();
const positiveSeconds = z.number().finite().positive();

export const EditOpSchema = z.discriminatedUnion("op", [
  z.strictObject({ op: z.literal("swapShot"), clipId, shotId }),
  z.strictObject({ op: z.literal("trim"), clipId, inSec: seconds, outSec: positiveSeconds }),
  z.strictObject({ op: z.literal("setPhotoDuration"), clipId, sec: positiveSeconds }),
  z.strictObject({ op: z.literal("move"), clipId, toIndex: z.number().int().nonnegative() }),
  z.strictObject({ op: z.literal("remove"), clipId }),
  z.strictObject({ op: z.literal("add"), shotId, kind: z.enum(["photo", "video"]), afterClipId: clipId.nullable(), durationSec: positiveSeconds, sourceInSec: seconds.optional(), sourceOutSec: positiveSeconds.optional() }),
  z.strictObject({ op: z.literal("setCollageLayout"), clipId, layoutId: z.string().min(1) }),
  z.strictObject({ op: z.literal("setCollageMotion"), clipId, motionId: z.string().min(1) }),
  z.strictObject({ op: z.literal("setCollageEffect"), clipId, effectId: z.string().min(1).nullable() }),
  z.strictObject({ op: z.literal("replaceCollageSlot"), clipId, slotId: z.string().min(1), shotId, kind: z.enum(["photo", "video"]) }),
  z.strictObject({ op: z.literal("splitCollage"), clipId }),
  z.strictObject({ op: z.literal("setSoundtrack"), soundtrackId: z.string().min(1) }),
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

function buildTimeline(firstCut: Timeline, work: WorkClip[], soundtrackId?: string): Timeline {
  let cursor = 0;
  const videoClips = work.map((item) => {
    const clip = { ...item.clip, startSec: cursor };
    cursor += clip.durationSec;
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
  const audioClips: AudioClip[] = firstCut.audioClips.flatMap((track) => {
    if (track.source.kind !== "soundtrack") return [];
    return [{ ...track, startSec: 0, source: { ...track.source, soundtrackId: soundtrackId ?? track.source.soundtrackId, sourceInSec: 0, sourceOutSec: durationSec }, fadeOutSec: Math.min(track.fadeOutSec, durationSec) }];
  });
  if (soundtrackId && !audioClips.some((track) => track.source.kind === "soundtrack")) {
    audioClips.push({ id: "editor-soundtrack", source: { kind: "soundtrack", soundtrackId, sourceInSec: 0, sourceOutSec: durationSec }, role: "music", startSec: 0, gainDb: -18, fadeInSec: 0.5, fadeOutSec: Math.min(0.5, durationSec) });
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
    ? [[idOf(item.clip), { inSec: item.clip.source.sourceInSec, outSec: item.clip.source.sourceOutSec }] as const]
    : []));
  let soundtrackId: string | undefined;
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
        item.clip = { ...item.clip, source: { ...item.clip.source, shotId: op.shotId } } as VideoClip;
        break;
      }
      case "trim": {
        if (!item || !("source" in item.clip) || item.clip.source.kind !== "video") return fail("trim requires a video clip");
        if (op.outSec - op.inSec < 1) return fail("trim requires at least one second");
        const bounds = videoBounds.get(op.clipId) ?? { inSec: item.clip.source.sourceInSec, outSec: item.clip.source.sourceOutSec };
        if (op.inSec < bounds.inSec || op.outSec > bounds.outSec) return fail("trim must stay within the source clip");
        item.clip = { ...item.clip, durationSec: op.outSec - op.inSec, source: { ...item.clip.source, sourceInSec: op.inSec, sourceOutSec: op.outSec } };
        break;
      }
      case "setPhotoDuration": {
        if (!item || !("source" in item.clip) || item.clip.source.kind !== "photo") return fail("setPhotoDuration requires a photo clip");
        if (op.sec < 2 || op.sec > 6) return fail("photo duration must be 2–6 seconds");
        item.clip = { ...item.clip, durationSec: op.sec };
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
      case "add": {
        const afterIndex = op.afterClipId === null ? -1 : work.findIndex((entry) => idOf(entry.clip) === op.afterClipId);
        if (op.afterClipId !== null && afterIndex < 0) return fail(`unknown clipId: ${op.afterClipId}`);
        if (op.kind === "video" && (op.sourceInSec === undefined || op.sourceOutSec === undefined || op.sourceOutSec - op.sourceInSec < op.durationSec)) return fail("video add requires a source range covering its duration");
        const count = ops.slice(0, opIndex + 1).filter((prior) => prior.op === "add" && prior.shotId === op.shotId).length;
        const id = `add:${op.shotId}:${count}`;
        if (op.kind === "video") videoBounds.set(id, { inSec: op.sourceInSec!, outSec: op.sourceOutSec! });
        const source = op.kind === "photo" ? { kind: "photo" as const, shotId: op.shotId } : { kind: "video" as const, shotId: op.shotId, sourceInSec: op.sourceInSec!, sourceOutSec: op.sourceOutSec! };
        const chapter = work[afterIndex]?.chapter ?? work[0]?.chapter ?? 0;
        work.splice(afterIndex + 1, 0, { clip: { id, source, startSec: 0, durationSec: op.durationSec, transitionIn: { kind: "cut", durationSec: 0 } }, chapter, captions: [], audio: [] });
        break;
      }
      case "setCollageLayout":
      case "setCollageMotion":
      case "setCollageEffect":
      case "replaceCollageSlot": {
        if (!item || !("kind" in item.clip)) return fail(`${op.op} requires a collage clip`);
        const spec = item.clip.spec;
        if (op.op === "replaceCollageSlot" && !spec.slots.some((slot) => slot.slotId === op.slotId)) return fail(`unknown slotId: ${op.slotId}`);
        const next = op.op === "setCollageLayout" ? { ...spec, layoutId: op.layoutId }
          : op.op === "setCollageMotion" ? { ...spec, motionId: op.motionId }
          : op.op === "setCollageEffect" ? { ...spec, effectId: op.effectId }
          : { ...spec, slots: spec.slots.map((slot) => slot.slotId === op.slotId ? { ...slot, shotId: op.shotId, kind: op.kind } : slot) };
        const changed = collageWithSpec(item.clip, next as CollageClip["spec"]);
        if (typeof changed === "string") return fail(changed);
        item.clip = changed;
        break;
      }
      case "splitCollage": {
        if (!item || !("kind" in item.clip)) return fail("splitCollage requires a collage clip");
        const collage = item.clip;
        const each = collage.durationSec / collage.spec.slots.length;
        const split = collage.spec.slots.map((slot): WorkClip => ({
          clip: { id: `${collage.clipId}:${slot.slotId}`, source: { kind: "photo", shotId: slot.shotId! }, startSec: 0, durationSec: each, transitionIn: { kind: "cut", durationSec: 0 } },
          chapter: item.chapter, captions: [], audio: [],
        }));
        work.splice(index, 1, ...split);
        break;
      }
      case "setSoundtrack": soundtrackId = op.soundtrackId; break;
    }
    const result = safeParseTimeline(buildTimeline(base.timeline, work, soundtrackId));
    if (!result.ok) return fail(result.errors.join("; "));
  }
  const result = safeParseTimeline(buildTimeline(base.timeline, work, soundtrackId));
  if (!result.ok) return { ok: false, error: result.errors.join("; "), opIndex: Math.max(0, ops.length - 1) };
  return { ok: true, timeline: result.timeline, leftOutShotIds };
}

export function mergeOps(ops: EditOp[]): EditOp[] {
  const merged: EditOp[] = [];
  for (const op of ops) {
    const previous = merged.at(-1);
    if (previous && (op.op === "trim" || op.op === "setPhotoDuration" || op.op === "move") && previous.op === op.op && previous.clipId === op.clipId) {
      merged[merged.length - 1] = op;
    } else merged.push(op);
  }
  return merged;
}
