import { z } from "zod";

/**
 * How the film should feel, saved separately from the StoryIntent, which says
 * what matters. Changing music or cadence preserves the accepted story;
 * changing story focus returns the user to proposal review.
 *
 * Cadence ids double as the hold-length presets the composer uses, so the
 * catalog lives beside the schema rather than in the API.
 */

export const CADENCES = [
  { id: "tender", name: "Tender", description: "Long holds, room to feel each moment." },
  { id: "reflective", name: "Reflective", description: "Unhurried, with quiet pauses between beats." },
  { id: "playful", name: "Playful", description: "Quick, light cuts that keep moving." },
  { id: "energetic", name: "Energetic", description: "Fast cuts that push the story forward." },
  { id: "celebratory", name: "Celebratory", description: "Bright and buoyant, built around the peaks." },
] as const;

export const DURATION_SECONDS = { "30s": 30, "1m": 60, "2m": 120, "3m": 180, "4m": 240, "5m": 300 } as const;

const cadenceIds = CADENCES.map((cadence) => cadence.id) as [string, ...string[]];
const durationIds = Object.keys(DURATION_SECONDS) as [string, ...string[]];

export const DirectionSettingsSchema = z.strictObject({
  schemaVersion: z.literal(1),
  id: z.string().min(1),
  projectId: z.string().min(1),
  version: z.number().int().positive(),
  note: z.string().max(2000),
  /** family clears person focus; omitted preserves legacy cast/proposal focus. */
  focus: z.string().min(1).optional(),
  cadenceId: z.enum(cadenceIds),
  /** null means let the director choose a soundtrack. */
  soundtrackId: z.string().min(1).nullable(),
  /** null means let the director choose a length. */
  durationId: z.enum(durationIds).nullable(),
  aspect: z.enum(["16:9", "9:16"]),
  captions: z.boolean().default(false),
  collageAmount: z.enum(["few", "lots", "none"]).default("few"),
  motionFeel: z.enum(["calm", "playful"]).default("calm"),
});

export type CadenceId = (typeof CADENCES)[number]["id"];
export type DurationId = keyof typeof DURATION_SECONDS;
export type DirectionSettings = z.infer<typeof DirectionSettingsSchema>;

function describe(issue: { path: PropertyKey[]; message: string }): string {
  const path = issue.path.map(String).join(".");
  return path ? `${path}: ${issue.message}` : issue.message;
}

export function safeParseDirectionSettings(
  value: unknown,
): { ok: true; settings: DirectionSettings } | { ok: false; errors: string[] } {
  const result = DirectionSettingsSchema.safeParse(value);
  if (result.success) return { ok: true, settings: result.data };
  return { ok: false, errors: result.error.issues.map(describe) };
}

/** Default photo hold in seconds; the spec's 3s. */
export const DEFAULT_HOLD_SEC = 3;

/** Usable photos × 3s, snapped down to a tier, never below 30s. */
export function recommendDuration(usablePhotoCount: number): DurationId {
  const seconds = usablePhotoCount * DEFAULT_HOLD_SEC;
  const tiers = (Object.entries(DURATION_SECONDS) as [DurationId, number][]).sort((a, b) => a[1] - b[1]);
  let pick: DurationId = "30s";
  for (const [id, tierSec] of tiers) if (tierSec <= seconds) pick = id;
  return pick;
}
