import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react-native", () => {
  const node = (tag: string) => ({ children, onPress, onChangeText, accessibilityLabel, editable, ...props }: any) => React.createElement(tag, { ...props, "aria-label": props["aria-label"] ?? accessibilityLabel, disabled: props.disabled ?? (editable === false ? true : undefined), onClick: onPress, onInput: onChangeText ? (event: any) => onChangeText(event.target.value) : undefined }, children);
  return { View: node("div"), ScrollView: node("div"), Text: node("span"), Pressable: node("button"), TextInput: node("input"), Image: ({ source, accessibilityLabel, ...props }: any) => React.createElement("img", { ...props, src: source?.uri, alt: accessibilityLabel }) };
});

const mocks = vi.hoisted(() => ({ repo: null as any, confirmCast: vi.fn(), push: vi.fn() }));
vi.mock("expo-router", () => ({ useLocalSearchParams: () => ({ projectId: "project-1" }), useRouter: () => ({ back: vi.fn(), push: mocks.push }) }));
vi.mock("@mosae/core", async (importOriginal) => ({ ...(await importOriginal<typeof import("@mosae/core")>()), getStoryRepository: () => mocks.repo }));
vi.mock("@/lib/characters", () => ({ confirmCast: (...args: any[]) => mocks.confirmCast(...args) }));
vi.mock("@/components/FilmPlayer", () => ({ FilmPlayer: () => React.createElement("div", { "data-testid": "film-player" }) }));
import DirectorScreen from "../app/director";

