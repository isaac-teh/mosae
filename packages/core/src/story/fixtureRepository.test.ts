import { describe, expect, it, vi } from "vitest";
import { createFixtureStoryRepository } from "./fixtureRepository";

describe("fixture story repository", () => {
  it("continues the persisted editor revision after a repository reload", async () => {
    const storage = new Map<string, string>();
    vi.stubGlobal("window", { localStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    } });
    try {
      const beforeReload = createFixtureStoryRepository({ delayMs: 0 });
      await beforeReload.saveEdits("fixture", "demo-film", 1, [{ op: "setSoundtrack", soundtrackId: "st-ukulele" }]);
      const afterReload = createFixtureStoryRepository({ delayMs: 0 });
      expect((await afterReload.getEdits("fixture", "demo-film")).revision).toBe(1);
      await expect(afterReload.saveEdits("fixture", "demo-film", 2, [])).resolves.toMatchObject({ revision: 2, ops: [] });
    } finally { vi.unstubAllGlobals(); }
  });
  it("provides a collage editor sample and same-event alternatives", async () => {
    const repo = createFixtureStoryRepository({ delayMs: 0 });
    const film = await repo.getFilmTimeline("fixture", "demo-film");
    expect(film.timeline.videoClips.some((clip) => "kind" in clip)).toBe(true);
    expect((await repo.getPlan("demo")).moments[0]).toMatchObject({ id: "moment-1", shotId: "fixture-1" });
    await expect(repo.getAlternatives("demo", "moment-1")).resolves.toEqual([{ shotId: "fixture-alt", thumbnailUrl: "demo:timeline-strawberry", kind: "photo" }]);
  });

  it("provides a playable editor timeline and local image keys", async () => {
    const { timeline, sources } = await createFixtureStoryRepository({ delayMs: 0 }).getFilmTimeline("fixture", "demo-film");
    expect(timeline.videoClips).toHaveLength(7);
    expect(timeline.chapters.map((chapter) => chapter.title)).toEqual(["Opening", "Candid moments", "Closing"]);
    expect(Object.keys(sources)).toHaveLength(6);
    expect(Object.values(sources).every((value) => value.startsWith("demo:"))).toBe(true);
  });

  it("creates the Figma example plan", async () => {
    const repo = createFixtureStoryRepository({ delayMs: 0 });
    const { planId } = await repo.createPlan("our trip", ["p1"]);
    const plan = await repo.getPlan(planId);
    expect(plan.title).toContain("7th Birthday in Japan");
    expect(plan.intro.headline).toBe("We found 32 moments that tell your story.");
    expect(plan.chapters).toHaveLength(4);
    for (const chapter of plan.chapters) for (const id of chapter.momentIds) expect(plan.moments.some((m) => m.id === id)).toBe(true);
  });

  it("toggles selection and favorite without touching other moments", async () => {
    const repo = createFixtureStoryRepository({ delayMs: 0 });
    const plan = await repo.getPlan("demo");
    const [first, second] = plan.moments;
    const updated = await repo.setMomentSelected("demo", first.id, false);
    expect(updated.moments.find((m) => m.id === first.id)?.selected).toBe(false);
    expect(updated.moments.find((m) => m.id === second.id)?.selected).toBe(second.selected);
    const faved = await repo.setMomentFavorite("demo", first.id, true);
    expect(faved.moments.find((m) => m.id === first.id)?.favorite).toBe(true);
  });

  it("keeps state per repository instance", async () => {
    const a = createFixtureStoryRepository({ delayMs: 0 });
    const b = createFixtureStoryRepository({ delayMs: 0 });
    const id = (await a.getPlan("demo")).moments[0].id;
    await a.setMomentSelected("demo", id, false);
    expect((await b.getPlan("demo")).moments[0].selected).toBe(true);
  });

  it("only makes the film option available", async () => {
    const repo = createFixtureStoryRepository({ delayMs: 0 });
    expect(await repo.chooseCreateOption("demo", "film")).toEqual({ available: true });
    expect(await repo.chooseCreateOption("demo", "album")).toEqual({ available: false });
  });

  it("uses the Figma direction defaults", async () => {
    const options = await createFixtureStoryRepository({ delayMs: 0 }).getDirectionOptions("demo");
    expect(options.note).toBe("Make it feel exciting and warm. Start with us arriving in Tokyo, build up to the birthday cake celebration, and finish with our quiet Kyoto stroll.");
    expect(options.cadences[0]).toMatchObject({ name: "Warm & Nostalgic", description: "Soft acoustic guitar • Kodachrome warmth" });
    expect(options.soundtracks[0]).toMatchObject({ name: "Okinawa Ukulele & String Trio", description: "Acoustic Heirloom • 2:14 min", mood: "Acoustic Heirloom", durationSec: 134 });
    expect(options.recommendedDuration).toBe("2m");
  });

  it("directs, revises and saves a film", async () => {
    const repo = createFixtureStoryRepository({ delayMs: 0 });
    const options = await repo.getDirectionOptions("demo");
    const { filmId } = await repo.directFilm("demo", { note: options.note, cadenceId: options.cadences[0].id, soundtrackId: options.soundtracks[0].id, durationId: "2m" });
    const film = await repo.getFilm(filmId);
    expect(film.version).toBe(1);
    expect(film.durationSec).toBe(130);
    const revised = await repo.reviseFilm(filmId, "More upbeat music");
    expect(revised.version).toBe(2);
    expect((await repo.getFilm(filmId)).version).toBe(2);
    expect(await repo.saveFilm(filmId)).toEqual({ downloadKey: "film" });
  });

  it("rejects unknown ids", async () => {
    const repo = createFixtureStoryRepository({ delayMs: 0 });
    await expect(repo.getFilm("nope")).rejects.toThrow("Unknown film nope");
  });
});
