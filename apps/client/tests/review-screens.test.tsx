import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFixtureStoryRepository } from "../../../packages/core/src/story/fixtureRepository";
import type { DirectionOptions, Film, StoryPlan } from "@mosae/core";

const boundary = vi.hoisted(() => ({ repository: {} as any, apiRepository: {} as any, apiRepositories: new Map<string, any>(), params: {} as any, navigate: vi.fn(), setParams: vi.fn() }));
vi.mock("@mosae/core", () => ({
  getStoryRepository: () => boundary.repository,
  createFixtureStoryRepository: () => new Proxy({}, { get: (_, key) => boundary.repository[key] }),
  createApiStoryRepository: ({ projectId }: { projectId: string }) => {
    const repository = boundary.apiRepositories.get(projectId);
    if (!repository) throw new Error(`Wrong project ${projectId}`);
    return repository;
  },
}));
vi.mock("expo-router", () => ({ useLocalSearchParams: () => boundary.params, useRouter: () => ({ navigate: boundary.navigate, setParams: boundary.setParams }) }));
vi.mock("@/lib/useStepBack", () => ({ useStepBack: () => vi.fn() }));
vi.mock("@/lib/demoAssets", () => ({ demoImage: (key: string) => {
  if (key.includes(":")) throw new Error("URI used as demo key");
  return 1;
} }));
vi.mock("@/components/sceneIcons", () => ({
  ArchivalSparkleIcon: () => null, AddPhotoIcon: () => null, AddMoreIcon: () => null, ContinueArrowIcon: () => null, HeartIcon: () => null,
  CreateAlbumIcon: () => null, CreateArrowIcon: () => null, CreateBackIcon: () => null, CreateCakeIcon: () => null, CreateCheckIcon: () => null,
  CreateFilmIcon: () => null, CreateHelpIcon: () => null, CreateMusicIcon: () => null, CreatePhotosIcon: () => null, CreateShareIcon: () => null,
  CreateTimerIcon: () => null, CreateVaultIcon: () => null,
}));
vi.mock("@/components/icons", () => ({ CheckIcon: () => null }));
vi.mock("@/components/StepHeader", () => ({ StepHeader: () => null }));
vi.mock("@/components/BottomTabBar", () => ({ BottomTabBar: () => null }));
vi.mock("@/components/FilmPlayer", () => ({ FilmPlayer: ({ poster }: { poster: { uri?: string } | string }) => React.createElement("div", { "data-testid": "film-player", "data-poster": typeof poster === "string" ? poster : poster.uri }) }));
vi.mock("@/components/PrimaryButton", () => ({ PrimaryButton: ({ label, onPress }: { label: string; onPress: () => void }) => React.createElement("button", { "aria-label": label, onClick: onPress }, label) }));
vi.mock("@/lib/storyImage", () => ({ storyImage: (key: string) => ({ uri: key }) }));
vi.mock("expo-asset", () => ({ Asset: { fromModule: () => ({ uri: "film.mp4" }) } }));
vi.mock("react-native-svg", () => ({ default: () => null, Path: () => null, Circle: () => null, Rect: () => null }));
vi.mock("react-native", () => {
  const element = (tag: string) => ({ children, onPress, onChangeText, numberOfLines, accessibilityLabel, source, resizeMode, keyboardShouldPersistTaps, placeholderTextColor, contentContainerClassName, multiline, textAlignVertical, horizontal, showsHorizontalScrollIndicator, showsVerticalScrollIndicator, ...props }: any) =>
    React.createElement(tag, { ...props, onClick: onPress, onInput: onChangeText ? (event: any) => onChangeText(event.target.value) : undefined, ...(tag === "img" ? { src: source?.uri, alt: accessibilityLabel } : {}) }, children);
  return { View: element("div"), ScrollView: element("div"), Text: element("span"), Pressable: element("button"), Image: element("img"), TextInput: element("input") };
});