let root: Root;
let host: HTMLDivElement;
beforeEach(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
async function renderScreen() { await act(async () => root.render(<DirectorScreen />)); }
async function click(label: string) { const button = host.querySelector(`button[aria-label="${label}"]`) ?? host.querySelector(`button[aria-label^="${label},"]`) ?? [...host.querySelectorAll("button")].find((item) => item.textContent?.trim() === label); expect(button).toBeTruthy(); await act(async () => button!.dispatchEvent(new MouseEvent("click", { bubbles: true }))); }
function hasText(text: string) { return host.textContent?.includes(text) ?? false; }
async function waitFor(check: () => void) { for (let i = 0; i < 40; i++) { try { check(); return; } catch { await act(async () => new Promise((resolve) => setTimeout(resolve, 10))); } } check(); }

const summary = (faces = true) => ({ total: 8, photos: 8, clips: 0, days: 2, dateRange: null, places: ["Tokyo"], country: "Japan", season: "late October", processed: { ingested: 8, understood: 8, faces: 4 }, ready: { summary: true, faces, plan: false } });
const people = [
  { personId: "person-1", name: null, role: null, momentCount: 212, sampleShotIds: ["a", "b"], days: [2, 3] },
  { personId: "person-2", name: null, role: null, momentCount: 90, sampleShotIds: ["c"], days: [1] },
];

const planFixture = {
  planId: "proposal-1", title: "Japan", place: "Japan", dateRange: "Oct", coverImageKey: "one", intro: { headline: "", body: "" }, archivalMatch: [], timelineIntro: { headline: "", body: "", sequence: "" },
  moments: Array.from({ length: 6 }, (_, index) => ({ id: `moment-${index + 1}`, shotId: `shot-${index + 1}`, title: `Moment ${index + 1}`, meta: "Day 1", tag: { emoji: "", label: "" }, imageKey: `https://image/${index + 1}`, kind: "photo" as const, selected: true, favorite: false })),
  chapters: [], otherPhotoCount: 459, albumName: "", suggestions: [], estimatedFilmLabel: "", totalMomentCount: 327,
  leftOut: [{ shotId: "set-aside-blur", thumbnailUrl: "https://image/blur", reason: "Blurry" }, ...Array.from({ length: 120 }, (_, index) => ({ shotId: `dup-${index}`, thumbnailUrl: "", reason: "Near duplicate" }))],
  edits: { deselectedMomentIds: [], mustIncludeMomentIds: [], hiddenShotIds: [], excludedShotIds: ["previously-excluded", "dup-0"], momentOrder: [], photoSwaps: {} },
} as any;
const directionOptions = { note: "Warm, intimate story", rewrites: [], cadences: [{ id: "reflective", name: "Gentle", description: "Unhurried" }, { id: "playful", name: "Lively", description: "Energetic" }], soundtracks: [], durations: [{ id: "1m", label: "1 min", caption: "Short", seconds: 60 }, { id: "2m", label: "2 min", caption: "Balanced", seconds: 120 }, { id: "4m", label: "4 min", caption: "Long", seconds: 240 }], recommendedDuration: "2m", recommendedCadence: "reflective", cadenceReason: "The photos feel calm" };
const filmFixture = { filmId: "film-1", planId: "proposal-1", version: 1, title: "Japan, autumn", subtitle: "A family trip", place: "Japan", dateLabel: "October", durationSec: 124, posterKey: "poster", savePosterKey: "poster", videoKey: "video", momentCount: 419, audioLabel: "Soft piano", shortcuts: [], status: "ready", videoUrl: "https://film.example/first-cut.mp4", rendering: false, reasons: ["Opens on the train window in Tokyo.", "Mia's reactions lead each day.", "Both moments you kept are in.", "I left out repeated scenery shots."] } as any;
function setup(options: { faces?: boolean; interpret?: () => Promise<any>; createPlan?: () => Promise<any>; people?: any[]; readyPlan?: boolean; applyEdits?: (...args: any[]) => Promise<any>; getFilm?: (...args: any[]) => Promise<any>; saveFilm?: (...args: any[]) => Promise<any> } = {}) {
  const planReady = options.readyPlan ?? false;
  mocks.repo = {
    getSummary: vi.fn(async () => ({ ...summary(options.faces ?? true), total: planReady ? 465 : 8, ready: { ...summary(options.faces ?? true).ready, plan: planReady } })), getPeople: vi.fn(async () => options.people ?? people),
    createPlan: vi.fn(options.createPlan ?? (async () => ({ planId: "proposal-1" }))),
    interpret: vi.fn(options.interpret ?? (async () => ({ reply: "I understood the Japan trip.", change: { kind: "occasion", storyText: "Japan trip" } }))),
    getPlan: vi.fn(async () => planFixture), applyEdits: vi.fn(options.applyEdits ?? (async () => planFixture)), getDirectionOptions: vi.fn(async () => directionOptions), directFilm: vi.fn(async () => ({ filmId: "film-1" })), getFilm: vi.fn(options.getFilm ?? (async () => filmFixture)), saveFilm: vi.fn(options.saveFilm ?? (async () => ({ downloadKey: "https://film.example/first-cut.mp4" }))),
  };
  mocks.confirmCast.mockResolvedValue({ cast: { people: [] }, proposalId: "proposal-2" });
}

describe("Director chat", () => {
  beforeEach(() => vi.clearAllMocks());

  it("shows the ready summary and starts the story intent when the occasion reply is tapped", async () => {
    setup(); await renderScreen();
    expect(hasText("I've looked through all 8")).toBe(true);
    await click("Yes, that's our story");
    await waitFor(() => expect(mocks.repo.createPlan).toHaveBeenCalledWith("Tokyo", []));
    expect(hasText("Tokyo")).toBe(true);
  });

  it("shows people processing and Skip for now while faces are still pending", async () => {
    setup({ faces: false }); await renderScreen();
    await click("Yes, that's our story");
    expect(hasText("Finding the faces in your trip")).toBe(true);
    expect(hasText("Skip for now")).toBe(true);
  });

  it("saves the selected role and name before asking about the next person", async () => {
    setup(); await renderScreen();
    await click("Yes, that's our story");
    await click("My daughter");
    await waitFor(() => expect(mocks.confirmCast).toHaveBeenCalledWith("project-1", expect.objectContaining({ people: expect.arrayContaining([expect.objectContaining({ personId: "person-1", role: "child", name: "My daughter" })]) })));
    expect(hasText("One person appears in 90 moments. Who is this?")).toBe(true);
  });

  it("Skip for now advances past the people step", async () => {
    setup(); await renderScreen();
    await click("Yes, that's our story");
    await click("Skip for now");
    await waitFor(() => expect(mocks.confirmCast).toHaveBeenCalled());
  });

  it("interprets typed text and waits for an explicit confirmation before saving", async () => {
    setup(); await renderScreen();
    const composer = host.querySelector('input[aria-label="Tell me anything about the story"]')!;
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(composer, "our family trip"); composer.dispatchEvent(new Event("input", { bubbles: true })); });
    await click("→");
    await waitFor(() => expect(hasText("I understood the Japan trip.")).toBe(true));
    expect(mocks.repo.createPlan).not.toHaveBeenCalled();
    await click("Yes, that's right");
    await waitFor(() => expect(mocks.repo.createPlan).toHaveBeenCalledWith("our family trip", []));
  });

  it("shows the unclear reply when interpretation fails and keeps the occasion reply usable", async () => {
    setup({ interpret: async () => { throw new Error("offline"); } }); await renderScreen();
    const composer = host.querySelector('input[aria-label="Tell me anything about the story"]')!;
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(composer, "something"); composer.dispatchEvent(new Event("input", { bubbles: true })); });
    await click("→");
    await waitFor(() => expect(hasText("I didn't catch that. Pick one below, or say it another way.")).toBe(true));
    expect(hasText("Yes, that's our story")).toBe(true);
    expect(mocks.repo.createPlan).not.toHaveBeenCalled();
  });

  it("shows Try again after a failed save and retries the save", async () => {
    let attempts = 0;
    setup({ createPlan: async () => { if (!attempts++) throw new Error("network"); return { planId: "proposal-1" }; } }); await renderScreen();
    await click("Yes, that's our story");
    await waitFor(() => expect(hasText("Try again")).toBe(true));
    await click("Try again");
    await waitFor(() => expect(mocks.repo.createPlan).toHaveBeenCalledTimes(2));
  });

  async function openMoments(applyEdits?: (...args: any[]) => Promise<any>, getFilm?: (...args: any[]) => Promise<any>) {
    setup({ people: [], readyPlan: true, applyEdits, getFilm }); await renderScreen();
    await click("Yes, that's our story");
    await waitFor(() => expect(hasText("2 of 4 confirmed")).toBe(true));
  }

  it("shows the set-aside counts from the plan", async () => {
    await openMoments();
    expect(hasText("1 blurry shot and 120 near-duplicates")).toBe(true);
    expect(hasText("See what's set aside")).toBe(true);
    await click("See what's set aside");
    expect(mocks.push).toHaveBeenCalledWith({ pathname: "/review-moments", params: { planId: "proposal-1", tab: "left-out" } });
  });

  it("saves Keep and Leave out choices in one constraints update when Done is pressed", async () => {
    await openMoments();
    await click("Moment set-aside-blur");
    await click("Moment dup-0"); await click("Moment dup-0");
    await click("Done");
    await waitFor(() => expect(mocks.repo.applyEdits).toHaveBeenCalledTimes(1));
    expect(mocks.repo.applyEdits).toHaveBeenCalledWith("proposal-1", expect.objectContaining({ mustIncludeMomentIds: ["set-aside-blur"], excludedShotIds: ["previously-excluded", "dup-0"] }));
  });

  it("preserves earlier exclusions and removes a prior exclusion when that tile is marked Keep", async () => {
    await openMoments();
    await click("Moment dup-0");
    await click("Moment dup-1"); await click("Moment dup-1");
    await click("Done");
    await waitFor(() => expect(mocks.repo.applyEdits).toHaveBeenCalledTimes(1));
    expect(mocks.repo.applyEdits).toHaveBeenCalledWith("proposal-1", expect.objectContaining({ mustIncludeMomentIds: ["dup-0"], excludedShotIds: ["previously-excluded", "dup-1"] }));
  });

  it("opens the all-moments picker and submits the selected ids", async () => {
    await openMoments();
    await click("Choose from all 465");
    expect(hasText("Must-include moments")).toBe(true);
    await click("Moment shot-4");
    await click("Add 1 moments");
    expect(mocks.repo.applyEdits).not.toHaveBeenCalled();
    await click("Done");
    await waitFor(() => expect(mocks.repo.applyEdits).toHaveBeenCalledWith("proposal-1", expect.objectContaining({ mustIncludeMomentIds: ["shot-4"] })));
  });

  it("shows a conflict question and stays on moments when the constraints patch returns 409", async () => {
    await openMoments(async () => { throw Object.assign(new Error("You asked to keep and leave out the same moment."), { status: 409, code: "must_include_conflict" }); });
    await click("Moment set-aside-blur"); await click("Done");
    await waitFor(() => expect(hasText("You asked to keep and leave out the same moment.")).toBe(true));
    expect(hasText("Any moments that must be in the film")).toBe(true);
    expect(hasText("Keep it")).toBe(true);
    expect(hasText("3 of 4 confirmed")).toBe(false);
  });

  it("loads direction options, updates the explanation for the chosen length, and directs with the chosen settings", async () => {
    await openMoments();
    await click("Done");
    await waitFor(() => expect(mocks.repo.getDirectionOptions).toHaveBeenCalledWith("proposal-1"));
    expect(hasText("Warm, intimate story")).toBe(true);
    await click("4 min");
    expect(hasText("For 4 minutes, I'll keep")).toBe(true);
    await click("Lively");
    await click("Whole family");
    await click("Sounds good. Shape it.");
    await waitFor(() => expect(mocks.repo.directFilm).toHaveBeenCalledWith("proposal-1", expect.objectContaining({ cadenceId: "playful", durationId: "4m", focus: "family" })));
  });

  it("maps generation polling progress to the shaping checklist from zero through three", async () => {
    const earlyRender = { ...filmFixture, rendering: true, renderProgress: 0.45 };
    const laterRender = { ...filmFixture, rendering: true, renderProgress: 0.8 };
    let resolveFirst!: (film: any) => void;
    const getFilm = vi.fn()
      .mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; }))
      .mockResolvedValueOnce(laterRender).mockResolvedValueOnce(filmFixture);
    await openMoments(undefined, getFilm);
    await click("Done");
    await waitFor(() => expect(hasText("Sounds good. Shape it.")).toBe(true));
    await waitFor(() => expect((host.querySelector('button[aria-label="Sounds good. Shape it."]') as HTMLButtonElement).disabled).toBe(false));
    vi.useFakeTimers();
    try {
      await click("Sounds good. Shape it.");
      await act(async () => { await Promise.resolve(); });
      expect(mocks.repo.directFilm).toHaveBeenCalledTimes(1);
      expect(hasText("Shaping your film")).toBe(true);
      const progress = () => host.querySelector('[aria-label="Film shaping progress"]')?.getAttribute("aria-valuenow");
      expect(progress()).toBe("0");
      await act(async () => { resolveFirst(earlyRender); await Promise.resolve(); });
      expect(progress()).toBe("1");
      await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
      expect(progress()).toBe("2");
      await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
      expect(hasText("Here's your first cut. Tap to watch.")).toBe(true);
      expect(getFilm).toHaveBeenCalledTimes(3);
    } finally { vi.useRealTimers(); }
  });

  it("shows the completed film with three direction notes and opens its moments in the editor", async () => {
    planFixture.chapters = Array.from({ length: 5 }, (_, index) => ({ id: `chapter-${index}`, title: `Chapter ${index + 1}`, momentIds: [] }));
    await openMoments();
    await click("Done");
    await waitFor(() => expect(hasText("Sounds good. Shape it.")).toBe(true));
    await click("Sounds good. Shape it.");
    await waitFor(() => expect(hasText("Japan, autumn")).toBe(true));
    expect(hasText("5 chapters")).toBe(true);
    expect(hasText("How I directed it")).toBe(true);
    expect(hasText("Both moments you kept are in.")).toBe(true);
    expect(hasText("I left out repeated scenery shots.")).toBe(false);
    await click("Open in editor");
    expect(mocks.push).toHaveBeenCalledWith({ pathname: "/review-moments", params: { planId: "proposal-1" } });
  });

  it("saves the film and opens the chat saved screen", async () => {
    await openMoments();
    await click("Done");
    await waitFor(() => expect(hasText("Sounds good. Shape it.")).toBe(true));
    await click("Sounds good. Shape it.");
    await waitFor(() => expect(hasText("Save film")).toBe(true));
    await click("Save film");
    await waitFor(() => expect(mocks.repo.saveFilm).toHaveBeenCalledWith("film-1"));
    expect(mocks.push).toHaveBeenCalledWith({ pathname: "/save-film", params: { filmId: "film-1", directorChat: "true" } });
  });

  it("sends Ask for a change to Review Moments with the request in the URL", async () => {
    await openMoments();
    await click("Done");
    await waitFor(() => expect(hasText("Sounds good. Shape it.")).toBe(true));
    await click("Sounds good. Shape it.");
    await waitFor(() => expect(host.querySelector('input[aria-label="Ask for a change"]')).toBeTruthy());
    const composer = host.querySelector('input[aria-label="Ask for a change"]')!;
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(composer, "Make it shorter"); composer.dispatchEvent(new Event("input", { bubbles: true })); });
    await click("Send");
    expect(mocks.push).toHaveBeenCalledWith({ pathname: "/review-moments", params: { planId: "proposal-1", request: "Make it shorter" } });
    expect(mocks.repo.interpret).not.toHaveBeenCalled();
  });
});
