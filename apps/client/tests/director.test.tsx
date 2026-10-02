import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const scrollMock = vi.hoisted(() => ({ scrollToEnd: vi.fn() }));
vi.mock("react-native", () => {
  const ScrollView = React.forwardRef(({ children, accessibilityLabel, onScrollBeginDrag: _onScrollBeginDrag, scrollEventThrottle: _scrollEventThrottle, contentContainerStyle: _contentContainerStyle, contentContainerClassName: _contentContainerClassName, keyboardShouldPersistTaps: _keyboardShouldPersistTaps, ...props }: any, ref: any) => {
    React.useImperativeHandle(ref, () => ({ scrollToEnd: scrollMock.scrollToEnd }), []);
    return React.createElement("div", { ...props, "aria-label": accessibilityLabel }, children);
  });
  const node = (tag: string) => ({ children, onPress, onChangeText, accessibilityLabel, editable, ...props }: any) => React.createElement(tag, { ...props, "aria-label": props["aria-label"] ?? accessibilityLabel, disabled: props.disabled ?? (editable === false ? true : undefined), onClick: onPress, onInput: onChangeText ? (event: any) => onChangeText(event.target.value) : undefined }, children);
  return { View: node("div"), ScrollView, Text: node("span"), Pressable: node("button"), TextInput: node("input"), Image: ({ source, accessibilityLabel, ...props }: any) => React.createElement("img", { ...props, src: source?.uri, alt: accessibilityLabel }) };
});

const mocks = vi.hoisted(() => ({ repo: null as any, flowRepo: null as any, confirmCast: vi.fn(), push: vi.fn() }));
vi.mock("expo-router", () => ({ useLocalSearchParams: () => ({ projectId: "project-1" }), useRouter: () => ({ back: vi.fn(), push: mocks.push }) }));
vi.mock("@mosae/core", async (importOriginal) => ({ ...(await importOriginal<typeof import("@mosae/core")>()), getStoryRepository: () => mocks.repo }));
vi.mock("@/lib/characters", () => ({ confirmCast: (...args: any[]) => mocks.confirmCast(...args) }));
vi.mock("@/lib/storyFlow", () => ({ useStoryFlow: () => ({ repository: mocks.flowRepo, flow: { repository: "api", projectId: "project-1" } }) }));
vi.mock("@/components/FilmPlayer", () => ({ FilmPlayer: () => React.createElement("div", { "data-testid": "film-player" }) }));
vi.mock("@/components/editor/EditorPreview", () => ({ EditorPreview: () => React.createElement("div", { "data-testid": "film-ready-player" }) }));
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
  { personId: "person-1", name: null, role: null, ageBand: "child", momentCount: 212, sampleShotIds: ["a", "b", "c", "d"], sampleFaces: [
    { shotId: "a", uri: "https://thumb.test/a", bbox: [0.1, 0.2, 0.4, 0.5] },
    { shotId: "b", uri: "https://thumb.test/b", bbox: [0.3, 0.4, 0.7, 0.8] },
    { shotId: "c", uri: "https://thumb.test/c", bbox: [0.2, 0.3, 0.5, 0.6] },
    { shotId: "d", uri: "https://thumb.test/d", bbox: [0.4, 0.4, 0.8, 0.8] },
  ], days: [1, 2, 3] },
  { personId: "person-2", name: null, role: null, ageBand: "adult", momentCount: 90, sampleShotIds: ["c"], sampleFaces: [], days: [1] },
];

