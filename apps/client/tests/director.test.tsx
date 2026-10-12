import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("expo-asset", () => ({ Asset: { fromModule: (module: unknown) => ({ uri: String(module) }) } }));
vi.mock("@/lib/demoAssets", () => ({ demoImage: () => 1 }));

const scrollMock = vi.hoisted(() => ({ scrollToEnd: vi.fn() }));
vi.mock("react-native", () => {
  const ScrollView = React.forwardRef(({ children, accessibilityLabel, onScrollBeginDrag: _onScrollBeginDrag, scrollEventThrottle: _scrollEventThrottle, contentContainerStyle: _contentContainerStyle, contentContainerClassName: _contentContainerClassName, keyboardShouldPersistTaps: _keyboardShouldPersistTaps, ...props }: any, ref: any) => {
    React.useImperativeHandle(ref, () => ({ scrollToEnd: scrollMock.scrollToEnd }), []);
    return React.createElement("div", { ...props, "aria-label": accessibilityLabel }, children);
  });
  const node = (tag: string) => ({ children, onPress, onChangeText, accessibilityLabel, editable, testID, style, ...props }: any) => React.createElement(tag, { ...props, style: typeof style === "function" ? style({ pressed: false }) : style, "data-testid": testID, "aria-label": props["aria-label"] ?? accessibilityLabel, disabled: props.disabled ?? (editable === false ? true : undefined), onClick: onPress, onInput: onChangeText ? (event: any) => onChangeText(event.target.value) : undefined }, children);
  const AnimatedView = node("div");
  class Value { setValue() {} }
  const animation = { start() {}, stop() {} };
  return {
    View: node("div"), ScrollView, Text: node("span"), Pressable: node("button"), TextInput: node("input"),
    Image: ({ source, accessibilityLabel, ...props }: any) => React.createElement("img", { ...props, src: source?.uri, alt: accessibilityLabel }),
    ActivityIndicator: ({ accessibilityLabel }: any) => React.createElement("span", { "aria-label": accessibilityLabel }),
    AccessibilityInfo: { isReduceMotionEnabled: async () => false, addEventListener: () => ({ remove() {} }) },
    Animated: { View: AnimatedView, Value, loop: () => animation, sequence: () => animation, timing: () => animation },
  };
});

const mocks = vi.hoisted(() => ({ repo: null as any, flowRepo: null as any, confirmCast: vi.fn(), push: vi.fn(), setParams: vi.fn(), params: {} as Record<string, string | undefined>, openPicker: vi.fn(), selectFiles: ((_: File[]) => {}) as (files: File[]) => void, uploadMedia: vi.fn(), projectId: "project-1" }));
vi.mock("expo-router", () => ({ useLocalSearchParams: () => ({ projectId: mocks.projectId, ...mocks.params }), useRouter: () => ({ back: vi.fn(), push: mocks.push, setParams: mocks.setParams }) }));
vi.mock("@mosae/core", async (importOriginal) => ({ ...(await importOriginal<typeof import("@mosae/core")>()), getStoryRepository: () => mocks.repo, uploadMedia: (...args: any[]) => mocks.uploadMedia(...args) }));
vi.mock("@/lib/characters", () => ({ confirmCast: (...args: any[]) => mocks.confirmCast(...args) }));
vi.mock("@/lib/storyFlow", () => ({ useStoryFlow: () => ({ repository: mocks.flowRepo, flow: { repository: "api", projectId: "project-1" } }) }));
vi.mock("@/components/MediaPicker", async () => {
  const ReactModule = await import("react");
  return { MediaPicker: ReactModule.forwardRef((props: any, ref: any) => { ReactModule.useImperativeHandle(ref, () => ({ open: () => { mocks.openPicker(); } }), []); mocks.selectFiles = (files: File[]) => props.onFiles(files); return null; }) };
});
vi.mock("@/components/FilmPlayer", () => ({ FilmPlayer: ({ source, aspect }: any) => React.createElement("div", { "data-testid": "film-player", "data-source": source, "data-aspect": aspect }) }));
vi.mock("@/components/editor/EditorPreview", () => ({ EditorPreview: ({ onPlayingChange }: any) => React.createElement("div", { "data-testid": "film-ready-preview" }, React.createElement("button", { "aria-label": "Mock preview playing", onClick: () => onPlayingChange?.(true) }), React.createElement("button", { "aria-label": "Mock preview paused", onClick: () => onPlayingChange?.(false) })) }));
import DirectorScreen from "../app/director";
import { defaultSoundtrackId, useDirectorChat } from "../lib/useDirectorChat";
import { getUploadProgress, setPendingMedia, setUploadFailure, setUploadPreparationProgress, setUploadProgress } from "@mosae/core";

