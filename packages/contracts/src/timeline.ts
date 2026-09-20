import { z } from "zod";

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
});

const VideoSourceSchema = z.strictObject({
  kind: z.literal("video"),
  shotId: z.string().min(1),
  sourceInSec: seconds,
  sourceOutSec: positiveSeconds,
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
   * Ignored for video sources.
   */
  motion: z.strictObject({ kind: z.literal("slow-zoom"), from: positiveSeconds, to: positiveSeconds }).optional(),
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
  schemaVersion: z.literal(1),
  projectId: z.string().min(1),
  mode: z.enum(["memory", "creator"]),
  aspect: z.enum(["16:9", "9:16"]),
  fps: z.literal(30),
  durationSec: positiveSeconds,
  chapters: z.array(ChapterSchema),
  videoClips: z.array(VideoClipSchema).min(1),
  audioClips: z.array(AudioClipSchema),
  captions: z.array(CaptionSchema),
}).superRefine((timeline, context) => {
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
export type AudioClip = z.infer<typeof AudioClipSchema>;
export type Caption = z.infer<typeof CaptionSchema>;
export type Timeline = z.infer<typeof TimelineSchema>;

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
