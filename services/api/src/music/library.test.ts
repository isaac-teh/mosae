import { describe, expect, it, vi } from "vitest";
import { ensureLibraryUploaded, libraryPath, loadLibrary, soundtrackCatalog, soundtrackPath } from "./library.js";

describe("music library", () => {
  const tracks = loadLibrary();

  it("loads every track with its measured beats", () => {
    expect(tracks.length).toBeGreaterThanOrEqual(5);
    for (const track of tracks) {
      expect(track.beatsSec.length).toBeGreaterThan(10);
      expect(track.durationSec).toBeGreaterThan(30);
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
    expect(await ensureLibraryUploaded(bucket, tracks)).toBe(tracks.length - 1);
    expect(saved).not.toContain(libraryPath(tracks[0]!));
  });
});