let root: Root;
let host: HTMLDivElement;
beforeEach(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; mocks.projectId = "project-1"; mocks.params = {}; URL.createObjectURL = vi.fn(() => "blob:test-photo"); URL.revokeObjectURL = vi.fn(); setPendingMedia([]); setUploadProgress(null); setUploadPreparationProgress(null); setUploadFailure(null); mocks.uploadMedia.mockReset(); host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); setPendingMedia([]); setUploadProgress(null); setUploadPreparationProgress(null); setUploadFailure(null); host.remove(); });
async function renderScreen() { await act(async () => root.render(<DirectorScreen />)); }
async function click(label: string) {
  const find = () => host.querySelector(`button[aria-label="${label}"]`) ?? host.querySelector(`button[aria-label^="${label},"]`) ?? [...host.querySelectorAll("button")].find((item) => item.textContent?.trim() === label);
  let button = find();
  const roleChoice = ["Me", "My partner", "My daughter", "My son", "My mum", "My dad", "Friend", "Family", "This person"].includes(label);
  if (!button && roleChoice && host.querySelector('button[aria-label="Yes"]')) {
    await act(async () => host.querySelector('button[aria-label="Yes"]')!.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    button = find();
  }
  expect(button).toBeTruthy();
  await act(async () => button!.dispatchEvent(new MouseEvent("click", { bubbles: true })));
}
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
const directionOptions = { recommendation: "For these portraits, I’d suggest a gentle pace.", note: "Warm, intimate story", rewrites: [], cadences: [{ id: "reflective", name: "Gentle", description: "Unhurried" }, { id: "playful", name: "Lively", description: "Energetic" }], soundtracks: [{ id: "lyria-reflective", name: "Quiet afternoon", description: "Gentle piano" }], durations: [{ id: "30s", label: "30 sec", caption: "Quick", seconds: 30 }, { id: "1m", label: "1 min", caption: "Short", seconds: 60 }, { id: "2m", label: "2 min", caption: "Balanced", seconds: 120 }, { id: "3m", label: "3 min", caption: "Extended", seconds: 180 }, { id: "4m", label: "4 min", caption: "Long", seconds: 240 }, { id: "5m", label: "5 min", caption: "Everything", seconds: 300 }], recommendedDuration: "2m", recommendedCadence: "reflective", cadenceReason: "The photos feel calm", maximumDurationSec: 300 };
const filmFixture = { filmId: "film-1", planId: "proposal-1", version: 1, title: "Japan, autumn", subtitle: "A family trip", place: "Japan", dateLabel: "October", durationSec: 124, posterKey: "poster", savePosterKey: "poster", videoKey: "video", momentCount: 419, audioLabel: "Soft piano", shortcuts: [], status: "ready", videoUrl: "https://film.example/first-cut.mp4", rendering: false, reasons: ["Opens on the train window in Tokyo.", "Mia's reactions lead each day.", "Both moments you kept are in.", "I left out repeated scenery shots."] } as any;
function setup(options: { faces?: boolean; orientation?: { portrait: number; landscape: number; square: number; suggested: "9:16" | "16:9" | null }; interpret?: () => Promise<any>; createPlan?: () => Promise<any>; people?: any[]; readyPlan?: boolean; applyEdits?: (...args: any[]) => Promise<any>; getFilm?: (...args: any[]) => Promise<any>; getProjectResume?: (...args: any[]) => Promise<any>; saveFilm?: (...args: any[]) => Promise<any>; maximumDurationSec?: number; maximumDurationSecByCadence?: Record<string, number> } = {}) {
  const planReady = options.readyPlan ?? false;
  mocks.repo = {
    getSummary: vi.fn(async () => ({ ...summary(options.faces ?? true), ...(options.orientation ? { orientation: options.orientation } : {}), total: planReady ? 465 : 8, processed: { ingested: planReady ? 465 : 8, understood: planReady ? 465 : 8, faces: 4 }, ready: { ...summary(options.faces ?? true).ready, plan: planReady } })), getPeople: vi.fn(async () => options.people ?? people),
    createPlan: vi.fn(options.createPlan ?? (async () => ({ planId: "proposal-1" }))),
    interpret: vi.fn(options.interpret ?? (async () => ({ reply: "I understood the Japan trip.", change: { kind: "occasion", storyText: "Japan trip" } }))),
    getPlan: vi.fn(async () => planFixture), applyEdits: vi.fn(options.applyEdits ?? (async () => planFixture)), getDirectionOptions: vi.fn(async () => ({ ...directionOptions, maximumDurationSec: options.maximumDurationSec ?? directionOptions.maximumDurationSec, ...(options.maximumDurationSecByCadence ? { maximumDurationSecByCadence: options.maximumDurationSecByCadence } : {}) })), directFilm: vi.fn(async () => ({ filmId: "film-1" })), getFilm: vi.fn(options.getFilm ?? (async () => filmFixture)), getFilmTimeline: vi.fn(async () => ({ timeline: { durationSec: 124, fps: 30, aspect: "9:16", videoClips: [] }, sources: {} })), getProjectResume: vi.fn(options.getProjectResume ?? (async () => ({ proposalId: null, storyText: null, generationId: null, generationStatus: null }))), saveFilm: vi.fn(options.saveFilm ?? (async () => ({ downloadKey: "https://film.example/first-cut.mp4" }))),
  };
  mocks.flowRepo = mocks.repo;
  mocks.confirmCast.mockResolvedValue({ cast: { people: [] }, proposalId: "proposal-2" });
}

describe("Director chat", () => {
  it("defaults to the suggested soundtrack but keeps an existing explicit pick", () => {
    const options = [{ id: "first", name: "First", description: "" }, { id: "suggested", name: "Suggested", description: "", suggested: true }];
    expect(defaultSoundtrackId(null, options)).toBe("suggested");
    expect(defaultSoundtrackId("user-picked", options)).toBe("user-picked");
    expect(defaultSoundtrackId(null, [])).toBeNull();
  });
  beforeEach(() => vi.clearAllMocks());

  let recoveryProjectSequence = 0;
  const useFreshRecoveryProject = () => { mocks.projectId = `recovery-project-${++recoveryProjectSequence}`; };

  it.each([[false, "16:9"], [true, "9:16"]] as const)("uses the YouTube suggestion until the user explicitly chooses TikTok style (%s)", async (choosePortrait, expectedAspect) => {
    setup({ readyPlan: true, orientation: { portrait: 1, landscape: 7, square: 0, suggested: "16:9" }, getProjectResume: async () => ({ proposalId: "proposal-1", storyText: "Japan trip", generationId: null, generationStatus: null }) });
    await renderScreen(); await waitFor(() => expect(hasText("Looks good")).toBe(true)); await click("Looks good");
    await waitFor(() => expect(host.querySelector('button[aria-label="Yes, YouTube style"]')?.getAttribute("aria-pressed")).toBe("true"));
    if (choosePortrait) await click("TikTok style instead");
    await click("Sounds good");
    await waitFor(() => expect(mocks.repo.directFilm).toHaveBeenCalledWith("proposal-1", expect.objectContaining({ aspect: expectedAspect })));
  });

  it("renders the completed chat film card in its landscape format", async () => {
    setup({ readyPlan: true, getFilm: async () => ({ ...filmFixture, aspect: "16:9" }), getProjectResume: async () => ({ proposalId: "proposal-1", storyText: "Japan trip", generationId: "film-1", generationStatus: "playable" }) });
    await renderScreen();
    await waitFor(() => expect(host.querySelector('[data-testid="film-player"]')?.getAttribute("data-aspect")).toBe("landscape"));
  });

  it("keeps the chat history in a constrained, independently scrollable flex region", async () => {
    setup(); await renderScreen();
    const history = host.querySelector('[aria-label="Director chat history"]') as HTMLElement | null;
    expect(history).not.toBeNull();
    expect(history!.style.minHeight).toBe("0");
    expect(history!.style.flexGrow).toBe("1");
  });

  it("shows the compact upload card and occasion question while preparing", async () => {
    setup();
    setPendingMedia([new File(["photo"], "trip.jpg", { type: "image/jpeg" })]);
    setUploadPreparationProgress({ preparedFiles: 0, totalFiles: 1 });
    await renderScreen();
    expect(hasText("I'm bringing in your 1 photo. Then I'll look through them.")).toBe(true);
    expect(hasText("While they come in, tell me a little about them.")).toBe(true);
    expect(hasText("Something else? Type it in the box below.")).toBe(true);
    await waitFor(() => expect(hasText("Finding the people in them")).toBe(true));
    expect(host.querySelector('[aria-label="Uploading 0 of 1"]')).toBeTruthy();
    expect(host.querySelector('[alt^="Selected photo"]')).toBeFalsy();
    expect(host.querySelectorAll('[data-testid="upload-progress-segment"]')).toHaveLength(10);
  });

  it("shows upload counts without thumbnails or transferred megabytes", async () => {
    setup();
    setPendingMedia([new File(["photo"], "trip.jpg", { type: "image/jpeg" })]);
    setUploadPreparationProgress({ preparedFiles: 1, totalFiles: 50 });
    setUploadProgress({ totalFiles: 50, finishedFiles: 0, failedFiles: 0, bytesSent: 10, totalBytes: 100, assetStatuses: [] });
    await renderScreen();
    expect(host.querySelector('[aria-label="Uploading 0 of 50"]')).toBeTruthy();
    expect(hasText("MB transferred")).toBe(false);
    expect(host.querySelector('img[alt^="Photo "]')).toBeFalsy();
  });

  it("keeps terminal all-failed upload status visible in the chat", async () => {
    setup();
    setUploadProgress({ totalFiles: 1, finishedFiles: 0, failedFiles: 1, bytesSent: 0, totalBytes: 0 });
    setUploadFailure("None of these photos uploaded. Check your connection and try again.");
    await renderScreen();
    expect(hasText("None of these photos uploaded. Check your connection and try again.")).toBe(true);
  });

  it("requires explicit partial-failure continuation and rejects all-failed continuation", async () => {
    setup();
    setUploadProgress({ totalFiles: 2, finishedFiles: 1, failedFiles: 1, bytesSent: 1, totalBytes: 1 });
    setUploadFailure("One file couldn't upload.");
    await renderScreen();
    expect(mocks.repo.createPlan).not.toHaveBeenCalled();
    await click("Continue with uploaded files");
    expect(host.querySelector('button[aria-label="A trip"]')).toBeTruthy();
    await act(async () => setUploadProgress({ totalFiles: 2, finishedFiles: 0, failedFiles: 2, bytesSent: 0, totalBytes: 0 }));
    expect(hasText("Continue with uploaded files")).toBe(false);
    expect(hasText("Pick the missing files again")).toBe(true);
  });

  it("keeps the project open and offers file reselection when retry ownership is missing", async () => {
    useFreshRecoveryProject();
    setup();
    mocks.push.mockClear();
    mocks.openPicker.mockClear();
    setUploadProgress({ totalFiles: 2, finishedFiles: 1, failedFiles: 1, bytesSent: 1, totalBytes: 2 });
    setUploadFailure("One file couldn't upload.");
    await renderScreen();
    expect(hasText("Pick the missing files again")).toBe(true);
    const uploadCard = host.querySelector('[aria-label^="Uploading"]');
    const alert = host.querySelector('[role="alert"], [accessibilityrole="alert"]');
    expect(uploadCard && alert && Boolean(uploadCard.compareDocumentPosition(alert) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
    await click("Pick the missing files again");
    expect(mocks.push).not.toHaveBeenCalled();
    expect(mocks.openPicker).toHaveBeenCalledTimes(1);
    expect(mocks.repo.getSummary).toHaveBeenCalled();
  });

  it("uploads picker selections into the same project and records replacement targets", async () => {
    useFreshRecoveryProject();
    setup();
    mocks.push.mockClear();
    mocks.openPicker.mockClear();
    mocks.repo.getSummary.mockResolvedValue({ ...summary(), total: 2, upload: { expected: 2, settled: 2, uploaded: 1, failed: 1, failedAssetIds: ["failed-1"], failedEntries: [{ assetId: "failed-1", sessionId: "session-1" }], processingFailed: 0, cancelled: 0, closed: true } });
    await renderScreen();
    await click("Pick the missing files again");
    const selected = new File(["new photo"], "replacement.jpg", { type: "image/jpeg" });
    mocks.uploadMedia.mockImplementation(async (files: File[], options: any) => {
      expect(files).toEqual([selected]);
      expect(options.projectId).toBe(mocks.projectId);
      options.onEntryRegistered({ fileIndex: 0, file: selected, assetId: "replacement-1", sessionId: "replacement-session" });
      options.onProgress({ totalFiles: 1, finishedFiles: 1, failedFiles: 0, bytesSent: selected.size, totalBytes: selected.size, assetStatuses: [{ assetId: "replacement-1", sessionId: "replacement-session", status: "uploaded" }] });
      options.onReady({ projectId: mocks.projectId, assetIds: ["replacement-1"] });
      return { projectId: mocks.projectId, finished: 1, failed: 0, assetIds: ["replacement-1"] };
    });
    await act(async () => mocks.selectFiles([selected]));
    await waitFor(() => expect(mocks.uploadMedia).toHaveBeenCalledTimes(1));
    expect(mocks.uploadMedia.mock.calls[0]?.[1]).toMatchObject({ projectId: mocks.projectId, replacesAssetIds: ["failed-1"], replacesSessionIds: ["session-1"] });
    expect(mocks.uploadMedia).toHaveBeenCalledTimes(1);
    expect(mocks.push).not.toHaveBeenCalled();
    expect(mocks.openPicker).toHaveBeenCalledTimes(1);
  });

  it("keeps unselected transfer failures available and retries the newest failed successor", async () => {
    useFreshRecoveryProject();
    const projectId = mocks.projectId;
    setup();
    mocks.projectId = projectId;
    mocks.repo.getSummary.mockResolvedValue({ ...summary(), total: 4, upload: { expected: 4, settled: 3, uploaded: 1, failed: 2, failedAssetIds: ["failed-a", "failed-b"], failedEntries: [{ assetId: "failed-a", sessionId: "session-a" }, { assetId: "failed-b", sessionId: "session-b" }], pendingEntries: [{ assetId: "pending-c", sessionId: "session-c" }], processingFailed: 0, cancelled: 0, closed: true } });
    setUploadProgress({ totalFiles: 4, finishedFiles: 1, failedFiles: 2, bytesSent: 5, totalBytes: 20, assetStatuses: [{ assetId: "success", status: "uploaded" }, { assetId: "failed-a", sessionId: "session-a", status: "failed" }, { assetId: "failed-b", sessionId: "session-b", status: "failed" }] });
    setUploadFailure("Two files couldn't upload.");
    await renderScreen();
    await waitFor(() => expect(hasText("Pick the missing files again")).toBe(true));
    const selectedA = new File(["replacement a"], "replacement-a.jpg", { type: "image/jpeg" });
    const firstCalls: any[] = [];
    mocks.uploadMedia.mockImplementation(async (files: File[], options: any) => {
      firstCalls.push({ files, options });
      const failed = false;
      const assetId = `successor-${firstCalls.length}`;
      const sessionId = `new-session-${firstCalls.length}`;
      options.onEntryRegistered({ fileIndex: 0, file: files[0], assetId, sessionId });
      options.onProgress({ totalFiles: files.length, finishedFiles: failed ? 0 : 1, failedFiles: failed ? 1 : 0, bytesSent: failed ? 0 : files[0]!.size, totalBytes: files[0]!.size, assetStatuses: [{ assetId, sessionId, status: failed ? "failed" : "uploaded" }] });
      if (failed) return { projectId: "project-1", finished: 0, failed: 1, assetIds: [assetId] };
      return { projectId: "project-1", finished: 1, failed: 0, assetIds: [assetId] };
    });
    await click("Pick the missing files again");
    await act(async () => mocks.selectFiles([selectedA]));
    await waitFor(() => expect(mocks.uploadMedia).toHaveBeenCalledTimes(1));
    expect(firstCalls[0]!.options).toMatchObject({ projectId, replacesAssetIds: ["failed-a"], replacesSessionIds: ["session-a"] });
    expect(hasText("Pick the missing files again")).toBe(true);
    expect(getUploadProgress()).toMatchObject({ totalFiles: 4, finishedFiles: 2, failedFiles: 1 });

    await click("Pick the missing files again");
    await act(async () => mocks.selectFiles([selectedA]));
    await waitFor(() => expect(mocks.uploadMedia).toHaveBeenCalledTimes(2));
    expect(firstCalls[1]!.options).toMatchObject({ projectId, replacesAssetIds: ["failed-b"], replacesSessionIds: ["session-b"] });
    expect(getUploadProgress()).toMatchObject({ totalFiles: 4 });
    await click("Pick the missing files again");
    await act(async () => mocks.selectFiles([selectedA]));
    await waitFor(() => expect(mocks.uploadMedia).toHaveBeenCalledTimes(3));
    expect(firstCalls[2]!.options).toMatchObject({ projectId, replacesAssetIds: ["pending-c"], replacesSessionIds: ["session-c"] });
    expect(getUploadProgress()).toMatchObject({ totalFiles: 4, finishedFiles: 4, failedFiles: 0 });
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it("retries a picker replacement against each newest failed successor", async () => {
    useFreshRecoveryProject();
    const projectId = mocks.projectId;
    setup();
    mocks.repo.getSummary.mockResolvedValue({ ...summary(), total: 2, upload: { expected: 2, settled: 2, uploaded: 1, failed: 1, failedAssetIds: ["failed-original"], failedEntries: [{ assetId: "failed-original", sessionId: "session-original" }], processingFailed: 0, cancelled: 0, closed: true } });
    setPendingMedia([], [], projectId);
    setUploadProgress({ totalFiles: 2, finishedFiles: 1, failedFiles: 1, bytesSent: 5, totalBytes: 20, assetStatuses: [{ assetId: "success", status: "uploaded" }, { assetId: "failed-original", sessionId: "session-original", status: "failed" }] });
    setUploadFailure("One file couldn't upload.");
    await renderScreen();
    const selected = new File(["retry"], "retry.jpg", { type: "image/jpeg" });
    const calls: any[] = [];
    mocks.uploadMedia.mockImplementation(async (files: File[], options: any) => {
      calls.push({ files, options });
      const attempt = calls.length;
      const assetId = `successor-${attempt}`;
      const sessionId = `session-${attempt}`;
      options.onEntryRegistered({ fileIndex: 0, file: files[0], assetId, sessionId });
      options.onProgress({ totalFiles: 1, finishedFiles: attempt === 3 ? 1 : 0, failedFiles: attempt === 3 ? 0 : 1, bytesSent: attempt === 3 ? selected.size : 0, totalBytes: selected.size, assetStatuses: [{ assetId, sessionId, status: attempt === 3 ? "uploaded" : "failed" }] });
      return { projectId, finished: attempt === 3 ? 1 : 0, failed: attempt === 3 ? 0 : 1, assetIds: [assetId] };
    });
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt === 0) {
        await click("Pick the missing files again");
        await act(async () => mocks.selectFiles([selected]));
      } else {
        await waitFor(() => expect(host.querySelector('button[aria-label="Retry uploads"]')?.hasAttribute("disabled")).toBe(false));
        await click("Retry uploads");
      }
      await waitFor(() => expect(mocks.uploadMedia).toHaveBeenCalledTimes(attempt + 1));
      expect(getUploadProgress()).toMatchObject({ totalFiles: 2, finishedFiles: 1 + (attempt === 2 ? 1 : 0), failedFiles: attempt === 2 ? 0 : 1 });
    }
    expect(calls.map(({ options }) => [options.replacesAssetIds, options.replacesSessionIds])).toEqual([
      [["failed-original"], ["session-original"]],
      [["successor-1"], ["session-1"]],
      [["successor-2"], ["session-2"]],
    ]);
    expect(calls.every(({ options }) => options.projectId === projectId)).toBe(true);
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it("does not upload, navigate, or clear failure when the opened picker is cancelled", async () => {
    useFreshRecoveryProject();
    setup();
    setPendingMedia([new File(["a"], "a.jpg", { type: "image/jpeg" }), new File(["b"], "b.jpg", { type: "image/jpeg" })], [], mocks.projectId);
    setUploadProgress({ totalFiles: 2, finishedFiles: 0, failedFiles: 2, bytesSent: 0, totalBytes: 20 });
    setUploadFailure("Two files couldn't upload.");
    await renderScreen();
    await waitFor(() => expect(hasText("Pick the missing files again")).toBe(true));
    await click("Pick the missing files again");
    expect(mocks.openPicker).toHaveBeenCalledTimes(1);
    expect(mocks.uploadMedia).not.toHaveBeenCalled();
    expect(mocks.push).not.toHaveBeenCalled();
    expect(hasText("Two files couldn't upload.")).toBe(true);
  });

  it("locks rapid duplicate picker selections before the first upload settles", async () => {
    useFreshRecoveryProject();
    setup();
    setPendingMedia([new File(["missing"], "missing.jpg", { type: "image/jpeg" })], [], mocks.projectId);
    setUploadProgress({ totalFiles: 1, finishedFiles: 0, failedFiles: 1, bytesSent: 0, totalBytes: 10 });
    setUploadFailure("One file couldn't upload.");
    let complete!: () => void;
    mocks.uploadMedia.mockImplementation(() => new Promise((resolve) => { complete = () => resolve({ projectId: "project-1", finished: 1, failed: 0, assetIds: ["new-a"] }); }));
    await renderScreen();
    await waitFor(() => expect(hasText("Pick the missing files again")).toBe(true));
    const selected = new File(["same"], "same.jpg", { type: "image/jpeg" });
    await click("Pick the missing files again");
    await act(async () => { mocks.selectFiles([selected]); mocks.selectFiles([selected]); });
    expect(mocks.uploadMedia).toHaveBeenCalledTimes(1);
    complete();
  });

  it("accepts an early free-text story and plans automatically when preparation completes", async () => {
    setup(); setUploadPreparationProgress({ totalFiles: 1, preparedFiles: 0 });
    await renderScreen();
    const composer = host.querySelector('input[aria-label="Tell me anything about the story"]')!;
    await act(async () => { (composer as HTMLInputElement).value = "Mia's birthday"; composer.dispatchEvent(new Event("input", { bubbles: true })); });
    await click("Send");
    expect(hasText("Mia's birthday")).toBe(true);
    expect(mocks.repo.interpret).not.toHaveBeenCalled();
    expect(mocks.repo.createPlan).not.toHaveBeenCalled();
    const followUp = host.querySelector('input[aria-label="Tell me anything about the story"]')!;
    await act(async () => { (followUp as HTMLInputElement).value = "The trip was sunny"; followUp.dispatchEvent(new Event("input", { bubbles: true })); });
    await click("Send");
    expect(hasText("Mia's birthday")).toBe(true);
    expect(hasText("The trip was sunny")).toBe(true);
    await act(async () => setUploadPreparationProgress(null));
    await waitFor(() => expect(mocks.repo.createPlan).toHaveBeenCalledWith("Mia's birthday\nThe trip was sunny", []));
    expect(hasText("Mia's birthday")).toBe(true);
  });

  it("guards rapid repeated confirmations before React rerenders", async () => {
    setup({ createPlan: () => new Promise(() => {}) }); await renderScreen();
    const button = host.querySelector('button[aria-label="A trip"]')!;
    await act(async () => { button.dispatchEvent(new MouseEvent("click", { bubbles: true })); button.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    expect(mocks.repo.createPlan).toHaveBeenCalledTimes(1);
  });

  it("scrolls the director history to the newest message after an occasion chip action", async () => {
    setup(); await renderScreen();
    scrollMock.scrollToEnd.mockClear();
    await click("A trip");
    await waitFor(() => expect(scrollMock.scrollToEnd).toHaveBeenCalled());
  });

  it("shows the ready summary and starts the story intent when the occasion reply is tapped", async () => {
    setup(); await renderScreen();
    await waitFor(() => expect(hasText("Tell me a little about them. Is it a trip, a birthday celebration, or something else?")).toBe(true));
    expect(hasText("Your 8 photos are uploaded.")).toBe(true);
    expect(hasText("Uploaded your photos")).toBe(true);
    expect(hasText("Looked through all of them")).toBe(true);
    expect(hasText("Found the people in them")).toBe(true);
    expect(hasText("I've looked through all 8")).toBe(false);
    expect(hasText("While they come in, tell me a little about them.")).toBe(false);
    expect(host.querySelectorAll('[data-testid="upload-progress-segment"]')).toHaveLength(10);
    await click("A trip");
    await waitFor(() => expect(mocks.repo.createPlan).toHaveBeenCalledWith("Japan trip", []));
    expect(hasText("A trip")).toBe(true);
  });

  it("asks openly without a confirmation chip when the summary has no meaningful suggestion", async () => {
    setup(); mocks.repo.getSummary.mockResolvedValue({ ...summary(), places: [], country: null, season: null }); await renderScreen();
    await waitFor(() => expect(hasText("Tell me a little about them. Is it a trip, a birthday celebration, or something else?")).toBe(true));
    expect(host.querySelector('button[aria-label="A trip"]')).toBeTruthy();
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
    await waitFor(() => expect(host.querySelector('[data-testid="film-player"]')).not.toBeNull());
    expect(host.querySelector('[data-testid="film-player"]')?.getAttribute("data-source")).toBe(filmFixture.videoUrl);
    expect(host.querySelector('[data-testid="film-player"]')?.getAttribute("data-aspect")).toBe("portrait");
    expect(host.querySelector('[data-testid="film-ready-preview"]')).toBeNull();
    expect(mocks.repo.getProjectResume).toHaveBeenCalledOnce();
    expect(mocks.repo.getFilm).toHaveBeenCalledWith("film-1");
    expect(mocks.repo.getFilmTimeline).toHaveBeenCalledWith("project-1", "film-1");
  });

  it("keeps the live preview interactive and framed as portrait before an MP4 exists", async () => {
    setup({
      readyPlan: true,
      getFilm: async () => ({ ...filmFixture, videoUrl: null }),
      getProjectResume: async () => ({ proposalId: "proposal-1", storyText: "Our family trip to Japan", generationId: "film-1", generationStatus: "rendering" }),
    });
    await renderScreen();
    await waitFor(() => expect(host.querySelector('[data-testid="film-ready-preview"]')).not.toBeNull());
    expect(host.querySelector('[data-testid="film-player"]')).toBeNull();
    expect(host.querySelector('[style*="aspect-ratio: 0.5625"]')).not.toBeNull();
    expect(hasText("▶")).toBe(true);
    await click("Mock preview playing");
    expect(hasText("▶")).toBe(false);
    await click("Mock preview paused");
    expect(hasText("▶")).toBe(true);
  });

  it("shows the real poster and an unavailable state when the live preview fails", async () => {
    setup({
      readyPlan: true,
      getFilm: async () => ({ ...filmFixture, videoUrl: null }),
      getProjectResume: async () => ({ proposalId: "proposal-1", storyText: "Our family trip to Japan", generationId: "film-1", generationStatus: "rendering" }),
    });
    mocks.repo.getFilmTimeline.mockRejectedValueOnce(new Error("preview unavailable"));
    await renderScreen();
    await waitFor(() => expect(host.querySelector('[alt="Film poster"]')).not.toBeNull());
    expect((host.querySelector('[alt="Film poster"]') as HTMLImageElement).src).toContain("poster");
    expect(hasText("Preview unavailable")).toBe(true);
    expect(host.querySelector('[data-testid="film-ready-preview"]')).toBeNull();
  });

  it("opens an already saved generation in the Player and marks it saved", async () => {
    setup({
      readyPlan: true,
      getFilm: async () => ({ ...filmFixture, generationStatus: "saved" }),
      getProjectResume: async () => ({ proposalId: "proposal-1", storyText: "Our family trip to Japan", generationId: "film-1", generationStatus: "saved" }),
    });
    await renderScreen();
    await waitFor(() => expect(host.querySelector('[data-testid="film-player"]')).not.toBeNull());
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
    await waitFor(() => expect(host.querySelector('[data-testid="film-player"]')).not.toBeNull());
    expect(mocks.repo.getFilm).toHaveBeenCalledTimes(1);
    expect(mocks.repo.getFilmTimeline).toHaveBeenCalledWith("project-1", "film-1");
  });

  it("uses a safe fallback story intent when the summary has no detected places", async () => {
    setup();
    mocks.repo.getSummary.mockResolvedValue({ ...summary(), places: [] });
    await renderScreen();
    await click("A trip");
    await waitFor(() => expect(mocks.repo.createPlan).toHaveBeenCalledWith("Japan trip", []));
  });

  it("shows people processing and Skip for now while faces are still pending", async () => {
    setup({ faces: false }); await renderScreen();
    await click("A trip");
    expect(hasText("Finding the faces in your trip")).toBe(true);
    expect(hasText("Skip for now")).toBe(true);
  });

  it("waits for the plan-time cast instead of confirming an empty pre-cast people list", async () => {
    setup();
    let reads = 0;
    mocks.repo.getPeople.mockImplementation(async () => reads++ === 0 ? null : people);
    await renderScreen();
    await click("A trip");
    await waitFor(() => expect(hasText("Who's this? They're in")).toBe(true));
    expect(host.querySelector('button[aria-label="My daughter"]')).toBeTruthy();
    expect(host.querySelector('button[aria-label="Type a name"]')).toBeTruthy();
    await click("Type a name");
    expect(host.querySelector('input[aria-label="Person name"]')).toBeTruthy();
    expect((host.querySelector('input[aria-label="Person name"]') as HTMLInputElement | null)?.placeholder).toBe("What's their name?");
    expect(host.querySelectorAll('[data-face-preview="true"]').length).toBeGreaterThan(0);
  });

  it("shows a plan failure and lets the user retry it", async () => {
    setup({ createPlan: vi.fn().mockRejectedValue(new Error("planner failed")) });
    await renderScreen();
    await click("A trip");
    await waitFor(() => expect(hasText("I couldn't shape this one. Try again")).toBe(true));
    expect(host.querySelector('button[aria-label="A trip"]')).toBeFalsy();
    expect(hasText("A trip")).toBe(true);
    const summaryReadsAtFailure = mocks.repo.getSummary.mock.calls.length;
    await act(async () => new Promise((resolve) => setTimeout(resolve, 3_100)));
    expect(mocks.repo.getSummary).toHaveBeenCalledTimes(summaryReadsAtFailure);
    await click("Try again");
    await waitFor(() => expect(mocks.repo.createPlan).toHaveBeenCalledTimes(2));
  });

  it("saves the selected role and name before asking about the next person", async () => {
    setup({ people: people.map((person) => ({ ...person, role: "other" })) }); await renderScreen();
    await click("A trip");
    await click("My daughter");
    await waitFor(() => expect(mocks.confirmCast).toHaveBeenCalledWith("project-1", expect.objectContaining({ people: expect.arrayContaining([expect.objectContaining({ personId: "person-1", role: "child", name: "My daughter" })]) })));
    expect(hasText("Who's this? They're in")).toBe(true);
  });

  it("confirms a story-mentioned son on the top face cluster and saves Yes as My son", async () => {
    setup({ people: [...people, { personId: "person-3", name: null, role: null, ageBand: "adult", momentCount: 5, sampleShotIds: [], sampleFaces: [], days: [2] }], interpret: async () => ({ reply: "Children's Day celebration", change: { kind: "occasion", storyText: "Children's Day celebration", mentionedPeople: ["son"] } }) }); await renderScreen();
    const composer = host.querySelector('input[aria-label="Tell me anything about the story"]')!;
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(composer, "My son children day celebration"); composer.dispatchEvent(new Event("input", { bubbles: true })); });
    await click("→"); await click("Yes, that's right");
    await waitFor(() => expect(hasText("A Children's Day celebration for your son — lovely!")).toBe(true));
    await waitFor(() => expect(hasText("Is this your son?")).toBe(true));
    expect(host.querySelectorAll('[data-face-preview="true"]')).toHaveLength(2);
    expect([...host.querySelectorAll('img[alt^="Person photo "]')].map((image) => image.getAttribute("src"))).toEqual(["https://thumb.test/a", "https://thumb.test/b"]);
    expect(host.querySelector('img[alt="Photo 1"]')).toBeNull();
    expect(host.querySelector('button[aria-label="Yes"]')).toBeTruthy();
    expect(host.querySelector('button[aria-label="Someone else"]')).toBeTruthy();
    await click("Yes");
    await waitFor(() => expect(mocks.confirmCast).toHaveBeenCalledWith("project-1", expect.objectContaining({ people: expect.arrayContaining([expect.objectContaining({ personId: "person-1", name: "My son", role: "child" })]) })));
    expect(host.querySelector('button[aria-label="My partner"]')).toBeTruthy();
    expect(hasText("Three people appear often in your moments. Who is this?")).toBe(true);
  });

  it("runs story, per-person photo review and tagging, summary, options, and preview in order", async () => {
    setup({ readyPlan: true, people: [...people, { personId: "person-3", name: null, role: null, ageBand: "adult", momentCount: 5, sampleShotIds: [], sampleFaces: [], days: [2] }] });
    await renderScreen();
    await click("A trip");

    expect(hasText("Who's this? They're in")).toBe(true);
    expect(host.querySelector('button[aria-label="My daughter"]')).toBeTruthy();
    expect(host.querySelector('button[aria-label="Type a name"]')).toBeTruthy();
    expect(host.querySelectorAll('button[aria-label="Tap to select"]')).toHaveLength(0);
    expect(host.querySelector('button[aria-label="A trip"]')).toBeNull();

    await click("Type a name");
    expect(host.querySelector('input[aria-label="Person name"]')).toBeTruthy();
    expect((host.querySelector('input[aria-label="Person name"]') as HTMLInputElement | null)?.placeholder).toBe("What's their name?");
    await click("My daughter");
    await waitFor(() => expect(hasText("Who's this? They're in")).toBe(true));
    expect(host.querySelector('button[aria-label="Not the same person? Tag it"]')).toBeTruthy();

    await click("Not the same person? Tag it");
    expect(mocks.push).toHaveBeenCalledWith(expect.objectContaining({ pathname: "/tag-moments", params: expect.objectContaining({ personId: "person-2", source: "identity" }) }));
    mocks.params = { completedPersonId: "person-2", completedPersonName: "this person", completedMomentCount: "3" };
    await renderScreen();
    await waitFor(() => expect(hasText("Who's this? They're in")).toBe(true));
    expect(host.querySelector('button[aria-label="Not the same person? Tag it"]')).toBeTruthy();
    expect(host.querySelectorAll('button[aria-label="Tap to select"]')).toHaveLength(0);
    await click("Type a name");

    const personName = host.querySelector('input[aria-label="Person name"]')!;
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(personName, "Noah"); personName.dispatchEvent(new Event("input", { bubbles: true })); });
    await click("Save name");
    await waitFor(() => expect(hasText("Who's this? They're in 5 of your moments.")).toBe(true));
    await click("Me");
    await waitFor(() => expect(host.querySelector('button[aria-label="Confirm"]')).toBeTruthy());
    await waitFor(() => expect(host.querySelector('button[aria-label="Confirm"]')).toBeTruthy());
    expect(host.querySelector('button[aria-label="Change"]')).toBeTruthy();
    expect(host.querySelector('button[aria-label="Skip for now"]')).toBeNull();
    expect(hasText("Three people appear often in your moments. Who is this?")).toBe(true);
    expect(hasText("Who's this? They're in 212 of your moments.")).toBe(true);
    expect(hasText("Noah")).toBe(true);
    await click("Confirm");

    expect(hasText("Who's this? They're in 212 of your moments.")).toBe(true);
    expect(hasText("Noah")).toBe(true);
    await waitFor(() => expect(host.querySelector('[aria-label="Filtered photos"]')).not.toBeNull());
    await click("Looks good");
    await waitFor(() => expect(hasText("Sounds good")).toBe(true));
    expect(hasText("Length")).toBe(false);
    expect(host.querySelector('button[aria-label="Fix people"]')).toBeNull();
    await click("Sounds good");
    await waitFor(() => expect(host.querySelector('[data-testid="film-player"]')).toBeTruthy());
    expect(host.querySelector('button[aria-label="Fix people"]')).toBeNull();
    expect(host.textContent).not.toContain("Remake the film with these changes?");
    expect(host.querySelector('button[aria-label="A trip"]')).toBeNull();
  });

  it.each(["typed name", "Tag it, return, then type a name"] as const)("asks person two after person one is answered by %s", async (path) => {
    setup({ people: [...people, { personId: "person-3", name: null, role: null, ageBand: "adult", momentCount: 5, sampleShotIds: [], sampleFaces: [], days: [2] }] });
    await renderScreen();
    await click("A trip");
    if (path === "Tag it, return, then type a name") {
      await click("Not the same person? Tag it");
      mocks.params = { completedPersonId: "person-1", completedPersonName: "this person", completedMomentCount: "3" };
      await renderScreen();
    }
    await click("Type a name");
    const nameInput = host.querySelector('input[aria-label="Person name"]')!;
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(nameInput, "Mia"); nameInput.dispatchEvent(new Event("input", { bubbles: true })); });
    await click("Save name");
    await waitFor(() => expect(host.querySelector('button[aria-label="My partner"]')).toBeTruthy());
    expect(hasText("Three people appear often in your moments. Who is this?")).toBe(true);
  });

  it("reveals existing person choices after Someone else", async () => {
    setup({ interpret: async () => ({ reply: "Children's Day celebration", change: { kind: "occasion", storyText: "Children's Day celebration", mentionedPeople: ["son"] } }) }); await renderScreen();
    const composer = host.querySelector('input[aria-label="Tell me anything about the story"]')!;
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(composer, "My son children day celebration"); composer.dispatchEvent(new Event("input", { bubbles: true })); });
    await click("→"); await click("Yes, that's right");
    expect(hasText("Is this your son?")).toBe(true);
    await click("Someone else");
    expect(host.querySelector('button[aria-label="My daughter"]')).toBeTruthy();
    await click("My daughter");
    await waitFor(() => expect(host.querySelector('button[aria-label="My partner"]')).toBeTruthy());
  });

  it("does not revise a plan proposal until its asynchronous job has published it", async () => {
    setup({ people: [{ ...people[0], role: null }] }); await renderScreen();
    await click("A trip");
    await click("My daughter");
    await waitFor(() => expect(mocks.confirmCast).toHaveBeenCalled());
    expect(mocks.confirmCast).toHaveBeenCalledWith("project-1", expect.not.objectContaining({ proposalId: expect.any(String) }));
  });

  it("uses the revised proposal returned by cast confirmation for direction options", async () => {
    setup({ readyPlan: true, people: [{ ...people[0], role: null }] }); await renderScreen();
    await click("A trip");
    await click("My daughter");
    await waitFor(() => expect(host.querySelector('button[aria-label="Confirm"]')).toBeTruthy());
    await click("Confirm");
    await waitFor(() => expect(host.querySelector('[aria-label="Filtered photos"]')).not.toBeNull());
    await click("Looks good");
    await waitFor(() => expect(mocks.repo.getDirectionOptions).toHaveBeenCalledWith("proposal-2"));
    expect(host.querySelector('button[aria-label="Sounds good"]')).toBeTruthy();
  });

  it("shows the set-aside review after confirming the people summary and defers direction options", async () => {
    setup({ readyPlan: true }); await renderScreen();
    await click("A trip");
    await click("My daughter");
    await click("My partner");
    await waitFor(() => expect(host.querySelector('button[aria-label="Confirm"]')).toBeTruthy());
    await click("Confirm");

    await waitFor(() => expect(host.querySelector('[aria-label="Filtered photos"]')).not.toBeNull());
    expect(hasText("Tap on the photos to view.")).toBe(true);
    expect(host.querySelectorAll('img[alt="Near-duplicates photo"]')).toHaveLength(4);
    expect(hasText("+116")).toBe(true);
    expect(hasText("Looks good")).toBe(true);
    expect(host.querySelector('button[aria-label="Sounds good"]')).toBeNull();
    expect(mocks.repo.getDirectionOptions).not.toHaveBeenCalled();

    await click("Looks good");
    await waitFor(() => expect(mocks.repo.getDirectionOptions).toHaveBeenCalledWith("proposal-2"));
    expect(host.querySelector('[aria-label="Filtered photos"]')).toBeNull();
    expect(host.textContent).toContain("Looks good");
  });

  it("uses each returned proposal ID for the next cast edit", async () => {
    setup({ readyPlan: true });
    mocks.confirmCast.mockResolvedValueOnce({ cast: { people: [] }, proposalId: "proposal-2" }).mockResolvedValueOnce({ cast: { people: [] }, proposalId: "proposal-3" });
    await renderScreen(); await click("A trip");
    await click("My daughter");
    await waitFor(() => expect(mocks.confirmCast).toHaveBeenCalledTimes(1));
    await click("My partner");
    await waitFor(() => expect(mocks.confirmCast).toHaveBeenCalledTimes(2));
    expect(mocks.confirmCast.mock.calls[1]?.[1]).toEqual(expect.objectContaining({ proposalId: "proposal-2" }));
  });

  it("asks before merging a repeated self answer", async () => {
    setup({ people: [{ ...people[0], ageBand: "adult" }, { ...people[1], ageBand: "adult" }] }); await renderScreen(); await click("A trip");
    expect(host.querySelector('button[aria-label="Me"]')).toBeTruthy();
    expect(host.querySelector('button[aria-label="Me"]')).toBeTruthy();
    expect(host.querySelector('button[aria-label="My partner"]')).toBeTruthy();
    await click("Me");
    await waitFor(() => expect(mocks.confirmCast).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(host.querySelector('button[aria-label="Me"]')).toBeTruthy());
    await click("Me");
    await waitFor(() => expect(mocks.confirmCast).toHaveBeenCalledTimes(2));
    expect(mocks.confirmCast.mock.calls[1]?.[1]).not.toHaveProperty("merges");
    await waitFor(() => expect(hasText("Same Me as before?")).toBe(true));
    await click("Yes, same person");
    expect(mocks.confirmCast.mock.calls[2]?.[1]).toEqual(expect.objectContaining({ merges: [{ fromPersonId: "person-2", toPersonId: "person-1" }] }));
  });

  it("does not send a second cast edit while the first one is still pending", async () => {
    setup({ readyPlan: true });
    let resolveCast!: (value: any) => void;
    mocks.confirmCast.mockImplementation(() => new Promise((resolve) => { resolveCast = resolve; }));
    await renderScreen(); await click("A trip");
    await click("My daughter");
    expect(mocks.confirmCast).toHaveBeenCalledTimes(1);
    expect(hasText("Saving your answer")).toBe(true);
    expect(host.querySelector('button[aria-label="Friend"]')).toBeTruthy();
    expect(hasText("Who's this? They're in 90 of your moments.")).toBe(true);
    await act(async () => resolveCast({ cast: { people: [] }, proposalId: "proposal-2" }));
  });

  it("shows a person answer immediately and ignores a same-frame double tap", async () => {
    setup({ readyPlan: true });
    let resolveCast!: (value: any) => void;
    mocks.confirmCast.mockImplementation(() => new Promise((resolve) => { resolveCast = resolve; }));
    await renderScreen(); await click("A trip");
    await waitFor(() => expect(host.querySelector('button[aria-label="My daughter"]')).toBeTruthy());
    const chip = host.querySelector('button[aria-label="My daughter"]')!;
    await act(async () => {
      chip.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      chip.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(mocks.confirmCast).toHaveBeenCalledTimes(1);
    expect([...host.querySelectorAll('[data-from="you"]')].some((bubble) => bubble.textContent?.includes("My daughter"))).toBe(true);
    expect(hasText("Saving your answer")).toBe(true);
    expect(host.querySelector('button[aria-label="My daughter"]')).toBeFalsy();
    await act(async () => resolveCast({ cast: { people: [] }, proposalId: "proposal-2" }));
  });

  it("restores person choices when saving the answer fails", async () => {
    setup({ readyPlan: true });
    mocks.confirmCast.mockRejectedValueOnce(new Error("offline"));
    await renderScreen(); await click("A trip");
    await waitFor(() => expect(host.querySelector('button[aria-label="My daughter"]')).toBeTruthy());
    await click("My daughter");
    await waitFor(() => expect(hasText("I couldn't do that. Try again?")).toBe(true));
    expect(host.querySelector('button[aria-label="My daughter"]')).toBeTruthy();
  });

  it("shows face previews and only the inline Skip once the person question appears", async () => {
    setup({ people: [{ ...people[0], momentCount: 12 }, { ...people[1], momentCount: 9 }] }); await renderScreen(); await click("A trip");
    expect(host.querySelectorAll('img[alt^="Person photo "]')).toHaveLength(4);
    expect(hasText("Who's this? They're in")).toBe(true);
    expect(host.querySelector('button[aria-label="My daughter"]')).toBeTruthy();
    expect(host.querySelector('button[aria-label="Type a name"]')).toBeTruthy();
    await click("Type a name");
    expect(host.querySelector('input[aria-label="Person name"]')).toBeTruthy();
    expect((host.querySelector('input[aria-label="Person name"]') as HTMLInputElement | null)?.placeholder).toBe("What's their name?");
    expect(host.querySelector('button[aria-label="Skip"]')).toBeTruthy();
  });

  it("Skip on the person question advances past the people step", async () => {
    setup(); await renderScreen();
    await click("A trip");
    await click("Skip");
    await waitFor(() => expect(mocks.confirmCast).toHaveBeenCalled());
    expect(hasText("Skip")).toBe(true);
    expect(hasText("Family")).toBe(false);
    expect(host.querySelector('button[aria-label="Me"]')).toBeTruthy();
  });

  it("shows the selected role chip label in the reply", async () => {
    setup(); await renderScreen(); await click("A trip"); await click("My daughter");
    await waitFor(() => expect(hasText("My daughter")).toBe(true));
    expect(hasText("Family")).toBe(false);
  });

  it("shows the plan retry message and logs instead of rendering the API error code", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    const infoLog = vi.spyOn(console, "info").mockImplementation(() => {});
    setup({ createPlan: async () => { throw new Error("not_found"); } }); await renderScreen();
    await click("A trip");
    await waitFor(() => expect(hasText("I couldn't shape this one. Try again.")).toBe(true));
    expect(hasText("not_found")).toBe(false);
    expect(hasText("Try again")).toBe(true);
    expect(infoLog).toHaveBeenCalledWith("Director chat request failed", "not_found");
    expect(errorLog.mock.calls.some(([message]) => message === "Director chat request failed")).toBe(false);
    errorLog.mockRestore(); infoLog.mockRestore();
  });

  it("renders confirmation progress in the header only", async () => {
    setup(); await renderScreen(); await click("A trip");
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
    expect(host.querySelector('button[aria-label="A trip"]')).toBeFalsy();
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
    expect(host.querySelector('button[aria-label="A trip"]')).toBeTruthy();
    expect(mocks.repo.createPlan).not.toHaveBeenCalled();
  });

  it("shows an early occasion answer immediately while plan creation continues", async () => {
    let finish!: (value: { planId: string }) => void;
    setup({ createPlan: () => new Promise((resolve) => { finish = resolve; }) }); await renderScreen();
    await click("A trip");
    expect([...host.querySelectorAll('[data-from="you"]')].some((item) => item.textContent?.includes("A trip"))).toBe(true);
    expect(host.querySelector('button[aria-label="A trip"]')).toBeFalsy();
    expect(hasText("Looked through all of them")).toBe(true);
    await act(async () => finish({ planId: "proposal-1" }));
    await waitFor(() => expect(host.querySelector('[data-from="you"]')?.textContent).toContain("A trip"));
  });

  it("reveals the ready people step before plan creation resolves", async () => {
    let finish!: (value: { planId: string }) => void;
    setup({ createPlan: () => new Promise((resolve) => { finish = resolve; }) });
    let chat!: ReturnType<typeof useDirectorChat>;
    function Harness() { chat = useDirectorChat("project-1", mocks.repo); return null; }
    await act(async () => root.render(<Harness />));
    await act(async () => chat.actions.answerOccasion("A trip", "Japan trip"));
    expect(chat.state.step).toBe("people");
    expect(chat.state.items.some((item) => item.kind === "person")).toBe(true);
    await act(async () => finish({ planId: "proposal-1" }));
  });

  it("keeps the answered story intent when plan creation fails", async () => {
    setup({ createPlan: async () => { throw new Error("offline"); } });
    let chat!: ReturnType<typeof useDirectorChat>;
    function Harness() { chat = useDirectorChat("project-1", mocks.repo); return null; }
    await act(async () => root.render(<Harness />));
    await act(async () => chat.actions.answerOccasion("A trip", "Japan trip"));
    await waitFor(() => expect(chat.error).toContain("couldn't shape"));
    expect(chat.state.items.some((item) => item.kind === "occasion-question")).toBe(false);
    expect(chat.state.items.some((item) => item.kind === "person")).toBe(true);
  });

  it("ignores an older flow snapshot after the story answer is acknowledged", async () => {
    setup();
    let reads = 0;
    const old = { revision: 0, story: { answer: null, storySummary: null, mentionedPeople: [] }, people: [] };
    mocks.repo.getFlow = vi.fn(async () => { reads++; return old; });
    mocks.repo.mutateFlow = vi.fn(async (_projectId: string, _actionId: string, action: any) => ({ revision: 1, story: { answer: action.answer, storySummary: "Japan trip", mentionedPeople: [] }, people: [] }));
    let chat!: ReturnType<typeof useDirectorChat>;
    function Harness() { chat = useDirectorChat("project-1", mocks.repo); return null; }
    await act(async () => root.render(<Harness />));
    await waitFor(() => expect(reads).toBeGreaterThan(0));
    await act(async () => chat.actions.answerOccasion("A trip", "Japan trip"));
    await waitFor(() => expect(chat.state.items.some((item) => item.kind === "you" && item.text === "A trip")).toBe(true));
    expect(chat.state.step).toBe("people");
    expect(chat.state.items.some((item) => item.kind === "occasion-question")).toBe(false);
  });

  it("keeps asking each main person when a flow snapshot refresh arrives between answers", async () => {
    const threePeople = [...people, { personId: "person-3", name: null, role: null, ageBand: "adult", momentCount: 5, sampleShotIds: [], sampleFaces: [], days: [2] }];
    setup({ readyPlan: true, people: threePeople });
    let revision = 1;
    mocks.repo.getFlow = vi.fn(async () => ({ revision, story: { answer: "A trip", storySummary: "Japan trip", mentionedPeople: [] }, people: [] }));
    let chat!: ReturnType<typeof useDirectorChat>;
    function Harness() { chat = useDirectorChat("project-1", mocks.repo); return null; }
    await act(async () => root.render(<Harness />));
    await act(async () => chat.actions.answerOccasion("A trip", "Japan trip"));
    await waitFor(() => expect(chat.state.items.some((item) => item.kind === "person" && item.personId === "person-1")).toBe(true));

    await act(async () => chat.actions.setPerson("person-1", "My daughter"));
    expect(chat.state.items.some((item) => item.kind === "person" && item.personId === "person-2")).toBe(true);
    revision++;
    await act(async () => { chat.retry(); await new Promise((resolve) => setTimeout(resolve, 0)); });
    expect(chat.state.items.some((item) => item.kind === "person" && item.personId === "person-2")).toBe(true);

    await act(async () => chat.actions.setPerson("person-2", "My mum"));
    expect(chat.state.items.some((item) => item.kind === "person" && item.personId === "person-3")).toBe(true);
    await act(async () => chat.actions.setPerson("person-3", "My dad"));
    expect(chat.state.items.some((item) => item.kind === "people-summary")).toBe(true);
  });

  it("uses typed text on an active person card as that person's name", async () => {
    setup();
    let chat!: ReturnType<typeof useDirectorChat>;
    function Harness() { chat = useDirectorChat("project-1", mocks.repo); return null; }
    await act(async () => root.render(<Harness />));
    await waitFor(() => expect(chat.state.items.some((item) => item.kind === "occasion-question")).toBe(true));
    await act(async () => chat.actions.answerOccasion("A trip", "Japan trip"));
    await waitFor(() => expect(chat.state.step).toBe("people"));
    await act(async () => chat.actions.send("  Kara  "));
    expect(mocks.repo.interpret).not.toHaveBeenCalled();
    expect(mocks.confirmCast).toHaveBeenCalledWith("project-1", expect.objectContaining({ people: expect.arrayContaining([expect.objectContaining({ personId: "person-1", name: "Kara" })]) }));
    expect(chat.state.items.some((item) => item.kind === "person" && item.personId === "person-1")).toBe(false);
    expect(chat.state.items.some((item) => item.kind === "you" && item.text === "Kara")).toBe(true);
    expect(chat.state.items.some((item) => item.kind === "person" && item.personId === "person-2")).toBe(true);
  });

  it("confirms a pending person interpretation when the user types yes", async () => {
    setup({ readyPlan: true, interpret: async () => ({ reply: "Rename them Emma?", change: { kind: "person", personId: "person-1", name: "Emma", role: "child" } }) });
    let chat!: ReturnType<typeof useDirectorChat>;
    function Harness() { chat = useDirectorChat("project-1", mocks.repo); return null; }
    await act(async () => root.render(<Harness />));
    await act(async () => chat.actions.answerOccasion("A trip", "Japan trip"));
    await act(async () => chat.actions.setPerson("person-1", "My daughter"));
    await act(async () => chat.actions.setPerson("person-2", "My son"));
    await act(async () => chat.actions.confirmPeople());
    await act(async () => chat.actions.confirmPeopleSummary());
    await act(async () => chat.actions.send("Rename Emma"));
    expect(chat.pendingInterpret?.change?.kind).toBe("person");
    await act(async () => chat.actions.send("Yes"));
    expect(chat.pendingInterpret).toBeNull();
    expect(mocks.confirmCast).toHaveBeenLastCalledWith("project-1", expect.objectContaining({ people: expect.arrayContaining([expect.objectContaining({ personId: "person-1", name: "Emma", role: "child" })]) }));
  });

  it("uses non-confirmation text as the active person's answer while an interpretation is pending", async () => {
    setup({ readyPlan: true, interpret: async () => ({ reply: "Rename them Emma?", change: { kind: "person", personId: "person-1", name: "Emma", role: "child" } }) });
    let chat!: ReturnType<typeof useDirectorChat>;
    function Harness() { chat = useDirectorChat("project-1", mocks.repo); return null; }
    await act(async () => root.render(<Harness />));
    await act(async () => chat.actions.answerOccasion("A trip", "Japan trip"));
    await act(async () => chat.actions.setPerson("person-1", "My daughter"));
    await act(async () => chat.actions.setPerson("person-2", "My son"));
    await act(async () => chat.actions.confirmPeople());
    await act(async () => chat.actions.confirmPeopleSummary());
    await act(async () => chat.actions.send("Rename Emma"));
    expect(chat.pendingInterpret?.change?.kind).toBe("person");

    await act(async () => chat.actions.reopenPeople());
    await waitFor(() => expect(chat.state.items.some((item) => item.kind === "person" && item.personId === "person-1")).toBe(true));
    const interpretCalls = mocks.repo.interpret.mock.calls.length;
    await act(async () => chat.actions.send("Kara"));
    expect(chat.pendingInterpret).toBeNull();
    expect(mocks.repo.interpret).toHaveBeenCalledTimes(interpretCalls);
    expect(mocks.confirmCast).toHaveBeenLastCalledWith("project-1", expect.objectContaining({ people: expect.arrayContaining([expect.objectContaining({ personId: "person-1", name: "Kara" })]) }));
    expect(chat.state.items.some((item) => item.kind === "people-summary")).toBe(true);
  });

  it("applies a pending person interpretation from the confirmation button action", async () => {
    setup({ readyPlan: true, interpret: async () => ({ reply: "Rename them Emma?", change: { kind: "person", personId: "person-1", name: "Emma", role: "child" } }) });
    let chat!: ReturnType<typeof useDirectorChat>;
    function Harness() { chat = useDirectorChat("project-1", mocks.repo); return null; }
    await act(async () => root.render(<Harness />));
    await act(async () => chat.actions.answerOccasion("A trip", "Japan trip"));
    await act(async () => chat.actions.setPerson("person-1", "My daughter"));
    await act(async () => chat.actions.setPerson("person-2", "My son"));
    await act(async () => chat.actions.confirmPeople());
    await act(async () => chat.actions.confirmPeopleSummary());
    await act(async () => chat.actions.send("Rename Emma"));
    await act(async () => chat.actions.confirmInterpret());
    expect(chat.pendingInterpret).toBeNull();
    expect(mocks.confirmCast).toHaveBeenLastCalledWith("project-1", expect.objectContaining({ people: expect.arrayContaining([expect.objectContaining({ personId: "person-1", name: "Emma", role: "child" })]) }));
  });

  it("keeps a named person when a later refresh returns a stale unnamed row", async () => {
    setup();
    let chat!: ReturnType<typeof useDirectorChat>;
    function Harness() { chat = useDirectorChat("project-1", mocks.repo); return null; }
    await act(async () => root.render(<Harness />));
    await act(async () => chat.actions.answerOccasion("A trip", "Japan trip"));
    await act(async () => chat.actions.setPerson("person-1", "Type a name", "Emily"));
    await act(async () => { chat.retry(); await new Promise((resolve) => setTimeout(resolve, 0)); });
    expect(chat.people.find((person) => person.personId === "person-1")?.name).toBe("Emily");
    expect(chat.state.items.some((item) => item.kind === "occasion-question")).toBe(false);
  });

  it("shows the people summary after the last existing person is answered", async () => {
    setup();
    let chat!: ReturnType<typeof useDirectorChat>;
    function Harness() { chat = useDirectorChat("project-1", mocks.repo); return null; }
    await act(async () => root.render(<Harness />));
    await act(async () => chat.actions.answerOccasion("A trip", "Japan trip"));
    await act(async () => chat.actions.setPerson("person-1", "Type a name", "Emily"));
    await act(async () => chat.actions.setPerson("person-2", "My son"));
    expect(chat.state.items.some((item) => item.kind === "people-summary")).toBe(true);
    await act(async () => chat.actions.confirmPeopleSummary());
    expect(chat.state.step).toBe("moments");
    expect(chat.state.items.some((item) => item.kind === "occasion-question")).toBe(false);
    expect(chat.state.items.some((item) => item.kind === "you" && item.text === "A trip")).toBe(true);
  });

  it("shows the retry message when interpretation fails and keeps the occasion reply usable", async () => {
    setup({ interpret: async () => { throw new Error("offline"); } }); await renderScreen();
    const composer = host.querySelector('input[aria-label="Tell me anything about the story"]')!;
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(composer, "something"); composer.dispatchEvent(new Event("input", { bubbles: true })); });
    await click("→");
    await waitFor(() => expect(hasText("I couldn't do that. Try again?")).toBe(true));
    expect(hasText("Try again")).toBe(true);
    expect(hasText("A trip")).toBe(true);
    expect(mocks.repo.createPlan).not.toHaveBeenCalled();
  });

  it("shows Try again after a failed save and retries the save", async () => {
    let attempts = 0;
    setup({ createPlan: async () => { if (!attempts++) throw new Error("network"); return { planId: "proposal-1" }; } }); await renderScreen();
    await click("A trip");
    await waitFor(() => expect(hasText("Try again")).toBe(true));
    await click("Try again");
    await waitFor(() => expect(mocks.repo.createPlan).toHaveBeenCalledTimes(2));
  });

  async function openMoments(applyEdits?: (...args: any[]) => Promise<any>, getFilm?: (...args: any[]) => Promise<any>) {
    setup({ people: [], readyPlan: true, applyEdits, getFilm }); await renderScreen();
    await click("A trip");
    await waitFor(() => expect(hasText("2 of 4 confirmed")).toBe(true));
  }

  it("shows filtered-photo counts and opens the existing full review list", async () => {
    await openMoments();
    expect(hasText("I've set aside 1 blurry shot and 120 near-duplicates, keeping the best of each burst. Your originals are untouched.")).toBe(true);
    expect(host.querySelector('[aria-label="Filtered photos"]')).not.toBeNull();
    expect(host.querySelector('img[alt="Blurry photo"]')).not.toBeNull();
    await click("+116");
    expect(mocks.push).toHaveBeenCalledWith({ pathname: "/review-moments", params: { planId: "proposal-1", tab: "left-out" } });
  });

  it("skips the photo review and advances when nothing was filtered", async () => {
    const previous = planFixture.leftOut;
    planFixture.leftOut = [];
    try {
      setup({ people: [], readyPlan: true }); await renderScreen(); await click("A trip");
      await waitFor(() => expect(mocks.repo.getDirectionOptions).toHaveBeenCalledWith("proposal-1"));
      expect(host.querySelector('[aria-label="Filtered photos"]')).toBeNull();
      expect(hasText("Looks good")).toBe(false);
      expect(hasText("Any moments that must be in the film")).toBe(false);
      expect(hasText("Choose from all")).toBe(false);
      expect(hasText("Done")).toBe(false);
      expect(hasText("Sounds good")).toBe(true);
    } finally {
      planFixture.leftOut = previous;
    }
  });

  it("does not write plan edits for the Looks good reply", async () => {
    await openMoments();
    await click("Looks good");
    await waitFor(() => expect(mocks.repo.getDirectionOptions).toHaveBeenCalledWith("proposal-1"));
    expect(mocks.repo.applyEdits).not.toHaveBeenCalled();
  });

  it.each([["Mia", "child", "Mia"], [null, "parent", "Parent"], [null, "other", "This person"]])("selects the sole included person and submits their focus (%s)", async (name, role, label) => {
    setup({ people: [{ ...people[0], name, role }], readyPlan: true, getProjectResume: async () => ({ proposalId: "proposal-1", storyText: "Japan trip", generationId: null, generationStatus: null }) });
    await renderScreen();
    await waitFor(() => expect(hasText("Looks good")).toBe(true));
    await click("Looks good");
    await waitFor(() => expect(host.querySelector(`button[aria-label="${label}"]`)?.getAttribute("aria-pressed")).toBe("true"));
    expect(host.querySelectorAll('button[aria-label="Sounds good"]')).toHaveLength(1);
    await click("Sounds good");
    await waitFor(() => expect(mocks.repo.directFilm).toHaveBeenCalledWith("proposal-1", expect.objectContaining({ focus: "person-1", note: expect.stringContaining(`Focus: ${label}.`) })));
  });

  it("defaults several people to Everyone and preserves an explicit person across pace changes", async () => {
    setup({ people: people.map((person, index) => ({ ...person, name: index ? "Ben" : "Mia", role: "other" })), readyPlan: true, getProjectResume: async () => ({ proposalId: "proposal-1", storyText: "Japan trip", generationId: null, generationStatus: null }) });
    await renderScreen();
    await waitFor(() => expect(hasText("Looks good")).toBe(true));
    await click("Looks good");
    expect(host.querySelector('button[aria-label="Everyone"]')?.getAttribute("aria-pressed")).toBe("true");
    await click("Ben"); await click("Lively");
    expect(host.querySelector('button[aria-label="1 min"]')).toBeNull();
    expect(host.querySelector('button[aria-label="Ben"]')?.getAttribute("aria-pressed")).toBe("true");
    await click("Sounds good");
    await waitFor(() => expect(mocks.repo.directFilm).toHaveBeenCalledWith("proposal-1", expect.objectContaining({ focus: "person-2" })));
  });

  it("loads direction options without exposing duration choice and directs with the other chosen settings", async () => {
    await openMoments();
    await click("Looks good");
    await waitFor(() => expect(mocks.repo.getDirectionOptions).toHaveBeenCalledWith("proposal-1"));
    expect(hasText(directionOptions.recommendation)).toBe(true);
    expect(hasText("Warm, intimate story")).toBe(false);
    expect(hasText("I'll focus on")).toBe(true);
    expect(hasText("Length")).toBe(false);
    expect(host.querySelector('button[aria-label="4 min"]')).toBeNull();
    await click("Lively");
    await click("The moments");
    await click("Lots");
    await click("Playful");
    await click("Sounds good");
    await waitFor(() => expect(mocks.repo.directFilm).toHaveBeenCalledWith("proposal-1", expect.objectContaining({ cadenceId: "playful", durationId: "2m", focus: "family", soundtrackId: "lyria-reflective", collageAmount: "lots", motionFeel: "playful" })));
  });

  it("restores selected direction controls after generation creation fails and resubmits them", async () => {
    await openMoments();
    await click("Looks good");
    await waitFor(() => expect(hasText("Sounds good")).toBe(true));
    expect(host.querySelector('button[aria-label="4 min"]')).toBeNull();
    await click("Lively");
    await click("The moments");
    await click("Lots");
    await click("Playful");
    mocks.repo.directFilm.mockRejectedValueOnce(new Error("503"));
    await click("Sounds good");
    await waitFor(() => expect(hasText("I couldn't do that. Try again?")).toBe(true));
    expect(host.querySelector('button[aria-label="Sounds good"]')).toBeTruthy();
    expect(host.querySelector('button[aria-label="4 min"]')).toBeNull();
    await click("Try again");
    expect(mocks.repo.directFilm).toHaveBeenCalledTimes(1);
    await click("Sounds good");
    await waitFor(() => expect(host.querySelector('[data-testid="film-player"]')).toBeTruthy());
    expect(mocks.repo.directFilm).toHaveBeenCalledTimes(2);
    expect(mocks.repo.directFilm.mock.calls[1]).toEqual(mocks.repo.directFilm.mock.calls[0]);
    expect(mocks.repo.directFilm.mock.calls[1][1]).toMatchObject({ cadenceId: "playful", focus: "family", collageAmount: "lots", motionFeel: "playful" });
  });

  it("removes all user-facing duration choices while the server budget still directs", async () => {
    setup({ people: [], readyPlan: true, maximumDurationSec: 60 }); await renderScreen();
    await click("A trip");
    await waitFor(() => expect(hasText("Looks good")).toBe(true));
    await click("Looks good");
    await waitFor(() => expect(hasText("Sounds good")).toBe(true));
    expect(hasText("Length")).toBe(false);
    expect(host.querySelectorAll('button[aria-label="1 min"], button[aria-label="2 min"], button[aria-label="Short"]')).toHaveLength(0);
    expect(hasText("Make it longer?")).toBe(false);
    await click("Sounds good");
    await waitFor(() => expect(mocks.repo.directFilm).toHaveBeenCalled());
    expect(mocks.repo.directFilm.mock.calls[0]?.[1]).toMatchObject({ durationId: "1m" });
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
    await click("Looks good");
    await waitFor(() => expect(hasText("Sounds good")).toBe(true));
    await waitFor(() => expect((host.querySelector('button[aria-label="Sounds good"]') as HTMLButtonElement).disabled).toBe(false));
    vi.useFakeTimers();
    try {
      await click("Sounds good");
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

  it("shows a failed generation reason in chat and retries composition", async () => {
    const failed = Object.assign(new Error("short duration exceeds available material"), { code: "generation_failed" });
    const getFilm = vi.fn().mockRejectedValueOnce(failed).mockResolvedValue(filmFixture);
    await openMoments(undefined, getFilm);
    await click("Looks good");
    await waitFor(() => expect(hasText("Sounds good")).toBe(true));
    await click("Sounds good");

    await waitFor(() => expect(hasText("short duration exceeds available material")).toBe(true));
    expect(hasText("Shaping your film")).toBe(false);
    expect([...host.querySelectorAll("button")].some((button) => button.textContent?.trim() === "Try again")).toBe(true);
    await click("Try again");

    await waitFor(() => expect(mocks.repo.directFilm).toHaveBeenCalledTimes(2));
  });

  it("shows the completed film with three direction notes and opens the editor", async () => {
    planFixture.chapters = Array.from({ length: 5 }, (_, index) => ({ id: `chapter-${index}`, title: `Chapter ${index + 1}`, momentIds: [] }));
    await openMoments();
    await click("Looks good");
    await waitFor(() => expect(hasText("Sounds good")).toBe(true));
    await click("Sounds good");
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
    await click("Looks good");
    await waitFor(() => expect(hasText("Sounds good")).toBe(true));
    await click("Sounds good");
    await waitFor(() => expect(hasText("Save film")).toBe(true));
    await click("Save film");
    await waitFor(() => expect(mocks.repo.saveFilm).toHaveBeenCalledWith("film-1"));
    expect(mocks.push).toHaveBeenCalledWith({ pathname: "/save-film", params: { filmId: "film-1", directorChat: "true", repository: "api", projectId: "project-1" } });
  });

  it("sends Ask for a change to the editor with the request in the URL", async () => {
    await openMoments();
    await click("Looks good");
    await waitFor(() => expect(hasText("Sounds good")).toBe(true));
    await click("Sounds good");
    await waitFor(() => expect(host.querySelector('input[aria-label="Ask for a change"]')).toBeTruthy());
    const composer = host.querySelector('input[aria-label="Ask for a change"]')!;
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(composer, "Make it shorter"); composer.dispatchEvent(new Event("input", { bubbles: true })); });
    await click("Send");
    expect(mocks.push).toHaveBeenCalledWith({ pathname: "/editor", params: { projectId: "project-1", planId: "proposal-1", generationId: "film-1", request: "Make it shorter", repository: "api" } });
    expect(mocks.repo.interpret).not.toHaveBeenCalled();
  });

  it("answers a mid-flow question inline during the automated understand phase without disrupting the flow", async () => {
    setup({ interpret: async () => ({ reply: "Your photos are uploading — one moment.", change: { kind: "note" } }) });
    let chat!: ReturnType<typeof useDirectorChat>;
    function Harness() { chat = useDirectorChat("project-1", mocks.repo); return null; }
    await act(async () => root.render(<Harness />));
    await act(async () => chat.retry());
    await act(async () => chat.actions.send("how long will this take?"));
    expect(chat.state.items.some(item => item.kind === "you" && item.id === "interp-question-1" && item.text === "how long will this take?")).toBe(true);
    expect(chat.state.items.some(item => item.kind === "mosae" && item.id === "interp-reply-1" && item.text === "Your photos are uploading — one moment.")).toBe(true);
    expect(mocks.repo.createPlan).not.toHaveBeenCalled();
  });

  it("shows Thinking before interpretation resolves and ignores overlapping sends", async () => {
    let resolveInterpret!: (value: any) => void;
    setup({ interpret: () => new Promise((resolve) => { resolveInterpret = resolve; }) });
    let chat!: ReturnType<typeof useDirectorChat>;
    function Harness() { chat = useDirectorChat("project-1", mocks.repo); return null; }
    await act(async () => root.render(<Harness />));
    await act(async () => chat.retry());
    let pending!: Promise<void>;
    await act(async () => { pending = chat.actions.send("how long will this take?"); });
    expect(chat.state.items.some(item => item.kind === "typing" && item.id === "interp-typing" && item.text === "Thinking")).toBe(true);
    await act(async () => chat.actions.send("another question"));
    expect(mocks.repo.interpret).toHaveBeenCalledTimes(1);
    await act(async () => { resolveInterpret({ reply: "Almost there.", change: { kind: "note" } }); await pending; });
    expect(chat.state.items.some(item => item.kind === "mosae" && item.id === "interp-reply-1" && item.text === "Almost there.")).toBe(true);
  });
});