const planFixture = {
  planId: "proposal-1", title: "Japan", place: "Japan", dateRange: "Oct", coverImageKey: "one", intro: { headline: "", body: "" }, archivalMatch: [], timelineIntro: { headline: "", body: "", sequence: "" },
  moments: Array.from({ length: 6 }, (_, index) => ({ id: `moment-${index + 1}`, shotId: `shot-${index + 1}`, title: `Moment ${index + 1}`, meta: "Day 1", tag: { emoji: "", label: "" }, imageKey: `https://image/${index + 1}`, kind: "photo" as const, selected: true, favorite: false })),
  chapters: [], otherPhotoCount: 459, albumName: "", suggestions: [], estimatedFilmLabel: "", totalMomentCount: 327,
  leftOut: [{ shotId: "set-aside-blur", thumbnailUrl: "https://image/blur", reason: "Blurry" }, ...Array.from({ length: 120 }, (_, index) => ({ shotId: `dup-${index}`, thumbnailUrl: "", reason: "Near duplicate" }))],
  edits: { deselectedMomentIds: [], mustIncludeMomentIds: [], hiddenShotIds: [], excludedShotIds: ["previously-excluded", "dup-0"], momentOrder: [], photoSwaps: {} },
} as any;
const directionOptions = { note: "Warm, intimate story", rewrites: [], cadences: [{ id: "reflective", name: "Gentle", description: "Unhurried" }, { id: "playful", name: "Lively", description: "Energetic" }], soundtracks: [{ id: "lyria-reflective", name: "Quiet afternoon", description: "Gentle piano" }], durations: [{ id: "30s", label: "30 sec", caption: "Quick", seconds: 30 }, { id: "1m", label: "1 min", caption: "Short", seconds: 60 }, { id: "2m", label: "2 min", caption: "Balanced", seconds: 120 }, { id: "3m", label: "3 min", caption: "Extended", seconds: 180 }, { id: "4m", label: "4 min", caption: "Long", seconds: 240 }, { id: "5m", label: "5 min", caption: "Everything", seconds: 300 }], recommendedDuration: "2m", recommendedCadence: "reflective", cadenceReason: "The photos feel calm", maximumDurationSec: 300 };
const filmFixture = { filmId: "film-1", planId: "proposal-1", version: 1, title: "Japan, autumn", subtitle: "A family trip", place: "Japan", dateLabel: "October", durationSec: 124, posterKey: "poster", savePosterKey: "poster", videoKey: "video", momentCount: 419, audioLabel: "Soft piano", shortcuts: [], status: "ready", videoUrl: "https://film.example/first-cut.mp4", rendering: false, reasons: ["Opens on the train window in Tokyo.", "Mia's reactions lead each day.", "Both moments you kept are in.", "I left out repeated scenery shots."] } as any;
function setup(options: { faces?: boolean; interpret?: () => Promise<any>; createPlan?: () => Promise<any>; people?: any[]; readyPlan?: boolean; applyEdits?: (...args: any[]) => Promise<any>; getFilm?: (...args: any[]) => Promise<any>; getProjectResume?: (...args: any[]) => Promise<any>; saveFilm?: (...args: any[]) => Promise<any>; maximumDurationSec?: number; maximumDurationSecByCadence?: Record<string, number> } = {}) {
  const planReady = options.readyPlan ?? false;
  mocks.repo = {
    getSummary: vi.fn(async () => ({ ...summary(options.faces ?? true), total: planReady ? 465 : 8, ready: { ...summary(options.faces ?? true).ready, plan: planReady } })), getPeople: vi.fn(async () => options.people ?? people),
    createPlan: vi.fn(options.createPlan ?? (async () => ({ planId: "proposal-1" }))),
    interpret: vi.fn(options.interpret ?? (async () => ({ reply: "I understood the Japan trip.", change: { kind: "occasion", storyText: "Japan trip" } }))),
    getPlan: vi.fn(async () => planFixture), applyEdits: vi.fn(options.applyEdits ?? (async () => planFixture)), getDirectionOptions: vi.fn(async () => ({ ...directionOptions, maximumDurationSec: options.maximumDurationSec ?? directionOptions.maximumDurationSec, ...(options.maximumDurationSecByCadence ? { maximumDurationSecByCadence: options.maximumDurationSecByCadence } : {}) })), directFilm: vi.fn(async () => ({ filmId: "film-1" })), getFilm: vi.fn(options.getFilm ?? (async () => filmFixture)), getFilmTimeline: vi.fn(async () => ({ timeline: { durationSec: 124, fps: 30, aspect: "9:16", videoClips: [] }, sources: {} })), getProjectResume: vi.fn(options.getProjectResume ?? (async () => ({ proposalId: null, storyText: null, generationId: null, generationStatus: null }))), saveFilm: vi.fn(options.saveFilm ?? (async () => ({ downloadKey: "https://film.example/first-cut.mp4" }))),
  };
  mocks.flowRepo = mocks.repo;
  mocks.confirmCast.mockResolvedValue({ cast: { people: [] }, proposalId: "proposal-2" });
}

