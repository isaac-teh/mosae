export const MAX_UNDERSTAND_ATTEMPTS = 5;

export type TranscriptLine = { startSec: number; endSec: number; text: string };

export type PhotoAnalysis = {
  kind: "photo";
  caption: string;
  subjects: { peopleCount: number; roles: string[]; attributes: string[] }[];
  setting: string;
  activities: string[];
  mood: string;
  shotType: string;
  aesthetics: number;
  keyMomentScore: number;
  tags: string[];
  /** Per-face bounding boxes detected by Gemini Vision. Optional so analyses
   * produced before face tagging (and the many tests that build literals) keep
   * validating; new photos always carry it once deployed. */
  faces?: Face[];
  interactions?: { from: string; to: string; kind: string }[];
};

export type Face = {
  /** Stable across reloads/re-plans: `${shotId}-${index}` within a photo. */
  faceId: string;
  bbox: [number, number, number, number]; // [ymin, xmin, ymax, xmax] normalized 0–1
  confidence: number;
  /** Project-scoped person id assigned by the picker. Two faces share a
   *  characterId only when the user explicitly merges them into one person. */
  characterId?: string;
  name?: string; // denormalized display name (for UI convenience)
  role?: "MAIN" | "SUPPORTING"; // denormalized role for the same reason
  ageBand?: "child" | "teen" | "adult" | "senior";
  appearance?: string;
  prominence?: "primary" | "secondary" | "background";
  expression?: string;
  lookingAtCamera?: boolean;
};

export type VideoShotAnalysis = {
  kind: "video";
  description: string;
  camera: string;
  role: "A_ROLL" | "B_ROLL";
  subjects: string[];
  emotion: string;
  quality: number;
  usable: boolean;
  reason: string;
};

export type ShotAnalysis = PhotoAnalysis | VideoShotAnalysis;

export function analysisSearchText(analysis: ShotAnalysis): string {
  const parts = analysis.kind === "photo"
    ? [analysis.caption, analysis.setting, analysis.mood, analysis.activities.join(", "), analysis.tags.join(", ")]
    : [analysis.description, analysis.emotion, analysis.subjects.join(", ")];
  return parts.filter((part) => part.trim().length > 0).join(". ");
}