it("waits for a fresh server snapshot after local transfer completes", async () => {
  setup(); setUploadProgress({ totalFiles: 2, finishedFiles: 1, failedFiles: 0, bytesSent: 1, totalBytes: 2 });
  await renderScreen();
  mocks.repo.getSummary.mockImplementationOnce(() => new Promise(() => {}));
  await act(async () => setUploadProgress({ totalFiles: 2, finishedFiles: 2, failedFiles: 0, bytesSent: 2, totalBytes: 2 }));
  expect(host.querySelector('button[aria-label="A trip"]')).toBeTruthy();
  expect(mocks.repo.createPlan).not.toHaveBeenCalled();
});

function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }

it("discards an older upload-epoch refresh after a newer not-ready response", async () => {
  setup();
  const oldSummary = deferred<any>();
  mocks.repo.getSummary.mockImplementationOnce(() => oldSummary.promise);
  await renderScreen();
  await act(async () => setUploadPreparationProgress({ totalFiles: 1, preparedFiles: 0 }));
  mocks.repo.getSummary.mockResolvedValue({ ...summary(), ready: { ...summary().ready, story: false } });
  await act(async () => setUploadPreparationProgress(null));
  expect(host.querySelector('button[aria-label="A trip"]')).toBeTruthy();
  await act(async () => oldSummary.resolve({ ...summary(), ready: { ...summary().ready, story: true } }));
  expect(mocks.repo.createPlan).not.toHaveBeenCalled();
});

