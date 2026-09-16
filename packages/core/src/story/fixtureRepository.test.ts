import { describe, expect, it } from "vitest";
import { createFixtureStoryRepository } from "./fixtureRepository";

describe("fixture story repository", () => {
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
