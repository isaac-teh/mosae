import { z } from "zod";
import { CollageSpecSchema } from "./collage.js";

/**
 * The only editing contract between directing and rendering.
 * Source ids resolve through project records to immutable asset generations;
 * the director never supplies storage URLs.
 *
 * This is the media understanding spec's Timeline interface minus `snapshotId`,
 * which the thin slice omits because it has no snapshots collection.
 */

const seconds = z.number().finite().nonnegative();
const positiveSeconds = z.number().finite().positive();

export const ChapterSchema = z.strictObject({
  title: z.string().min(1),
  startSec: seconds,
  durationSec: positiveSeconds.optional(),
});

const VideoSourceSchema = z.strictObject({
  kind: z.literal("video"),
  shotId: z.string().min(1),
  sourceInSec: seconds,
  sourceOutSec: positiveSeconds,
  sourceDurationSec: positiveSeconds.optional(),
});

const PhotoSourceSchema = z.strictObject({
  kind: z.literal("photo"),
  shotId: z.string().min(1),
});

export const TransitionSchema = z.strictObject({
  kind: z.enum(["cut", "crossfade", "dip"]),
  durationSec: seconds,
});

export const CropSchema = z.strictObject({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  w: positiveSeconds.max(1),
  h: positiveSeconds.max(1),
});

export const VideoClipSchema = z.strictObject({
  id: z.string().min(1),
  source: z.discriminatedUnion("kind", [VideoSourceSchema, PhotoSourceSchema]),
  startSec: seconds,
  durationSec: positiveSeconds,
  transitionIn: TransitionSchema,
  crop: CropSchema.optional(),
  /**
   * Slow zoom for stills. A photo-only stretch reads as a slideshow without it.
   * Ignored for video sources. When `center` is present the zoom/pan anchors on
   * that normalized point (cx, cy in 0–1) instead of the frame midpoint — this
   * is how a focus character's face drives Ken Burns. Absent center keeps the
   * plain geometry behaviour and the field stays byte-identical to older films.
   */
  motion: z.strictObject({ kind: z.literal("slow-zoom"), from: positiveSeconds, to: positiveSeconds, center: z.object({ cx: z.number().min(0).max(1), cy: z.number().min(0).max(1) }).optional() }).optional(),
});

export const CollageClipSchema = z.strictObject({
  kind: z.literal("collage"),
  clipId: z.string().min(1),
  startSec: seconds,
  durationSec: positiveSeconds,
  chapterId: z.string().optional(),
  transitionIn: TransitionSchema.optional(),
  spec: CollageSpecSchema,
}).superRefine((clip, context) => {
  if (clip.spec.slots.some((slot) => !slot.shotId)) {
    context.addIssue({ code: "custom", path: ["spec", "slots"], message: "timeline collage slots require shotId" });
  }
  if (Math.abs(clip.spec.durationSec - clip.durationSec) > 1e-6) {
    context.addIssue({ code: "custom", path: ["spec", "durationSec"], message: "collage duration must match clip duration" });
  }
});

const AssetAudioSourceSchema = z.strictObject({
  kind: z.literal("asset"),
  assetId: z.string().min(1),
  sourceInSec: seconds,
  sourceOutSec: positiveSeconds,
  transcriptWordIds: z.array(z.string().min(1)).optional(),
});

const SoundtrackAudioSourceSchema = z.strictObject({
  kind: z.literal("soundtrack"),
  soundtrackId: z.string().min(1),
  sourceInSec: seconds,
  sourceOutSec: positiveSeconds,
});

export const AudioClipSchema = z.strictObject({
  id: z.string().min(1),
  source: z.discriminatedUnion("kind", [AssetAudioSourceSchema, SoundtrackAudioSourceSchema]),
  role: z.enum(["speech", "ambient", "music"]),
  startSec: seconds,
  gainDb: z.number().finite().min(-60).max(12),
  fadeInSec: seconds,
  fadeOutSec: seconds,
});

export const CaptionSchema = z.strictObject({
  text: z.string().min(1),
  startSec: seconds,
  endSec: positiveSeconds,
});

const TIMELINE_TOLERANCE_SEC = 1e-6;

export const TimelineSchema = z.strictObject({
  schemaVersion: z.union([z.literal(1), z.literal(2)]),
  projectId: z.string().min(1),
  mode: z.enum(["memory", "creator"]),
  aspect: z.enum(["16:9", "9:16"]),
  fps: z.literal(30),
  durationSec: positiveSeconds,
  chapters: z.array(ChapterSchema),
  videoClips: z.array(z.union([VideoClipSchema, CollageClipSchema])).min(1),
  audioClips: z.array(AudioClipSchema),
  captions: z.array(CaptionSchema),
}).superRefine((timeline, context) => {
  if (timeline.schemaVersion === 1) {
    timeline.videoClips.forEach((clip, index) => {
      if ("kind" in clip) context.addIssue({ code: "custom", path: ["videoClips", index], message: "collage clips require schemaVersion 2" });
    });
  }
  const exceedsDuration = (endSec: number) => endSec - timeline.durationSec > TIMELINE_TOLERANCE_SEC;

  timeline.videoClips.forEach((clip, index) => {
    if (exceedsDuration(clip.startSec + clip.durationSec)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["videoClips", index, "durationSec"], message: "clip end exceeds durationSec" });
    }
  });

  timeline.audioClips.forEach((clip, index) => {
    if (exceedsDuration(clip.startSec + clip.source.sourceOutSec - clip.source.sourceInSec)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["audioClips", index, "source", "sourceOutSec"], message: "clip end exceeds durationSec" });
    }
  });

  timeline.captions.forEach((caption, index) => {
    if (exceedsDuration(caption.endSec)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["captions", index, "endSec"], message: "caption end exceeds durationSec" });
    }
  });

  timeline.chapters.forEach((chapter, index) => {
    if (chapter.startSec >= timeline.durationSec) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["chapters", index, "startSec"], message: "chapter start must be before durationSec" });
    }
  });
});

export type Chapter = z.infer<typeof ChapterSchema>;
export type VideoClip = z.infer<typeof VideoClipSchema>;
export type CollageClip = z.infer<typeof CollageClipSchema>;
export type AudioClip = z.infer<typeof AudioClipSchema>;
export type Caption = z.infer<typeof CaptionSchema>;
export type Timeline = z.infer<typeof TimelineSchema>;

export function collageShotIds(timeline: Timeline): string[] {
  return timeline.videoClips.flatMap((clip) => "kind" in clip ? clip.spec.slots.flatMap((slot) => slot.shotId ? [slot.shotId] : []) : []);
}

export type ParseResult<T> = { ok: true; timeline: T } | { ok: false; errors: string[] };

function describe(issue: { path: PropertyKey[]; message: string }): string {
  const path = issue.path.map(String).join(".");
  return path ? `${path}: ${issue.message}` : issue.message;
}

export function safeParseTimeline(value: unknown): ParseResult<Timeline> {
  const result = TimelineSchema.safeParse(value);
  if (result.success) return { ok: true, timeline: result.data };
  return { ok: false, errors: result.error.issues.map(describe) };
}

export function parseTimeline(value: unknown): Timeline {
  const result = safeParseTimeline(value);
  if (!result.ok) throw new Error(`invalid timeline: ${result.errors.join("; ")}`);
  return result.timeline;
}