it("clears deferred story notes on project switch and rejects the old in-flight refresh", async () => {
  setup(); setUploadPreparationProgress({ totalFiles: 1, preparedFiles: 0 }); await renderScreen();
  const composer = host.querySelector('input[aria-label="Tell me anything about the story"]')!;
  await act(async () => { (composer as HTMLInputElement).value = "Project A birthday"; composer.dispatchEvent(new Event("input", { bubbles: true })); });
  await click("Send");
  const oldSummary = deferred<any>();
  mocks.repo.getSummary.mockImplementationOnce(() => oldSummary.promise);
  await act(async () => setUploadPreparationProgress(null));
  mocks.projectId = "project-b";
  await renderScreen();
  expect(hasText("Project A birthday")).toBe(false);
  await act(async () => oldSummary.resolve({ ...summary(), country: "France" }));
  expect(hasText("France")).toBe(false);
  await click("A trip");
  expect(mocks.repo.createPlan).toHaveBeenCalledWith("Japan trip", []);
});

it("keeps the newest refresh within the same upload epoch", async () => {
  setup();
  const older = deferred<any>();
  mocks.repo.getSummary.mockImplementationOnce(() => older.promise);
  let chat!: ReturnType<typeof useDirectorChat>;
  function Harness() { chat = useDirectorChat("project-1", mocks.repo); return null; }
  await act(async () => root.render(<Harness />));
  mocks.repo.getSummary.mockResolvedValue({ ...summary(), ready: { ...summary().ready, story: false } });
  await act(async () => chat.retry());
  await act(async () => older.resolve({ ...summary(), ready: { ...summary().ready, story: true } }));
  expect(chat.state.items.some(item => item.kind === "occasion-question")).toBe(true);
});

