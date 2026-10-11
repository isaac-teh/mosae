import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The soundtrack library: tracks the user can pick on the directing screen,
 * stored in the bucket under `library/music/`. For development it is six
 * Lyria tracks from the music spike, with beats measured from the audio so a
 * later step can snap cuts to them. Commercial use waits on legal review of
 * the Gemini API terms (docs/research/2026-09-28-lyria-music-spike.md).
 */
export type LibraryTrack = {
  id: string;
  name: string;
  description: string;
  cadence: string;
  file: string;
  durationSec: number;
  bpm: number;
  beatsSec: number[];
  source?: string;
  sourceId?: string;
  artist?: string;
  licence?: string;
  sourceUrl?: string;
  analysis?: MusicAnalysis;
};

export type MusicAnalysis = { durationSec: number; bpm: number; hasPulse: boolean; pulseRegularity: number; beatsSec: number[]; downbeatsSec: number[]; downbeatStrength?: number[]; bars: { startSec: number; endSec: number }[]; energySections: { startSec: number; endSec: number; energy: number; level: "low" | "medium" | "high" }[]; ending: { lastStrongDownbeatSec: number; outroStartSec: number } };

const FIXTURES = fileURLToPath(new URL("../../fixtures/music/", import.meta.url));

export function loadLibrary(directory = FIXTURES): LibraryTrack[] {
  const parsed = JSON.parse(readFileSync(join(directory, "library.json"), "utf8")) as { tracks: LibraryTrack[] };
  const analysisPath = join(directory, "music-analysis.json");
  if (!existsSync(analysisPath)) return parsed.tracks;
  const analyses = JSON.parse(readFileSync(analysisPath, "utf8")) as { tracks: Record<string, MusicAnalysis> };
  return parsed.tracks.map((track) => ({ ...track, analysis: analyses.tracks[track.id] }));
}

/** Where a track lives in the bucket. */
export function libraryPath(track: Pick<LibraryTrack, "file">): string {
  return `library/music/${track.file}`;
}

export type SoundtrackRecommendationInput = {
  projectId: string;
  intent: string;
  cadence: string | null;
  targetDurationSec?: number;
  recentTrackIds?: string[];
  currentProjectTrackId?: string | null;
  targetEnergy?: number;
  musicMood?: string[];
  profile?: AlbumProfile;
};

export type AlbumEvidence = { mood?: string; activities?: string[]; emotion?: string; storyRole?: string; energy?: number; highlightScore?: number; place?: string; context?: string };
export type AlbumProfileInput = { cadence: string; intent?: string; occasion?: string; evidence?: AlbumEvidence[] };
export type AlbumProfile = { cadence: string; keywords: string[]; energy: number; summary: string };
export type SoundtrackShortlistItem = { id: string; name: string; description: string; mood: string; energy: number };

const KEYWORD_FAMILIES: Record<string, string[]> = {
  beach: ["beach", "coast", "ocean", "sea", "island", "summer", "sunny", "water"],
  birthday: ["birthday", "party", "celebration", "joyful", "cake", "big day"],
  gentle: ["gentle", "soft", "calm", "tender", "quiet", "mellow", "peaceful"],
  energetic: ["energetic", "upbeat", "bouncy", "driving", "dance", "excited"],
  trip: ["trip", "travel", "journey", "road", "island", "adventure"],
  warm: ["warm", "nostalgic", "family", "home", "together"],
  playful: ["playful", "fun", "bouncy", "silly", "light"],
  reflective: ["reflective", "thoughtful", "wistful", "memory", "looking back"],
};
const STOP_WORDS = new Set(["with", "from", "that", "this", "your", "their", "about", "into", "over", "under", "while", "when", "where", "during", "film", "album", "story"]);

function words(text: string): string[] {
  return text.toLowerCase().match(/[a-z0-9]+/g)?.filter((word) => word.length > 2 && !STOP_WORDS.has(word)) ?? [];
}

