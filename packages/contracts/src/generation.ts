import { z } from "zod";
import { DirectionSettingsSchema, type DirectionSettings } from "./direction.js";
import { TimelineSchema, type Timeline } from "./timeline.js";

/**
 * A generation is one attempt at a film: an accepted proposal plus the
 * direction settings used to compose it, the resulting timeline (if any),
 * and metadata about drops, failures, and render progress.
 */

export const GenerationSchema = z.strictObject({
  schemaVersion: z.literal(1),
  id: z.string().min(1),
  projectId: z.string().min(1),
  proposalId: z.string().min(1),
  parentGenerationId: z.string().min(1).nullable(),
  settings: DirectionSettingsSchema,
  /** The soundtrack attached to the finished film, retained for history even if settings evolve. */
  usedSoundtrackId: z.string().min(1).nullable().optional(),
  /** A concise explanation from the existing compose call for the soundtrack choice. */
  soundtrackReason: z.string().max(200).optional(),
  /** Chosen once at composition time. Unused until layout forms ship, stored so they need no migration. */
  seed: z.string().min(1),
  status: z.enum(["composing", "playable", "rendering", "saved", "failed"]),
  timeline: TimelineSchema.nullable(),
  droppedPicks: z.array(z.string()),
  reasons: z.array(z.string()).optional(),
  failureReasons: z.array(z.string()),
  outputPath: z.string().min(1).nullable(),
  renderProgress: z.number().min(0).max(1),
  /** Milliseconds since epoch when the finished film was saved. */
  savedAt: z.number().int().nonnegative().optional(),
  /** Edit revision captured when the initial cut was published. */
  composedEditRevision: z.number().int().nonnegative().optional(),
  /** Latest edit revision written by the late-video worker itself. */
  lateVideoRevision: z.number().int().nonnegative().optional(),
  /** Server side late-video outcomes, used by the director chat to offer actions. */
  lateVideoEvents: z.array(z.strictObject({
    assetId: z.string().min(1), shotId: z.string().min(1), label: z.string().min(1),
    status: z.enum(["added", "offered", "dismissed"]),
    sourceInSec: z.number().finite().nonnegative(), sourceOutSec: z.number().finite().positive(),
    afterClipId: z.string().nullable(),
    previousOps: z.array(z.unknown()).optional(),
  })).optional(),
});

export type Generation = z.infer<typeof GenerationSchema>;

function describe(issue: { path: PropertyKey[]; message: string }): string {
  const path = issue.path.map(String).join(".");
  return path ? `${path}: ${issue.message}` : issue.message;
}

export function safeParseGeneration(
  value: unknown,
): { ok: true; generation: Generation } | { ok: false; errors: string[] } {
  const result = GenerationSchema.safeParse(value);
  if (result.success) return { ok: true, generation: result.data };
  return { ok: false, errors: result.error.issues.map(describe) };
}