it("accepts valid slow polling responses even when they exceed the polling interval", async () => {
  vi.useFakeTimers();
  try {
    setup();
    mocks.repo.getSummary.mockImplementation(() => new Promise(resolve => setTimeout(() => resolve({ ...summary(), ready: { ...summary().ready, story: true } }), 4000)));
    let chat!: ReturnType<typeof useDirectorChat>;
    function Harness() { chat = useDirectorChat("project-1", mocks.repo); return null; }
    await act(async () => root.render(<Harness />));
    await act(async () => vi.advanceTimersByTimeAsync(4000));
    expect(chat.state.items.some(item => item.kind === "occasion-question")).toBe(true);
    await act(async () => vi.advanceTimersByTimeAsync(6000));
    expect(chat.state.items.some(item => item.kind === "occasion-question")).toBe(true);
    expect(mocks.repo.getSummary).toHaveBeenCalledTimes(2);
    await act(async () => root.render(null));
  } finally { vi.useRealTimers(); }
});

it("allows slow resumed-project dependencies to finish before the next poll", async () => {
  vi.useFakeTimers();
  try {
    setup({ readyPlan: true, getProjectResume: () => new Promise(resolve => setTimeout(() => resolve({ proposalId: "proposal-1", storyText: "Saved story", generationId: "film-1", generationStatus: "saved" }), 4000)) });
    let chat!: ReturnType<typeof useDirectorChat>;
    function Harness() { chat = useDirectorChat("project-1", mocks.repo); return null; }
    await act(async () => root.render(<Harness />));
    await act(async () => vi.advanceTimersByTimeAsync(4000));
    expect(chat.state.items.some(item => item.kind === "film")).toBe(true);
    await act(async () => root.render(null));
  } finally { vi.useRealTimers(); }
});