/** Deterministically summarize existing media analysis and the occasion. */
export function buildAlbumProfile(input: AlbumProfileInput): AlbumProfile {
  const evidence = input.evidence ?? [];
  const text = [input.intent, input.occasion, ...evidence.flatMap((item) => [item.mood, item.emotion, item.storyRole, item.place, item.context, ...(item.activities ?? [])])].filter(Boolean).join(" ");
  const keywordSet = new Set(words(text));
  for (const [family, synonyms] of Object.entries(KEYWORD_FAMILIES)) {
    if (synonyms.some((word) => keywordSet.has(word) || text.toLowerCase().includes(word))) for (const synonym of synonyms) keywordSet.add(synonym);
  }
  const energySamples = evidence.flatMap((item) => [item.energy, item.highlightScore]
    .filter((score): score is number => typeof score === "number" && Number.isFinite(score))
    .map((score) => Math.max(0, Math.min(1, score))));
  const inferredEnergy = /dance|run|jump|play|splash|race|cheer|laugh|celebrat|energetic|excited|adventure/i.test(text)
    ? 0.8 : /calm|peace|gentle|quiet|sleep|rest|tender|soft/i.test(text) ? 0.25 : 0.5;
  const energy = energySamples.length ? energySamples.reduce((sum, score) => sum + score, 0) / energySamples.length : inferredEnergy;
  const keywords = [...keywordSet].sort();
  return { cadence: input.cadence, keywords, energy, summary: [input.occasion, input.intent, ...keywords.slice(0, 8)].filter(Boolean).join("; ").slice(0, 300) };
}

function trackEnergy(track: LibraryTrack): number {
  const sections = track.analysis?.energySections ?? [];
  if (!sections.length) return 0.5;
  return sections.reduce((sum, section) => sum + section.energy * Math.max(0.01, section.endSec - section.startSec), 0)
    / sections.reduce((sum, section) => sum + Math.max(0.01, section.endSec - section.startSec), 0);
}

function stableHash(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) hash = Math.imul(hash ^ value.charCodeAt(i), 16777619);
  return hash >>> 0;
}

/** Rank every track against the album's cadence, language and measured energy. */
export function rankSoundtracks(tracks: LibraryTrack[], profile: AlbumProfile, targetDurationSec?: number): SoundtrackShortlistItem[] {
  const ranked = tracks.map((track, index) => {
    const trackText = `${track.name} ${track.description} ${track.cadence}`.toLowerCase();
    const keywordMatches = profile.keywords.reduce((count, keyword) => count + (trackText.includes(keyword) ? 1 : 0), 0);
    const keywordFit = Math.min(0.55, keywordMatches * 0.09);
    const cadenceFit = track.cadence === profile.cadence ? 0.28 : 0;
    const energyFit = -Math.abs(trackEnergy(track) - profile.energy) * 0.75;
    const durationFit = targetDurationSec === undefined ? 0 : (track.durationSec >= targetDurationSec ? 0.12 : -0.12);
    const score = keywordFit + cadenceFit + energyFit + durationFit;
    return { track, index, score };
  }).sort((a, b) => b.score - a.score || a.index - b.index);
  return ranked.map(({ track }) => ({ id: track.id, name: track.name, description: track.description, mood: track.cadence, energy: Number(trackEnergy(track).toFixed(3)) }));
}

export function soundtrackShortlist(tracks: LibraryTrack[], profile: AlbumProfile, targetDurationSec: number | undefined, recentTrackIds: string[], fallbackId: string | null): SoundtrackShortlistItem[] {
  const ranked = rankSoundtracks(tracks, profile, targetDurationSec);
  const recent = new Set(recentTrackIds);
  const shortlist = ranked.filter((track) => !recent.has(track.id)).slice(0, 4);
  const fallback = ranked.find((track) => track.id === fallbackId);
  if (fallback && !shortlist.some(({ id }) => id === fallback.id) && shortlist.length < 5) shortlist.push(fallback);
  return shortlist;
}

export function selectModelSoundtrack(
  soundtrackId: unknown,
  soundtrackReason: unknown,
  shortlist: SoundtrackShortlistItem[],
  fallbackId: string | null,
): { soundtrackId: string | null; soundtrackReason: string } {
  const reason = typeof soundtrackReason === "string" ? soundtrackReason.replace(/[\r\n]+/g, " ").trim().slice(0, 200) : "";
  if (typeof soundtrackId === "string" && shortlist.some(({ id }) => id === soundtrackId) && reason) return { soundtrackId, soundtrackReason: reason };
  return { soundtrackId: fallbackId, soundtrackReason: "Fits the album's mood and pacing." };
}

