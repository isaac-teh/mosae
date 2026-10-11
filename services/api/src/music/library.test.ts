import { describe, expect, it, vi } from "vitest";
import { buildAlbumProfile, ensureLibraryUploaded, libraryPath, loadLibrary, recommendSoundtrack, rankSoundtracks, selectModelSoundtrack, soundtrackCatalog, soundtrackPath } from "./library.js";

describe("music library", () => {
  const tracks = loadLibrary();

  it("loads every track with its measured beats", () => {
    expect(tracks).toHaveLength(38);
    expect(new Set(tracks.map((track) => track.id)).size).toBe(tracks.length);
    for (const track of tracks) {
      expect(track.beatsSec.length).toBeGreaterThan(10);
      expect(track.analysis).toMatchObject({ hasPulse: true, ending: { lastStrongDownbeatSec: expect.any(Number), outroStartSec: expect.any(Number) } });
      expect(track.analysis?.downbeatsSec.length).toBeGreaterThan(0);
      expect(track.analysis?.bars.length).toBeGreaterThan(0);
      expect(track.analysis?.energySections.length).toBeGreaterThan(0);
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

  it("keeps mood first and prefers the matching mood with the closest film length", () => {
    const options = [
      { ...tracks[0]!, id: "short-tender", cadence: "tender", durationSec: 30 },
      { ...tracks[0]!, id: "near-tender", cadence: "tender", durationSec: 60 },
      { ...tracks[0]!, id: "near-playful", cadence: "playful", durationSec: 60 },
    ];
    expect(soundtrackCatalog(options, "tender", 58).map(({ id }) => id)).toEqual(["near-tender", "short-tender", "near-playful"]);
  });

  it("keeps library order when there is no suggestion", () => {
    expect(soundtrackCatalog(tracks, null).map((t) => t.id)).toEqual(tracks.map((t) => t.id));
  });

  it("varies stable seeded suggestions across projects with identical settings", () => {
    const picks = new Set(Array.from({ length: 20 }, (_, index) => recommendSoundtrack(tracks, {
      projectId: `project-${index}`, intent: "family vacation", cadence: "reflective", targetDurationSec: 120,
    })));
    expect(picks.size).toBeGreaterThan(1);
    expect(recommendSoundtrack(tracks, { projectId: "same-project", intent: "family vacation", cadence: "reflective", targetDurationSec: 120 }))
      .toBe(recommendSoundtrack(tracks, { projectId: "same-project", intent: "family vacation", cadence: "reflective", targetDurationSec: 120 }));
  });

  it("avoids recently used tracks and falls back when every match was recent", () => {
    const options = tracks.filter((track) => track.cadence === "tender").slice(0, 2);
    const pick = recommendSoundtrack(options, { projectId: "p", intent: "quiet", cadence: "tender", targetDurationSec: 100, recentTrackIds: [options[0]!.id] });
    expect(pick).toBe(options[1]!.id);
    expect(recommendSoundtrack(options.slice(0, 1), { projectId: "p", intent: "quiet", cadence: "tender", targetDurationSec: 100, recentTrackIds: [options[0]!.id] }))
      .toBe(options[0]!.id);
  });

  it("puts its chosen track first and preserves the current project's soundtrack", () => {
    const chosen = recommendSoundtrack(tracks, { projectId: "p", intent: "trip", cadence: "playful", currentProjectTrackId: "lyria-tender" });
    expect(chosen).toBe("lyria-tender");
    const catalog = soundtrackCatalog(tracks, "playful", 120, chosen);
    expect(catalog[0]).toMatchObject({ id: chosen, suggested: true });
    expect(catalog.filter(({ suggested }) => suggested)).toHaveLength(1);
  });

  it("scores a high-energy beach album differently from a gentle birthday album", () => {
    const energetic = buildAlbumProfile({ cadence: "energetic", intent: "summer trip", occasion: "beach holiday", evidence: [{ mood: "excited", activities: ["swimming", "running"], place: "beach", energy: 0.9, storyRole: "peak" }] });
    const gentle = buildAlbumProfile({ cadence: "tender", intent: "birthday with grandma", occasion: "birthday", evidence: [{ mood: "gentle", activities: ["cake", "hugging"], place: "home", energy: 0.2, emotion: "tender", storyRole: "closer" }] });
    const beachFirst = rankSoundtracks(tracks, energetic, 120)[0]!.id;
    const birthdayFirst = rankSoundtracks(tracks, gentle, 120)[0]!.id;
    expect(beachFirst).not.toBe(birthdayFirst);
  });

  it("falls back to the seeded track when Gemini chooses outside the shortlist", () => {
    const shortlist = tracks.slice(0, 4).map((track) => ({ id: track.id, name: track.name, description: track.description, mood: track.cadence, energy: 0.5 }));
    expect(selectModelSoundtrack("not-in-shortlist", "wrong", shortlist, tracks[1]!.id)).toEqual({ soundtrackId: tracks[1]!.id, soundtrackReason: "Fits the album's mood and pacing." });
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