it("finishes slow direction loading after the resumed plan is published", async () => {
  vi.useFakeTimers();
  try {
    setup({ readyPlan: true, people: [], getProjectResume: async () => ({ proposalId: "proposal-1", storyText: "Saved story", generationId: null, generationStatus: null }) });
    mocks.repo.getPlan.mockResolvedValue({ ...planFixture, leftOut: [] });
    mocks.repo.getDirectionOptions.mockImplementation(() => new Promise(resolve => setTimeout(() => resolve(directionOptions), 4000)));
    let chat!: ReturnType<typeof useDirectorChat>;
    function Harness() { chat = useDirectorChat("project-1", mocks.repo); return null; }
    await act(async () => root.render(<Harness />));
    await act(async () => vi.advanceTimersByTimeAsync(4000));
    expect(chat.directionOptions).toEqual(directionOptions);
    await act(async () => root.render(null));
  } finally { vi.useRealTimers(); }
});

it.each([undefined, "For these portraits, I’d suggest a gentle pace."])("restores contextual recommendation for generated film %s", async (copy) => {
  setup({ readyPlan: true, people: [], getProjectResume: async () => ({ proposalId: "proposal-1", storyText: "Portraits", generationId: "film-1", generationStatus: "saved" }) });
  mocks.repo.getPlan.mockResolvedValue({ ...planFixture, directionRecommendation: copy });
  let chat!: ReturnType<typeof useDirectorChat>;
  function Harness() { chat = useDirectorChat("project-1", mocks.repo); return null; }
  await act(async () => root.render(<Harness />));
  await waitFor(() => expect(chat.state.items.some(item => item.kind === "film")).toBe(true));
  expect(chat.state.items.find(item => item.id === "direction-question")).toMatchObject({ text: copy ?? "For these moments, I’d suggest this." });
  expect(mocks.repo.getDirectionOptions).not.toHaveBeenCalled();
});