import ReviewMomentsScreen from "../app/review-moments";
import CuratedTimelineScreen from "../app/curated-timeline";
import CreateScreen from "../app/create";
import DirectFilmScreen from "../app/direct-film";
import ReviewFilmScreen from "../app/review-film";
import SaveFilmScreen from "../app/save-film";

let root: Root;
let host: HTMLDivElement;
let plan: StoryPlan;
beforeEach(async () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  plan = await createFixtureStoryRepository().getPlan("demo");
  plan = { ...plan, planId: "initial", moments: Array.from({ length: 7 }, (_, i) => ({ ...plan.moments[0], id: `real-${i}`, title: `Memory ${i}`, imageKey: `https://images.example/${i}.jpg` })), chapters: [] };
  delete plan.totalMomentCount;
  delete plan.timelineOtherPhotoCount;
  boundary.repository = {
    getPlan: vi.fn(async () => structuredClone(plan)),
    setMomentSelected: vi.fn(async (id, momentId, selected) => ({ ...structuredClone(plan), planId: "selected-revision", moments: plan.moments.map(m => m.id === momentId ? { ...m, selected } : m) })),
    setMomentFavorite: vi.fn(async () => ({ ...structuredClone(plan), planId: "favorite-revision" })),
    reviseMoments: vi.fn(async () => ({ ...structuredClone(plan), planId: "revised", timelineIntro: { ...plan.timelineIntro, headline: "Revised story" } })),
  };
  boundary.navigate.mockReset();
  boundary.params = { planId: "initial", repository: "fixture" };
  boundary.apiRepository = { getPlan: vi.fn(async () => ({ ...structuredClone(plan), intro: { ...plan.intro, headline: "Live project story" } })) };
  boundary.apiRepositories = new Map([["live-project", boundary.apiRepository]]);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
async function render(Component: React.ComponentType) { await act(async () => root.render(<Component />)); }
async function click(label: string) {
  const button = host.querySelector(`[aria-label="${label}"]`) as HTMLButtonElement;
  expect(button).not.toBeNull();
  await act(async () => button.click());
}

const directionOptions = (note: string): DirectionOptions => ({
  note,
  rewrites: [],
  cadences: [{ id: "gentle", name: "Gentle", description: "Warm" }],
  soundtracks: [{ id: "piano", name: "Piano", description: "Soft" }],
  durations: [{ id: "1m", label: "1 min", caption: "Brief", seconds: 60 }],
  recommendedDuration: "1m",
  recommendedCadence: "gentle",
  cadenceReason: null,
});

const film = (filmId: string, planId: string, posterKey: string): Film => ({
  filmId, planId, posterKey, savePosterKey: `${posterKey}-save`, version: 1,
  title: filmId, subtitle: "A story", place: "Singapore", dateLabel: "Sep 2026",
  durationSec: 60, videoKey: "film", momentCount: 2, audioLabel: "Piano", shortcuts: [], status: "ready", videoUrl: null, rendering: false, reasons: [],
});

describe("review screens", () => {
  it("restores the live repository from the URL on a fresh mount and carries identity forward", async () => {
    boundary.params = { planId: "initial", repository: "api", projectId: "live-project" };
    await render(ReviewMomentsScreen);
    expect(host.textContent).toContain("Live project story");
    expect(boundary.repository.getPlan).not.toHaveBeenCalled();
    await click("Continue to curated timeline");
    expect(boundary.navigate).toHaveBeenCalledWith("/curated-timeline?planId=initial&repository=api&projectId=live-project");
    await act(async () => root.unmount());
    root = createRoot(host);
    await render(ReviewMomentsScreen);
    expect(host.textContent).toContain("Live project story");
  });
  it("returns to a fixture review after a live review without retaining its repository", async () => {
    boundary.params = { planId: "initial", repository: "api", projectId: "live-project" };
    await render(ReviewMomentsScreen);
    expect(host.textContent).toContain("Live project story");
    boundary.params = { planId: "initial", repository: "fixture" };
    await render(ReviewMomentsScreen);
    expect(host.textContent).not.toContain("Live project story");
    expect(host.textContent).toContain(plan.intro.headline);
  });
  it("ignores a previous flow's delayed load after navigation", async () => {
    let resolve!: (value: StoryPlan) => void;
    boundary.apiRepository.getPlan.mockImplementationOnce(() => new Promise<StoryPlan>(done => { resolve = done; }));
    boundary.params = { planId: "initial", repository: "api", projectId: "live-project" };
    await render(ReviewMomentsScreen);
    boundary.params = { planId: "initial", repository: "fixture" };
    await render(ReviewMomentsScreen);
    await act(async () => resolve({ ...plan, intro: { ...plan.intro, headline: "Stale live story" } }));
    expect(host.textContent).not.toContain("Stale live story");
    expect(host.textContent).toContain(plan.intro.headline);
  });
  it("ignores a previous flow's delayed mutation after navigation", async () => {
    let resolve!: (value: StoryPlan) => void;
    boundary.repository.setMomentSelected.mockImplementationOnce(() => new Promise<StoryPlan>(done => { resolve = done; }));
    await render(ReviewMomentsScreen); await click("Select Memory 0");
    boundary.params = { planId: "initial", repository: "api", projectId: "live-project" };
    await render(ReviewMomentsScreen);
    await act(async () => resolve({ ...plan, intro: { ...plan.intro, headline: "Stale fixture edit" } }));
    expect(host.textContent).not.toContain("Stale fixture edit");
    expect(host.textContent).toContain("Live project story");
    await click("Continue to curated timeline");
    expect(boundary.navigate).toHaveBeenCalledWith("/curated-timeline?planId=initial&repository=api&projectId=live-project");
  });
  it.each([0, 1, 7])("renders all %i moments and their URI images", async (count) => {
    plan.moments = plan.moments.slice(0, count);
    await render(ReviewMomentsScreen);
    expect(host.querySelectorAll('[role="checkbox"]')).toHaveLength(count);
    expect([...host.querySelectorAll("img")].map(image => image.src)).toEqual(Array.from({ length: count }, (_, i) => `https://images.example/${i}.jpg`));
  });
  it("uses the returned selection revision for subsequent writes and navigation", async () => {
    await render(ReviewMomentsScreen);
    await click("Select Memory 0");
    expect(host.querySelector('[aria-label="Select Memory 0"]')?.getAttribute("aria-checked")).toBe("false");
    await click("Select Memory 1");
    expect(boundary.repository.setMomentSelected).toHaveBeenLastCalledWith("selected-revision", "real-1", false);
    await click("Continue to curated timeline");
    expect(boundary.navigate).toHaveBeenCalledWith("/curated-timeline?planId=selected-revision&repository=fixture");
  });
  it("repeats hero / paired half / hero rows without dropping the final half row", async () => {
    await render(ReviewMomentsScreen);
    const cards = [...host.querySelectorAll('[role="checkbox"]')].map(checkbox => checkbox.closest(".bg-surface-raised")!);
    expect(cards.map(card => card.classList.contains("w-full"))).toEqual([true, false, false, true, true, false, false]);
    expect(cards[1].parentElement).toBe(cards[2].parentElement);
    expect(cards[5].parentElement).toBe(cards[6].parentElement);
  });
  it("uses the returned favorite revision when continuing", async () => {
    await render(ReviewMomentsScreen);
    await click("Favorite Memory 0");
    expect(boundary.repository.setMomentFavorite).toHaveBeenCalledWith("initial", "real-0", true);
    await click("Continue to curated timeline");
    expect(boundary.navigate).toHaveBeenCalledWith("/curated-timeline?planId=favorite-revision&repository=fixture");
  });
  it("keeps the plan after a failed edit and allows retry", async () => {
    boundary.repository.setMomentSelected.mockRejectedValueOnce(new Error("Connection lost"));
    await render(ReviewMomentsScreen);
    await click("Select Memory 0");
    expect(host.querySelector('[role="alert"]')?.textContent).toBe("Connection lost");
    expect(host.querySelector('[aria-label="Select Memory 0"]')?.getAttribute("aria-checked")).toBe("true");
    await click("Select Memory 0");
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(host.querySelector('[aria-label="Select Memory 0"]')?.getAttribute("aria-checked")).toBe("false");
  });
  it("blocks overlapping writes and navigation until the current revision returns", async () => {
    let resolve!: (value: StoryPlan) => void;
    boundary.repository.setMomentSelected.mockImplementationOnce(() => new Promise<StoryPlan>(done => { resolve = done; }));
    await render(ReviewMomentsScreen);
    await click("Select Memory 0");
    await click("Select Memory 1");
    await click("Continue to curated timeline");
    expect(boundary.repository.setMomentSelected).toHaveBeenCalledTimes(1);
    expect(boundary.navigate).not.toHaveBeenCalled();
    await act(async () => resolve({ ...plan, planId: "latest" }));
    await click("Select Memory 1");
    expect(boundary.repository.setMomentSelected).toHaveBeenLastCalledWith("latest", "real-1", false);
  });
  it("renders chapter membership/order, metadata and the actual selected count", async () => {
    plan.chapters = [
      { id: "c-a", dayLabel: "Arrival", title: "Our first walk", subtitle: "Together", badge: { label: "Opening", tone: "neutral" }, dotColor: "#123456", momentIds: ["real-5", "missing", "real-0", "real-3"] },
      { id: "c-b", dayLabel: "Farewell", title: "Homeward", subtitle: "Ending", badge: { label: "Finale", tone: "milestone" }, dotColor: "#654321", momentIds: ["real-2"] },
    ];
    plan.moments[0].selected = false;
    await render(CuratedTimelineScreen);
    expect([...host.querySelectorAll('[role="checkbox"]')].map(el => el.getAttribute("aria-label"))).toEqual(["Select Memory 5", "Select Memory 0", "Select Memory 3", "Select Memory 2"]);
    expect(host.textContent).toContain("Our first walk • Together");
    expect(host.textContent).toContain("6 Moments Selected");
    expect(host.textContent).not.toContain("11:30 AM");
  });
  it("installs revised plans and directs subsequent edits and continue to that revision", async () => {
    plan.chapters = [{ id: "c", dayLabel: "Today", title: "Trip", subtitle: "Together", badge: { label: "Chapter 1", tone: "neutral" }, dotColor: "#123456", momentIds: ["real-0"] }];
    await render(CuratedTimelineScreen);
    const input = host.querySelector("input")!;
    await act(async () => { input.value = "More family"; input.dispatchEvent(new Event("input", { bubbles: true })); });
    await click("Update moments");
    expect(host.textContent).toContain("Revised story");
    await click("Select Memory 0");
    expect(boundary.repository.setMomentSelected).toHaveBeenCalledWith("revised", "real-0", false);
    await click("Continue");
    expect(boundary.navigate).toHaveBeenCalledWith("/create?planId=selected-revision&repository=fixture");
  });
});

describe("downstream story screens", () => {
  it("does not let a delayed create load replace the current project plan", async () => {
    let resolveA!: (value: StoryPlan) => void;
    const repoA = { getPlan: vi.fn(() => new Promise<StoryPlan>(done => { resolveA = done; })), chooseCreateOption: vi.fn() };
    const repoB = { getPlan: vi.fn(async () => ({ ...structuredClone(plan), planId: "plan-b" })), chooseCreateOption: vi.fn(async () => ({ available: false })) };
    boundary.apiRepositories = new Map([["project-a", repoA], ["project-b", repoB]]);
    boundary.params = { planId: "plan-a", repository: "api", projectId: "project-a" };
    await render(CreateScreen);

    boundary.params = { planId: "plan-b", repository: "api", projectId: "project-b" };
    await render(CreateScreen);
    await act(async () => resolveA({ ...structuredClone(plan), planId: "plan-a" }));
    await click("Continue with Direct my film");

    expect(repoB.chooseCreateOption).toHaveBeenCalledWith("plan-b", "film");
    expect(repoA.chooseCreateOption).not.toHaveBeenCalled();
  });

  it("does not navigate when a create action from the previous project finishes", async () => {
    let resolveChoice!: (value: { available: boolean }) => void;
    const repoA = {
      getPlan: vi.fn(async () => ({ ...structuredClone(plan), planId: "plan-a" })),
      chooseCreateOption: vi.fn(() => new Promise<{ available: boolean }>(done => { resolveChoice = done; })),
    };
    const repoB = { getPlan: vi.fn(async () => ({ ...structuredClone(plan), planId: "plan-b" })) };
    boundary.apiRepositories = new Map([["project-a", repoA], ["project-b", repoB]]);
    boundary.params = { planId: "plan-a", repository: "api", projectId: "project-a" };
    await render(CreateScreen);
    await click("Continue with Direct my film");

    boundary.params = { planId: "plan-b", repository: "api", projectId: "project-b" };
    await render(CreateScreen);
    await act(async () => resolveChoice({ available: true }));

    expect(boundary.navigate).not.toHaveBeenCalled();
  });

  it("does not let delayed directing options overwrite the current project", async () => {
    let resolveA!: (value: DirectionOptions) => void;
    const repoA = { getDirectionOptions: vi.fn(() => new Promise<DirectionOptions>(done => { resolveA = done; })), directFilm: vi.fn() };
    const repoB = {
      getDirectionOptions: vi.fn(async () => directionOptions("Project B note")),
      directFilm: vi.fn(async () => ({ filmId: "film-b" })),
    };
    boundary.apiRepositories = new Map([["project-a", repoA], ["project-b", repoB]]);
    boundary.params = { planId: "plan-a", repository: "api", projectId: "project-a" };
    await render(DirectFilmScreen);

    boundary.params = { planId: "plan-b", repository: "api", projectId: "project-b" };
    await render(DirectFilmScreen);
    await act(async () => resolveA(directionOptions("Stale project A note")));
    await click("Direct my film");

    expect(repoB.directFilm).toHaveBeenCalledWith("plan-b", expect.objectContaining({ note: "Project B note" }));
  });

  it("starts on the suggested tone and directs without a soundtrack catalog", async () => {
    const options: DirectionOptions = {
      ...directionOptions("Our trip"),
      cadences: [{ id: "tender", name: "Tender", description: "Slow" }, { id: "playful", name: "Playful", description: "Quick" }],
      soundtracks: [],
      recommendedCadence: "playful",
      cadenceReason: "kids laughing on the beach",
    };
    const repo = { getDirectionOptions: vi.fn(async () => options), directFilm: vi.fn(async () => ({ filmId: "film-1" })) };
    boundary.apiRepositories = new Map([["project-a", repo]]);
    boundary.params = { planId: "plan-a", repository: "api", projectId: "project-a" };
    await render(DirectFilmScreen);

    expect(document.body.textContent).toContain("Suggested for your photos: kids laughing on the beach");
    expect(document.body.textContent).toContain("No music yet");
    await click("Direct my film");
    expect(repo.directFilm).toHaveBeenCalledWith("plan-a", expect.objectContaining({ cadenceId: "playful", soundtrackId: null }));
  });

  it("shows the rendering overlay only while the film is actually rendering", async () => {
    const repo = { getFilm: vi.fn(async () => ({ ...film("film-1", "plan-a", "poster"), rendering: true })) };
    boundary.apiRepositories = new Map([["project-a", repo]]);
    boundary.params = { filmId: "film-1", repository: "api", projectId: "project-a" };
    await render(ReviewFilmScreen);
    expect(document.body.textContent).toContain("Rendering your film…");

    repo.getFilm.mockResolvedValue({ ...film("film-1", "plan-a", "poster"), rendering: false, videoUrl: "http://x/film.mp4" });
    await act(async () => { await new Promise((done) => setTimeout(done, 2100)); });
    expect(document.body.textContent).not.toContain("Rendering your film…");
    const calls = repo.getFilm.mock.calls.length;
    await act(async () => { await new Promise((done) => setTimeout(done, 2100)); });
    expect(repo.getFilm.mock.calls.length).toBe(calls);
  });

  it("does not navigate when directing the previous project finishes", async () => {
    let resolveDirect!: (value: { filmId: string }) => void;
    const repoA = {
      getDirectionOptions: vi.fn(async () => directionOptions("Project A note")),
      directFilm: vi.fn(() => new Promise<{ filmId: string }>(done => { resolveDirect = done; })),
    };
    const repoB = { getDirectionOptions: vi.fn(async () => directionOptions("Project B note")) };
    boundary.apiRepositories = new Map([["project-a", repoA], ["project-b", repoB]]);
    boundary.params = { planId: "plan-a", repository: "api", projectId: "project-a" };
    await render(DirectFilmScreen);
    await click("Direct my film");

    boundary.params = { planId: "plan-b", repository: "api", projectId: "project-b" };
    await render(DirectFilmScreen);
    await act(async () => resolveDirect({ filmId: "film-a" }));

    expect(boundary.navigate).not.toHaveBeenCalled();
  });

  it("does not let a delayed film load change which current-project film is saved", async () => {
    let resolveA!: (value: Film) => void;
    const repoA = { getFilm: vi.fn(() => new Promise<Film>(done => { resolveA = done; })), saveFilm: vi.fn() };
    const repoB = { getFilm: vi.fn(async () => film("film-b", "plan-b", "poster-b")), saveFilm: vi.fn(async () => undefined) };
    boundary.apiRepositories = new Map([["project-a", repoA], ["project-b", repoB]]);
    boundary.params = { filmId: "film-a", repository: "api", projectId: "project-a" };
    await render(ReviewFilmScreen);

    boundary.params = { filmId: "film-b", repository: "api", projectId: "project-b" };
    await render(ReviewFilmScreen);
    await act(async () => resolveA(film("film-a", "plan-a", "poster-a")));
    await click("Looks good! Save film");

    expect(repoB.saveFilm).toHaveBeenCalledWith("film-b");
    expect(repoA.saveFilm).not.toHaveBeenCalled();
  });

  it("does not navigate when saving the previous project's film finishes", async () => {
    let resolveSave!: () => void;
    const repoA = {
      getFilm: vi.fn(async () => film("film-a", "plan-a", "poster-a")),
      saveFilm: vi.fn(() => new Promise<void>(done => { resolveSave = done; })),
    };
    const repoB = { getFilm: vi.fn(async () => film("film-b", "plan-b", "poster-b")) };
    boundary.apiRepositories = new Map([["project-a", repoA], ["project-b", repoB]]);
    boundary.params = { filmId: "film-a", repository: "api", projectId: "project-a" };
    await render(ReviewFilmScreen);
    await click("Looks good! Save film");

    boundary.params = { filmId: "film-b", repository: "api", projectId: "project-b" };
    await render(ReviewFilmScreen);
    await act(async () => resolveSave());

    expect(boundary.navigate).not.toHaveBeenCalled();
  });

  it("does not let a delayed completed-film load overwrite the current project", async () => {
    let resolveA!: (value: Film) => void;
    const repoA = { getFilm: vi.fn(() => new Promise<Film>(done => { resolveA = done; })) };
    const repoB = { getFilm: vi.fn(async () => film("film-b", "plan-b", "poster-b")) };
    boundary.apiRepositories = new Map([["project-a", repoA], ["project-b", repoB]]);
    boundary.params = { filmId: "film-a", repository: "api", projectId: "project-a" };
    await render(SaveFilmScreen);

    boundary.params = { filmId: "film-b", repository: "api", projectId: "project-b" };
    await render(SaveFilmScreen);
    await act(async () => resolveA(film("film-a", "plan-a", "poster-a")));

    expect(host.querySelector('[data-testid="film-player"]')?.getAttribute("data-poster")).toBe("poster-b-save");
  });
});

describe("live review edits", () => {
  const emptyEdits = { deselectedMomentIds: [], mustIncludeMomentIds: [], hiddenShotIds: [], momentOrder: [], photoSwaps: {} };
  beforeEach(() => {
    plan.moments = plan.moments.slice(0, 3).map((moment, i) => ({ ...moment, shotId: `shot-${i}`, reason: `Reason ${i}`, selected: true }));
    plan.chapters = [
      { id: "d1", dayLabel: "Day 1", title: "Day 1 · Siloso Beach", subtitle: "", badge: { label: "Chapter 1", tone: "neutral" }, dotColor: "#123456", momentIds: ["real-0", "real-1"] },
      { id: "d2", dayLabel: "Day 2", title: "Day 2 · Singapore Zoo", subtitle: "", badge: { label: "Chapter 2", tone: "neutral" }, dotColor: "#123456", momentIds: ["real-2"] },
    ];
    plan.edits = structuredClone(emptyEdits);
    plan.leftOut = [{ shotId: "shot-x", thumbnailUrl: "thumb:x", reason: "Left out: someone outside the family is the main subject." }];
    let version = 0;
    boundary.repository.applyEdits = vi.fn(async (_id: string, edits: typeof emptyEdits) => ({ ...structuredClone(plan), planId: `v${++version}`, edits: structuredClone(edits) }));
    boundary.repository.getAlternatives = vi.fn(async () => [{ shotId: "shot-alt", thumbnailUrl: "thumb:alt" }]);
  });

  it("groups moments by day and shows why each was chosen", async () => {
    await render(ReviewMomentsScreen);
    expect(host.textContent).toContain("Day 1 · Siloso Beach");
    expect(host.textContent).toContain("Day 2 · Singapore Zoo");
    expect(host.textContent).toContain("Reason 0");
    await click("Left out (1)");
    expect(host.textContent).toContain("someone outside the family is the main subject");
  });

  it("moves a moment within its day, then undoes it", async () => {
    await render(ReviewMomentsScreen);
    await click("More for Memory 0");
    await click("Move Memory 0 down");
    expect(boundary.repository.applyEdits).toHaveBeenLastCalledWith("initial", { ...emptyEdits, momentOrder: ["real-1", "real-0"] });
    await click("Undo");
    expect(boundary.repository.applyEdits).toHaveBeenLastCalledWith("v1", emptyEdits);
  });

  it("points the URL at the new version after an edit, so a reload keeps it", async () => {
    await render(ReviewMomentsScreen);
    await click("More for Memory 0");
    await click("Move Memory 0 down");
    expect(boundary.setParams).toHaveBeenCalledWith({ planId: "v1" });
  });

  it("opens the Character Picker for the plan on screen", async () => {
    await render(ReviewMomentsScreen);
    await click("Who's in your film?");
    expect(boundary.navigate).toHaveBeenCalledWith(expect.stringContaining("/character-picker?planId=initial"));
  });

  it("can't move the first moment of a day up", async () => {
    await render(ReviewMomentsScreen);
    await click("More for Memory 0");
    expect((host.querySelector('[aria-label="Move Memory 0 up"]') as HTMLButtonElement).disabled).toBe(true);
  });

  it("swaps a photo for another shot of the same moment", async () => {
    await render(ReviewMomentsScreen);
    await click("More for Memory 1");
    await click("Swap photo for Memory 1");
    expect(boundary.repository.getAlternatives).toHaveBeenCalledWith("initial", "real-1");
    await click("Use other shot 1");
    expect(boundary.repository.applyEdits).toHaveBeenLastCalledWith("initial", { ...emptyEdits, photoSwaps: { "real-1": "shot-alt" } });
  });

  it("hides a photo by its shot and deselects through edits so undo covers it", async () => {
    await render(ReviewMomentsScreen);
    await click("More for Memory 2");
    await click("Hide Memory 2");
    expect(boundary.repository.applyEdits).toHaveBeenLastCalledWith("initial", { ...emptyEdits, hiddenShotIds: ["shot-2"] });
    await click("Select Memory 0");
    expect(boundary.repository.applyEdits).toHaveBeenLastCalledWith("v1", { ...emptyEdits, hiddenShotIds: ["shot-2"], deselectedMomentIds: ["real-0"] });
    expect(boundary.repository.setMomentSelected).not.toHaveBeenCalled();
  });
});