describe("Director chat", () => {
  beforeEach(() => vi.clearAllMocks());

  it("keeps the chat history in a constrained, independently scrollable flex region", async () => {
    setup(); await renderScreen();
    const history = host.querySelector('[aria-label="Director chat history"]') as HTMLElement | null;
    expect(history).not.toBeNull();
    expect(history!.style.minHeight).toBe("0");
    expect(history!.style.flexGrow).toBe("1");
  });

  it("scrolls the director history to the newest message after an occasion chip action", async () => {
    setup(); await renderScreen();
    scrollMock.scrollToEnd.mockClear();
    await click("Yes, our Japan trip");
    await waitFor(() => expect(scrollMock.scrollToEnd).toHaveBeenCalled());
  });

  it("shows the ready summary and starts the story intent when the occasion reply is tapped", async () => {
    setup(); await renderScreen();
    expect(hasText("I've looked through all 8")).toBe(true);
    expect(host.textContent?.match(/Is that the story\?/g)).toHaveLength(1);
    expect(host.querySelector('[data-from="mosae"]')?.textContent).toContain("Is that the story?");
    await click("Yes, our Japan trip");
    await waitFor(() => expect(mocks.repo.createPlan).toHaveBeenCalledWith("Japan trip", []));
    expect(hasText("Yes, our Japan trip")).toBe(true);
  });

  it("titles the chat from country and season, then falls back to place and Your film", async () => {
    setup(); await renderScreen();
    expect(host.textContent).toContain("Japan, October");
    setup(); mocks.repo.getSummary.mockResolvedValue({ ...summary(), country: "Singapore", season: "early June", places: ["Telok Blangah"] }); await renderScreen();
    expect(host.textContent).toContain("Singapore, June");
    setup(); mocks.repo.getSummary.mockResolvedValue({ ...summary(), country: null, season: null }); await renderScreen();
    expect(host.textContent).toContain("Tokyo");
    setup(); mocks.repo.getSummary.mockResolvedValue({ ...summary(), country: null, season: null, places: [] }); await renderScreen();
    expect(host.textContent).toContain("Your film");
  });

  it("uses the repository scoped to the director route project", async () => {
    setup();
    mocks.flowRepo = { ...mocks.repo, getSummary: vi.fn(async () => summary()), getPeople: vi.fn(async () => people) };
    await renderScreen();
    await waitFor(() => expect(mocks.flowRepo.getSummary).toHaveBeenCalledWith("project-1"));
    expect(mocks.repo.getSummary).not.toHaveBeenCalled();
  });

  it("reopens a completed project with its confirmed answers and Film ready actions", async () => {
    const confirmedPeople = people.map((person, index) => ({ ...person, role: index ? "parent" : "child", name: index ? "Mum" : "Mia" }));
    setup({
      readyPlan: true,
      people: confirmedPeople,
      getProjectResume: async () => ({ proposalId: "proposal-1", storyText: "Our family trip to Japan", generationId: "film-1", generationStatus: "playable" }),
    });

    await renderScreen();
    await waitFor(() => expect(host.textContent).toContain("Open in editor"));

    expect(host.textContent).toContain("Our family trip to Japan");
    expect(host.textContent).toContain("Mia");
    expect(host.textContent).toContain("Mum");
    expect(host.textContent).toContain("Film ready");
    expect(host.textContent).toContain("Save film");
    await waitFor(() => expect(host.querySelector('[data-testid="film-ready-player"]')).not.toBeNull());
    expect(host.querySelector('[data-testid="film-player"]')).toBeNull();
    expect(mocks.repo.getProjectResume).toHaveBeenCalledOnce();
    expect(mocks.repo.getFilm).toHaveBeenCalledWith("film-1");
    expect(mocks.repo.getFilmTimeline).toHaveBeenCalledWith("project-1", "film-1");
  });

  it("opens an already saved generation in the Player and marks it saved", async () => {
    setup({
      readyPlan: true,
      getFilm: async () => ({ ...filmFixture, generationStatus: "saved" }),
      getProjectResume: async () => ({ proposalId: "proposal-1", storyText: "Our family trip to Japan", generationId: "film-1", generationStatus: "saved" }),
    });
    await renderScreen();
    await waitFor(() => expect(host.querySelector('[data-testid="film-ready-player"]')).not.toBeNull());
    const saved = host.querySelector('button[aria-label="Saved"]') as HTMLButtonElement;
    expect(saved).not.toBeNull();
    expect(saved.disabled).toBe(true);
    expect(mocks.repo.saveFilm).not.toHaveBeenCalled();
  });

  it("opens an older generation that is already rendering without waiting for its MP4", async () => {
    setup({
      readyPlan: true,
      getFilm: async () => ({ ...filmFixture, rendering: true, generationStatus: "rendering" }),
      getProjectResume: async () => ({ proposalId: "proposal-1", storyText: "Our family trip to Japan", generationId: "film-1", generationStatus: "rendering" }),
    });
    await renderScreen();
    await waitFor(() => expect(host.querySelector('[data-testid="film-ready-player"]')).not.toBeNull());
    expect(mocks.repo.getFilm).toHaveBeenCalledTimes(1);
    expect(mocks.repo.getFilmTimeline).toHaveBeenCalledWith("project-1", "film-1");
  });

  it("uses a safe fallback story intent when the summary has no detected places", async () => {
    setup();
    mocks.repo.getSummary.mockResolvedValue({ ...summary(), places: [] });
    await renderScreen();
    await click("Yes, our Japan trip");
    await waitFor(() => expect(mocks.repo.createPlan).toHaveBeenCalledWith("Japan trip", []));
  });

  it("shows people processing and Skip for now while faces are still pending", async () => {
    setup({ faces: false }); await renderScreen();
    await click("Yes, our Japan trip");
    expect(hasText("Finding the faces in your trip")).toBe(true);
    expect(hasText("Skip for now")).toBe(true);
  });

  it("waits for the plan-time cast instead of confirming an empty pre-cast people list", async () => {
    setup();
    let reads = 0;
    mocks.repo.getPeople.mockImplementation(async () => reads++ === 0 ? null : people);
    await renderScreen();
    await click("Yes, our Japan trip");
    await waitFor(() => expect(hasText("Who is this?")).toBe(true));
    expect(host.querySelectorAll('[data-face-preview="true"]').length).toBeGreaterThan(0);
  });

  it("shows a plan failure and lets the user retry it", async () => {
    setup({ createPlan: vi.fn().mockRejectedValue(new Error("planner failed")) });
    await renderScreen();
    await click("Yes, our Japan trip");
    await waitFor(() => expect(hasText("I couldn't shape this one. Try again")).toBe(true));
    const summaryReadsAtFailure = mocks.repo.getSummary.mock.calls.length;
    await act(async () => new Promise((resolve) => setTimeout(resolve, 3_100)));
    expect(mocks.repo.getSummary).toHaveBeenCalledTimes(summaryReadsAtFailure);
    await click("Try again");
    await waitFor(() => expect(mocks.repo.createPlan).toHaveBeenCalledTimes(2));
  });

  it("saves the selected role and name before asking about the next person", async () => {
    setup({ people: people.map((person) => ({ ...person, role: "other" })) }); await renderScreen();
    await click("Yes, our Japan trip");
    await click("My daughter");
    await waitFor(() => expect(mocks.confirmCast).toHaveBeenCalledWith("project-1", expect.objectContaining({ people: expect.arrayContaining([expect.objectContaining({ personId: "person-1", role: "child", name: "My daughter" })]) })));
    expect(hasText("One person appears in 90 moments. Who is this?")).toBe(true);
  });

  it("does not revise a plan proposal until its asynchronous job has published it", async () => {
    setup({ people: [{ ...people[0], role: null }] }); await renderScreen();
    await click("Yes, our Japan trip");
    await click("My daughter");
    await waitFor(() => expect(mocks.confirmCast).toHaveBeenCalled());
    expect(mocks.confirmCast).toHaveBeenCalledWith("project-1", expect.not.objectContaining({ proposalId: expect.any(String) }));
  });

  it("uses the revised proposal returned by cast confirmation for direction options", async () => {
    setup({ readyPlan: true, people: [{ ...people[0], role: null }] }); await renderScreen();
    await click("Yes, our Japan trip");
    await click("My daughter");
    for (let i = 0; i < 3 && !host.querySelector('button[aria-label="Looks fine"]'); i++) {
      if (host.querySelector('button[aria-label="No, that\'s everyone"]')) await click("No, that's everyone");
      else if (host.querySelector('button[aria-label="Skip"]')) await click("Skip");
      await act(async () => new Promise((resolve) => setTimeout(resolve, 10)));
    }
    await waitFor(() => expect(hasText("Looks fine")).toBe(true));
    await click("Looks fine");
    await waitFor(() => expect(mocks.repo.getDirectionOptions).toHaveBeenCalledWith("proposal-2"));
  });

  it("uses each returned proposal ID for the next cast edit", async () => {
    setup({ readyPlan: true });
    mocks.confirmCast.mockResolvedValueOnce({ cast: { people: [] }, proposalId: "proposal-2" }).mockResolvedValueOnce({ cast: { people: [] }, proposalId: "proposal-3" });
    await renderScreen(); await click("Yes, our Japan trip");
    await click("My daughter");
    await waitFor(() => expect(mocks.confirmCast).toHaveBeenCalledTimes(1));
    await click("My partner");
    await waitFor(() => expect(mocks.confirmCast).toHaveBeenCalledTimes(2));
    expect(mocks.confirmCast.mock.calls[1]?.[1]).toEqual(expect.objectContaining({ proposalId: "proposal-2" }));
  });

  it("uses each person's age for chips and hides a self answer already assigned", async () => {
    setup({ people: [{ ...people[0], ageBand: "adult" }, { ...people[1], ageBand: "adult" }] }); await renderScreen(); await click("Yes, our Japan trip");
    expect(host.querySelector('button[aria-label="Me"]')).toBeTruthy();
    expect(host.querySelector('button[aria-label="My partner"]')).toBeTruthy();
    await click("Me");
    await waitFor(() => expect(mocks.confirmCast).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(host.querySelector('button[aria-label="Me"]')).toBeNull());
    expect(host.querySelector('button[aria-label="My partner"]')).toBeTruthy();
    expect(host.querySelector('button[aria-label="Friend"]')).toBeTruthy();
  });

  it("does not send a second cast edit while the first one is still pending", async () => {
    setup({ readyPlan: true });
    let resolveCast!: (value: any) => void;
    mocks.confirmCast.mockImplementation(() => new Promise((resolve) => { resolveCast = resolve; }));
    await renderScreen(); await click("Yes, our Japan trip");
    await click("My daughter");
    await click("Friend");
    expect(mocks.confirmCast).toHaveBeenCalledTimes(1);
    resolveCast({ cast: { people: [] }, proposalId: "proposal-2" });
  });

  it("shows face previews and only the inline Skip once the person question appears", async () => {
    setup({ people: [{ ...people[0], momentCount: 12 }, { ...people[1], momentCount: 9 }] }); await renderScreen(); await click("Yes, our Japan trip");
    expect(host.querySelectorAll('img[alt^="Person photo "]')).toHaveLength(4);
    expect(hasText("4 of 12 shown · Day 1, 2 and 3")).toBe(true);
    expect(host.querySelectorAll('button[aria-label="Skip"]')).toHaveLength(1);
    expect(hasText("Skip for now")).toBe(false);
  });

  it("Skip on the person question advances past the people step", async () => {
    setup(); await renderScreen();
    await click("Yes, our Japan trip");
    await click("Skip");
    await waitFor(() => expect(mocks.confirmCast).toHaveBeenCalled());
    expect(hasText("Skip")).toBe(true);
    expect(hasText("Family")).toBe(false);
  });

  it("shows the selected role chip label in the reply", async () => {
    setup(); await renderScreen(); await click("Yes, our Japan trip"); await click("My daughter");
    await waitFor(() => expect(hasText("My daughter")).toBe(true));
    expect(hasText("Family")).toBe(false);
  });

  it("shows the plan retry message and logs instead of rendering the API error code", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    const infoLog = vi.spyOn(console, "info").mockImplementation(() => {});
    setup({ createPlan: async () => { throw new Error("not_found"); } }); await renderScreen();
    await click("Yes, our Japan trip");
    await waitFor(() => expect(hasText("I couldn't shape this one. Try again.")).toBe(true));
    expect(hasText("not_found")).toBe(false);
    expect(hasText("Try again")).toBe(true);
    expect(infoLog).toHaveBeenCalledWith("Director chat request failed", "not_found");
    expect(errorLog.mock.calls.some(([message]) => message === "Director chat request failed")).toBe(false);
    errorLog.mockRestore(); infoLog.mockRestore();
  });

  it("renders confirmation progress in the header only", async () => {
    setup(); await renderScreen(); await click("Yes, our Japan trip");
    await waitFor(() => expect(hasText("1 of 4 confirmed")).toBe(true));
    expect(host.textContent?.match(/1 of 4 confirmed/g)).toHaveLength(1);
  });

  it("interprets typed text and waits for an explicit confirmation before saving", async () => {
    setup(); await renderScreen();
    const composer = host.querySelector('input[aria-label="Tell me anything about the story"]')!;
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(composer, "our family trip"); composer.dispatchEvent(new Event("input", { bubbles: true })); });
    await click("→");
    await waitFor(() => expect(hasText("I understood the Japan trip.")).toBe(true));
    const typed = host.querySelector('[data-from="you"]');
    const reply = [...host.querySelectorAll('[data-from="mosae"]')].find((item) => item.textContent?.includes("I understood the Japan trip."));
    expect(typed).toBeTruthy();
    expect(reply).toBeTruthy();
    expect(typed!.compareDocumentPosition(reply!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(hasText("Did I get that right?")).toBe(false);
    expect(hasText("Not quite")).toBe(true);
    expect(mocks.repo.createPlan).not.toHaveBeenCalled();
    expect(host.querySelector('button[aria-label="Yes, our Japan trip"]')).toBeFalsy();
    expect(host.textContent?.match(/0 of 4 confirmed/g) ?? []).toHaveLength(1);
    await click("Yes, that's right");
    await waitFor(() => expect(mocks.repo.createPlan).toHaveBeenCalledWith("our family trip", []));
  });

  it("discards an interpretation with Not quite and returns to the original occasion chip", async () => {
    setup(); await renderScreen();
    const composer = host.querySelector('input[aria-label="Tell me anything about the story"]')!;
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(composer, "something different"); composer.dispatchEvent(new Event("input", { bubbles: true })); });
    await click("→");
    await waitFor(() => expect(hasText("I understood the Japan trip.")).toBe(true));
    await click("Not quite");
    expect(hasText("I understood the Japan trip.")).toBe(false);
    expect(hasText("something different")).toBe(false);
    expect(host.querySelector('button[aria-label="Yes, our Japan trip"]')).toBeTruthy();
    expect(mocks.repo.createPlan).not.toHaveBeenCalled();
  });

  it("does not show an occasion answer bubble or progress until the answer is saved", async () => {
    let finish!: (value: { planId: string }) => void;
    setup({ createPlan: () => new Promise((resolve) => { finish = resolve; }) }); await renderScreen();
    await click("Yes, our Japan trip");
    expect([...host.querySelectorAll('[data-from="you"]')].some((item) => item.textContent?.includes("Yes, our Japan trip"))).toBe(false);
    expect(host.querySelector('button[aria-label="Yes, our Japan trip"]')).toBeFalsy();
    expect(host.textContent?.match(/0 of 4 confirmed/g) ?? []).toHaveLength(1);
    await act(async () => finish({ planId: "proposal-1" }));
    await waitFor(() => expect(host.querySelector('[data-from="you"]')?.textContent).toContain("Yes, our Japan trip"));
  });

  it("shows the retry message when interpretation fails and keeps the occasion reply usable", async () => {
    setup({ interpret: async () => { throw new Error("offline"); } }); await renderScreen();
    const composer = host.querySelector('input[aria-label="Tell me anything about the story"]')!;
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(composer, "something"); composer.dispatchEvent(new Event("input", { bubbles: true })); });
    await click("→");
    await waitFor(() => expect(hasText("I couldn't do that. Try again?")).toBe(true));
    expect(hasText("Try again")).toBe(true);
    expect(hasText("Yes, our Japan trip")).toBe(true);
    expect(mocks.repo.createPlan).not.toHaveBeenCalled();
  });

  it("shows Try again after a failed save and retries the save", async () => {
    let attempts = 0;
    setup({ createPlan: async () => { if (!attempts++) throw new Error("network"); return { planId: "proposal-1" }; } }); await renderScreen();
    await click("Yes, our Japan trip");
    await waitFor(() => expect(hasText("Try again")).toBe(true));
    await click("Try again");
    await waitFor(() => expect(mocks.repo.createPlan).toHaveBeenCalledTimes(2));
  });

  async function openMoments(applyEdits?: (...args: any[]) => Promise<any>, getFilm?: (...args: any[]) => Promise<any>) {
    setup({ people: [], readyPlan: true, applyEdits, getFilm }); await renderScreen();
    await click("Yes, our Japan trip");
    await waitFor(() => expect(hasText("2 of 4 confirmed")).toBe(true));
  }

  it("shows filtered-photo counts and opens the existing full review list", async () => {
    await openMoments();
    expect(hasText("I've set aside 1 blurry shot and 120 near-duplicates, keeping the best of each burst. Your originals are untouched.")).toBe(true);
    expect(host.querySelector('[aria-label="Filtered photos"]')).not.toBeNull();
    expect(host.querySelector('img[alt="Blurry photo"]')).not.toBeNull();
    await click("Blurry 1");
    expect(mocks.push).toHaveBeenCalledWith({ pathname: "/review-moments", params: { planId: "proposal-1", tab: "left-out" } });
  });

  it("skips the photo review and advances when nothing was filtered", async () => {
    const previous = planFixture.leftOut;
    planFixture.leftOut = [];
    try {
      setup({ people: [], readyPlan: true }); await renderScreen(); await click("Yes, our Japan trip");
      await waitFor(() => expect(mocks.repo.getDirectionOptions).toHaveBeenCalledWith("proposal-1"));
      expect(host.querySelector('[aria-label="Filtered photos"]')).toBeNull();
      expect(hasText("Looks fine")).toBe(false);
      expect(hasText("Any moments that must be in the film")).toBe(false);
      expect(hasText("Choose from all")).toBe(false);
      expect(hasText("Done")).toBe(false);
      expect(hasText("Sounds good. Shape it.")).toBe(true);
    } finally {
      planFixture.leftOut = previous;
    }
  });

  it("does not write plan edits for the Looks fine reply", async () => {
    await openMoments();
    await click("Looks fine");
    await waitFor(() => expect(mocks.repo.getDirectionOptions).toHaveBeenCalledWith("proposal-1"));
    expect(mocks.repo.applyEdits).not.toHaveBeenCalled();
  });

  it("loads direction options, updates the explanation for the chosen length, and directs with the chosen settings", async () => {
    await openMoments();
    await click("Looks fine");
    await waitFor(() => expect(mocks.repo.getDirectionOptions).toHaveBeenCalledWith("proposal-1"));
    expect(hasText("Warm, intimate story")).toBe(true);
    await click("4 min");
    expect(hasText("For 4 minutes, I'll keep")).toBe(true);
    await click("Lively");
    await click("Whole family");
    await click("Lots");
    await click("Playful");
    await click("Sounds good. Shape it.");
    await waitFor(() => expect(mocks.repo.directFilm).toHaveBeenCalledWith("proposal-1", expect.objectContaining({ cadenceId: "playful", durationId: "4m", focus: "family", soundtrackId: "lyria-reflective", collageAmount: "lots", motionFeel: "playful" })));
  });

  it("offers the achievable direction lengths and explains the material limit", async () => {
    setup({ people: [], readyPlan: true, maximumDurationSec: 60 }); await renderScreen();
    await click("Yes, our Japan trip");
    await waitFor(() => expect(hasText("2 of 4 confirmed")).toBe(true));
    await click("Looks fine");
    await waitFor(() => expect(mocks.repo.getDirectionOptions).toHaveBeenCalled());
    expect(host.querySelector('button[aria-label="1 min"]')?.getAttribute("aria-pressed")).toBe("true");
    expect(host.querySelector('button[aria-label="2 min"]')).toBeNull();
    expect(host.querySelector('button[aria-label="4 min"]')).toBeNull();
    expect(hasText("With these moments, I can make up to 1 min.")).toBe(true);
  });

  it("reduces the selected length when a faster pace cannot support it", async () => {
    setup({ people: [], readyPlan: true, maximumDurationSec: 65, maximumDurationSecByCadence: { reflective: 65, playful: 45.5 } }); await renderScreen();
    await click("Yes, our Japan trip");
    await waitFor(() => expect(hasText("2 of 4 confirmed")).toBe(true));
    await click("Looks fine");
    await waitFor(() => expect(mocks.repo.getDirectionOptions).toHaveBeenCalled());
    expect(host.querySelector('button[aria-label="1 min"]')?.getAttribute("aria-pressed")).toBe("true");
    await click("Lively");
    expect(host.querySelector('button[aria-label="30 sec"]')?.getAttribute("aria-pressed")).toBe("true");
    expect(host.querySelector('button[aria-label="1 min"]')).toBeNull();
    expect(hasText("With these moments, I can make up to 30 sec.")).toBe(true);
  });

  it("does not allow shaping a standard length when the moments cannot reach it", async () => {
    setup({ people: [], readyPlan: true, maximumDurationSec: 10 }); await renderScreen();
    await click("Yes, our Japan trip");
    await waitFor(() => expect(hasText("2 of 4 confirmed")).toBe(true));
    await click("Looks fine");
    await waitFor(() => expect(mocks.repo.getDirectionOptions).toHaveBeenCalled());
    expect(hasText("These moments can make about 10 seconds. Add more photos for a longer film.")).toBe(true);
    expect((host.querySelector('button[aria-label="Sounds good. Shape it."]') as HTMLButtonElement).disabled).toBe(true);
  });

  it("maps generation polling progress to the shaping checklist from zero through three", async () => {
    const earlyRender = { ...filmFixture, rendering: true, generationStatus: "rendering", renderProgress: 0.45 };
    const laterRender = { ...filmFixture, rendering: true, generationStatus: "rendering", renderProgress: 0.73 };
    const regressedRender = { ...filmFixture, rendering: true, generationStatus: "rendering", renderProgress: 0.56 };
    let resolveFirst!: (film: any) => void;
    const getFilm = vi.fn()
      .mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; }))
      .mockResolvedValueOnce(laterRender).mockResolvedValueOnce(regressedRender).mockResolvedValueOnce(filmFixture);
    await openMoments(undefined, getFilm);
    await click("Looks fine");
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
      await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
      expect(Number(progress())).toBeCloseTo(100 / 6);
      await act(async () => { resolveFirst(earlyRender); await Promise.resolve(); });
      expect(Number(progress())).toBeCloseTo((1 / 3 + 0.45 * 2 / 3) * 100);
      expect(host.querySelector('[data-step="Picked moments for each chapter"]')?.getAttribute("data-status")).toBe("done");
      expect(host.querySelector('[data-step="Trimmed the best parts of each clip"]')?.getAttribute("data-status")).toBe("current");
      expect(getFilm).toHaveBeenCalledTimes(1);
      await act(async () => { await vi.advanceTimersByTimeAsync(1499); });
      expect(getFilm).toHaveBeenCalledTimes(1);
      await act(async () => { await vi.advanceTimersByTimeAsync(1); await Promise.resolve(); });
      const afterLaterPoll = Number(progress());
      expect(afterLaterPoll).toBeCloseTo((1 / 3 + 0.73 * 2 / 3) * 100);
      expect(host.querySelector('[data-step="Trimmed the best parts of each clip"]')?.getAttribute("data-status")).toBe("done");
      expect(host.querySelector('[data-step="Film ready"]')?.getAttribute("data-status")).toBe("current");
      await act(async () => { await vi.advanceTimersByTimeAsync(1500); await Promise.resolve(); });
      expect(Number(progress())).toBe(afterLaterPoll);
      await act(async () => { await vi.advanceTimersByTimeAsync(1500); await Promise.resolve(); });
      expect(hasText("Here's your first cut. Tap to watch.")).toBe(true);
      expect(getFilm).toHaveBeenCalledTimes(4);
    } finally { vi.useRealTimers(); }
  });

  it("shows the completed film with three direction notes and opens the editor", async () => {
    planFixture.chapters = Array.from({ length: 5 }, (_, index) => ({ id: `chapter-${index}`, title: `Chapter ${index + 1}`, momentIds: [] }));
    await openMoments();
    await click("Looks fine");
    await waitFor(() => expect(hasText("Sounds good. Shape it.")).toBe(true));
    await click("Sounds good. Shape it.");
    await waitFor(() => expect(hasText("Japan, autumn")).toBe(true));
    expect(hasText("5 chapters")).toBe(true);
    expect(hasText("How I directed it")).toBe(true);
    expect(hasText("Both moments you kept are in.")).toBe(true);
    expect(hasText("I left out repeated scenery shots.")).toBe(false);
    await click("Open in editor");
    expect(mocks.push).toHaveBeenCalledWith({ pathname: "/editor", params: { projectId: "project-1", planId: "proposal-1", generationId: "film-1", request: "", repository: "api" } });
  });

  it("saves the film and opens the chat saved screen", async () => {
    await openMoments();
    await click("Looks fine");
    await waitFor(() => expect(hasText("Sounds good. Shape it.")).toBe(true));
    await click("Sounds good. Shape it.");
    await waitFor(() => expect(hasText("Save film")).toBe(true));
    await click("Save film");
    await waitFor(() => expect(mocks.repo.saveFilm).toHaveBeenCalledWith("film-1"));
    expect(mocks.push).toHaveBeenCalledWith({ pathname: "/save-film", params: { filmId: "film-1", directorChat: "true", repository: "api", projectId: "project-1" } });
  });

  it("sends Ask for a change to the editor with the request in the URL", async () => {
    await openMoments();
    await click("Looks fine");
    await waitFor(() => expect(hasText("Sounds good. Shape it.")).toBe(true));
    await click("Sounds good. Shape it.");
    await waitFor(() => expect(host.querySelector('input[aria-label="Ask for a change"]')).toBeTruthy());
    const composer = host.querySelector('input[aria-label="Ask for a change"]')!;
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(composer, "Make it shorter"); composer.dispatchEvent(new Event("input", { bubbles: true })); });
    await click("Send");
    expect(mocks.push).toHaveBeenCalledWith({ pathname: "/editor", params: { projectId: "project-1", planId: "proposal-1", generationId: "film-1", request: "Make it shorter", repository: "api" } });
    expect(mocks.repo.interpret).not.toHaveBeenCalled();
  });
});