it("submits one generation for rapid confirmation and recovers a transient film polling failure without replacing its generation", async () => {
  setup({ readyPlan: true, people: [], getProjectResume: async () => ({ proposalId: "proposal-1", storyText: "Saved story", generationId: null, generationStatus: null }) });
  mocks.repo.getPlan.mockResolvedValue({ ...planFixture, leftOut: [] });
  const generation = deferred<{ filmId: string }>();
  mocks.repo.directFilm.mockImplementation(() => generation.promise);
  mocks.repo.getFilm.mockRejectedValue(new Error("film unavailable"));
  let chat!: ReturnType<typeof useDirectorChat>;
  function Harness() { chat = useDirectorChat("project-1", mocks.repo); return null; }
  await act(async () => root.render(<Harness />));
  await waitFor(() => expect(chat.directionOptions).toBeTruthy());
  await act(async () => { void chat.actions.shapeIt(); void chat.actions.shapeIt(); });
  expect(mocks.repo.directFilm).toHaveBeenCalledTimes(1);
  await act(async () => generation.resolve({ filmId: "film-1" }));
  await waitFor(() => expect(chat.error).toBeTruthy());
  expect(chat.state.step).toBe("shaping");
  mocks.repo.getFilm.mockResolvedValue(filmFixture);
  await act(async () => { chat.retry(); chat.retry(); await chat.actions.shapeIt(); });
  await waitFor(() => expect(chat.state.items.some(item => item.kind === "film")).toBe(true));
  expect(mocks.repo.getFilm).toHaveBeenCalledTimes(2);
  expect(mocks.repo.getFilm).toHaveBeenLastCalledWith("film-1");
  expect(mocks.repo.directFilm).toHaveBeenCalledTimes(1);
});

