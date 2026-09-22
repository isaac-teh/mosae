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
