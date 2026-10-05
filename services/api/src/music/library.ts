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
};

const FIXTURES = fileURLToPath(new URL("../../fixtures/music/", import.meta.url));

export function loadLibrary(directory = FIXTURES): LibraryTrack[] {
  const parsed = JSON.parse(readFileSync(join(directory, "library.json"), "utf8")) as { tracks: LibraryTrack[] };
  return parsed.tracks;
}

/** Where a track lives in the bucket. */
export function libraryPath(track: Pick<LibraryTrack, "file">): string {
  return `library/music/${track.file}`;
}

/**
 * The catalog shown on the directing screen. Tracks matching the suggested
 * cadence come first, so the pre-selected soundtrack fits the suggested tone.
 */
export function soundtrackCatalog(tracks: LibraryTrack[], cadence: string | null): { id: string; name: string; description: string; mood: string; durationSec: number; suggested: boolean }[] {
  return [...tracks]
    .map((track, index) => ({ track, index }))
    .sort((a, b) => Number(b.track.cadence === cadence) - Number(a.track.cadence === cadence) || a.index - b.index)
    .map(({ track }) => ({ id: track.id, name: track.name, description: track.description, mood: track.cadence, durationSec: track.durationSec, suggested: cadence !== null && track.cadence === cadence }));
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