/** Choose from a short mood/length/energy-ranked list using a repeatable per-project seed. */
export function recommendSoundtrack(tracks: LibraryTrack[], input: SoundtrackRecommendationInput): string | null {
  if (!tracks.length) return null;
  if (input.currentProjectTrackId && tracks.some(({ id }) => id === input.currentProjectTrackId)) return input.currentProjectTrackId;
  const moodWords = (input.musicMood ?? []).map((word) => word.toLowerCase());
  const ranked = input.profile
    ? rankSoundtracks(tracks, input.profile, input.targetDurationSec).map((rankedTrack, index) => ({ track: tracks.find(({ id }) => id === rankedTrack.id)!, index, score: tracks.length - index }))
    : tracks.map((track, index) => {
    const duration = input.targetDurationSec;
    const durationFit = duration === undefined ? 0 : (track.durationSec >= duration ? 0.35 : -0.35) - Math.min(1, Math.abs(track.durationSec - duration) / Math.max(30, duration)) * 0.2;
    const trackWords = `${track.cadence} ${track.name} ${track.description}`.toLowerCase();
    const moodFit = moodWords.length ? moodWords.filter((word) => trackWords.includes(word)).length * 0.08 : 0;
    const energyFit = input.targetEnergy === undefined ? 0 : -Math.abs(trackEnergy(track) - input.targetEnergy) * 0.5;
    const score = (track.cadence === input.cadence ? 1 : 0) + durationFit + moodFit + energyFit;
    return { track, index, score };
    }).sort((a, b) => b.score - a.score || a.index - b.index);
  const recent = new Set(input.recentTrackIds ?? []);
  const available = ranked.filter(({ track }) => !recent.has(track.id));
  const pool = (available.length ? available : ranked).slice(0, Math.min(4, available.length || ranked.length));
  return pool[stableHash(`${input.projectId}\0${input.intent}`) % pool.length]?.track.id ?? null;
}

/**
 * The catalog shown on the directing screen. Tracks matching the suggested
 * cadence come first, so the pre-selected soundtrack fits the suggested tone.
 */
export function soundtrackCatalog(tracks: LibraryTrack[], cadence: string | null, targetDurationSec?: number, suggestedId?: string | null): { id: string; name: string; description: string; mood: string; durationSec: number; suggested: boolean }[] {
  return [...tracks]
    .map((track, index) => ({ track, index }))
    .sort((a, b) => Number(b.track.cadence === cadence) - Number(a.track.cadence === cadence)
      || (targetDurationSec === undefined ? 0 : Math.abs(a.track.durationSec - targetDurationSec) - Math.abs(b.track.durationSec - targetDurationSec)) || a.index - b.index)
    .sort((a, b) => Number(b.track.id === suggestedId) - Number(a.track.id === suggestedId))
    .map(({ track }) => ({ id: track.id, name: track.name, description: track.description, mood: track.cadence, durationSec: track.durationSec, suggested: suggestedId ? track.id === suggestedId : cadence !== null && track.cadence === cadence }));
}

/** A soundtrack id's storage path, or null for an id the library doesn't have. */
export function soundtrackPath(tracks: LibraryTrack[], soundtrackId: string): string | null {
  const track = tracks.find((item) => item.id === soundtrackId);
  return track ? libraryPath(track) : null;
}

type Bucket = {
  file(path: string): { exists(): Promise<[boolean]>; save(data: Buffer, options: { contentType: string }): Promise<unknown> };
};

/** Copies any library track missing from the bucket. Safe to run at every start. */
export async function ensureLibraryUploaded(bucket: Bucket, tracks: LibraryTrack[], directory = FIXTURES): Promise<number> {
  let uploaded = 0;
  for (const track of tracks) {
    const file = bucket.file(libraryPath(track));
    const [exists] = await file.exists();
    if (exists) continue;
    const localFile = join(directory, track.file);
    if (!existsSync(localFile)) continue;
    await file.save(readFileSync(localFile), { contentType: "audio/mpeg" });
    uploaded++;
  }
  return uploaded;
}
