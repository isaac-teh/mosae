import { describe, expect, it, vi } from "vitest";
import { ensureLibraryUploaded, libraryPath, loadLibrary, soundtrackCatalog, soundtrackPath } from "./library.js";

describe("music library", () => {
  const tracks = loadLibrary();

  it("loads every track with its measured beats", () => {
    expect(tracks).toHaveLength(38);
    expect(new Set(tracks.map((track) => track.id)).size).toBe(tracks.length);
    for (const track of tracks) {
      expect(track.beatsSec.length).toBeGreaterThan(10);
      expect(track.durationSec).toBeGreaterThan(30);
      expect(["tender", "reflective", "playful", "energetic", "celebratory"]).toContain(track.cadence);
      expect(track.beatsSec.every((beat, index, values) => beat >= 0 && beat < track.durationSec && (!index || beat > values[index - 1]!))).toBe(true);
      if (track.id.startsWith("pixabay-")) expect(track).toMatchObject({ source: "Pixabay", licence: "Pixabay Content License", sourceId: track.id.slice("pixabay-".length) });
    }
  });

  it("puts tracks matching the suggested cadence first", () => {
    const catalog = soundtrackCatalog(tracks, "playful");
    expect(catalog[0]!.id).toBe("lyria-playful");
    expect(catalog[0]).toMatchObject({ mood: "playful", suggested: true, durationSec: tracks.find((track) => track.id === catalog[0]!.id)!.durationSec });
    expect(catalog.find((track) => track.id === "lyria-tender")?.suggested).toBe(false);
    expect(catalog).toHaveLength(tracks.length);
  });

  it("keeps library order when there is no suggestion", () => {
    expect(soundtrackCatalog(tracks, null).map((t) => t.id)).toEqual(tracks.map((t) => t.id));
  });

  it("maps an id to its bucket path, and an unknown id to null", () => {
    expect(soundtrackPath(tracks, "lyria-tender")).toBe("library/music/lyria-tender.mp3");
    expect(soundtrackPath(tracks, "soundtrack-dusk")).toBeNull();
  });

  it("uploads only the tracks the bucket is missing", async () => {
    const saved: string[] = [];
    const bucket = {
      file: (path: string) => ({
        exists: async () => [path === libraryPath(tracks[0]!)] as [boolean],
        save: vi.fn(async () => { saved.push(path); }),
      }),
    };
    expect(await ensureLibraryUploaded(bucket, tracks, "/tmp/nonexistent-music-library/")).toBe(0);
    expect(await ensureLibraryUploaded(bucket, tracks)).toBe(5);
    expect(saved).not.toContain(libraryPath(tracks[0]!));
  });
});