it("restores selected direction after a terminal composition failure for explicit resubmission", async () => {
  setup({ readyPlan: true, people: [], getProjectResume: async () => ({ proposalId: "proposal-1", storyText: "Saved story", generationId: null, generationStatus: null }) });
  mocks.repo.getPlan.mockResolvedValue({ ...planFixture, leftOut: [] });
  mocks.repo.getFilm.mockRejectedValueOnce(Object.assign(new Error("composition failed"), { code: "generation_failed" })).mockResolvedValue(filmFixture);
  let chat!: ReturnType<typeof useDirectorChat>;
  function Harness() { chat = useDirectorChat("project-1", mocks.repo); return null; }
  await act(async () => root.render(<Harness />));
  await waitFor(() => expect(chat.directionOptions).toBeTruthy());
  await act(async () => chat.actions.setDirection({ motionFeel: "playful", collageAmount: "lots" }));
  await act(async () => chat.actions.shapeIt());
  await waitFor(() => expect(chat.error).toBeTruthy());
  expect(chat.state.step).toBe("direction");
  expect(chat.directionSelection).toMatchObject({ motionFeel: "playful", collageAmount: "lots" });
  await act(async () => chat.actions.shapeIt());
  await waitFor(() => expect(chat.state.items.some(item => item.kind === "film")).toBe(true));
  expect(mocks.repo.directFilm).toHaveBeenCalledTimes(2);
});

it("recovers a resumed generation whose initial film read fails", async () => {
  setup({ readyPlan: true, people: [], getProjectResume: async () => ({ proposalId: "proposal-1", storyText: "Saved story", generationId: "film-1", generationStatus: "composing" }) });
  mocks.repo.getFilm.mockRejectedValueOnce(new Error("temporary unavailable")).mockRejectedValueOnce(new Error("still unavailable")).mockResolvedValue(filmFixture);
  let chat!: ReturnType<typeof useDirectorChat>;
  function Harness() { chat = useDirectorChat("project-1", mocks.repo); return null; }
  await act(async () => root.render(<Harness />));
  await waitFor(() => expect(chat.error).toBeTruthy());
  await act(async () => chat.retry());
  await waitFor(() => expect(chat.state.items.some(item => item.kind === "film")).toBe(true));
  expect(mocks.repo.directFilm).not.toHaveBeenCalled();
});

it("allows explicit new composition after a resumed terminal failure", async () => {
  setup({ readyPlan: true, people: [], getProjectResume: async () => ({ proposalId: "proposal-1", storyText: "Saved story", generationId: "film-1", generationStatus: "failed" }) });
  mocks.repo.getFilm.mockRejectedValue(Object.assign(new Error("composition failed"), { code: "generation_failed" }));
  let chat!: ReturnType<typeof useDirectorChat>;
  function Harness() { chat = useDirectorChat("project-1", mocks.repo); return null; }
  await act(async () => root.render(<Harness />));
  await waitFor(() => expect(chat.error).toBeTruthy());
  await waitFor(() => expect(chat.directionOptions).toBeTruthy());
  expect(chat.state.step).toBe("direction");
  mocks.repo.getFilm.mockResolvedValue(filmFixture);
  await act(async () => chat.actions.shapeIt());
  await waitFor(() => expect(chat.state.items.some(item => item.kind === "film")).toBe(true));
});

it("retries missing direction options after resumed terminal failure without replacing a generation", async () => {
  setup({ readyPlan: true, people: [], getProjectResume: async () => ({ proposalId: "proposal-1", storyText: "Saved story", generationId: "film-1", generationStatus: "failed" }) });
  mocks.repo.getFilm.mockRejectedValue(Object.assign(new Error("composition failed"), { code: "generation_failed" }));
  mocks.repo.getDirectionOptions.mockRejectedValueOnce(new Error("options temporarily unavailable"))
    .mockResolvedValue({ ...directionOptions, collageAmount: "few", motionFeel: "calm" });
  let chat!: ReturnType<typeof useDirectorChat>;
  function Harness() { chat = useDirectorChat("project-1", mocks.repo); return null; }
  await act(async () => root.render(<Harness />));
  await waitFor(() => expect(chat.error).toBeTruthy());
  expect(chat.directionOptions).toBeNull();
  await act(async () => chat.actions.setDirection({ collageAmount: "lots", motionFeel: "playful" }));
  await act(async () => { chat.retry(); chat.retry(); });
  await waitFor(() => expect(chat.directionOptions).toBeTruthy());
  expect(chat.error).toBeNull();
  expect(chat.directionSelection).toMatchObject({ collageAmount: "lots", motionFeel: "playful" });
  expect(mocks.repo.directFilm).not.toHaveBeenCalled();
  mocks.repo.getFilm.mockResolvedValue(filmFixture);
  await act(async () => { void chat.actions.shapeIt(); void chat.actions.shapeIt(); });
  await waitFor(() => expect(chat.state.items.some(item => item.kind === "film")).toBe(true));
  expect(mocks.repo.directFilm).toHaveBeenCalledTimes(1);
  expect(mocks.repo.directFilm.mock.calls[0][1]).toMatchObject({ collageAmount: "lots", motionFeel: "playful" });
});
