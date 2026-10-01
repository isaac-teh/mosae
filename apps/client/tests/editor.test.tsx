import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Timeline } from "@mosae/contracts";

const boundary = vi.hoisted(() => ({ repository: {} as any, params: { projectId: "p1", generationId: "g1", planId: undefined as string | undefined, repository: "fixture", request: undefined as string | undefined }, back: vi.fn(), push: vi.fn(), navigate: vi.fn() }));
vi.mock("expo-router", () => ({ useLocalSearchParams: () => boundary.params, useRouter: () => ({ back: boundary.back, push: boundary.push, navigate: boundary.navigate }) }));
vi.mock("@/lib/storyFlow", () => ({ useStoryFlow: () => ({ repository: boundary.repository, flow: { repository: "api", projectId: "p1" } }) }));
vi.mock("@/components/editor/EditorPreview", () => ({ EditorPreview: ({ playheadSec, pauseRequest, togglePlayRequest }: any) => React.createElement("div", { "data-testid": "preview", "data-playhead-sec": playheadSec, "data-pause-request": pauseRequest, "data-toggle-play-request": togglePlayRequest }) }));
vi.mock("expo-asset", () => ({ Asset: { fromModule: () => ({ uri: "fixture.jpg" }) } }));
vi.mock("react-native-svg", () => {
  const element = (tag: string) => ({ children, ...props }: any) => React.createElement(tag, props, children);
  return { default: element("svg"), Path: element("path"), Circle: element("circle"), G: element("g") };
});
vi.mock("react-native", () => {
  const element = (tag: string) => ({ children, onPress, onChangeText, accessibilityLabel, accessibilityState, ...props }: any) =>
    React.createElement(tag, { ...props, ...(accessibilityLabel ? { "aria-label": accessibilityLabel } : {}), ...(accessibilityState?.selected !== undefined ? { "aria-pressed": String(accessibilityState.selected) } : {}), onClick: onPress, onInput: onChangeText ? (event: any) => onChangeText(event.target.value) : undefined }, children);
  const ScrollView = ({ children, accessibilityLabel, onScrollBeginDrag, onScroll, ...props }: any) => React.createElement("div", { ...props, ...(accessibilityLabel ? { "aria-label": accessibilityLabel } : {}), onDoubleClick: accessibilityLabel === "Unified timeline" ? () => { onScrollBeginDrag?.(); onScroll?.({ nativeEvent: { contentOffset: { x: 160 } } }); } : undefined }, children);
  return { View: element("div"), ScrollView, Text: element("span"), Pressable: element("button"), TextInput: element("input"), Image: ({ source, ...props }: any) => React.createElement("img", { ...props, src: source?.uri }), Share: { share: vi.fn() }, Linking: { openURL: vi.fn() }, useWindowDimensions: () => ({ width: 390, height: 844 }) };
});

import EditorScreen from "../app/editor";
import { useEditor } from "../lib/useEditor";
import { SaveState } from "../components/editor/SaveState";

const firstCut: Timeline = {
  schemaVersion: 1, projectId: "p1", mode: "memory", aspect: "9:16", fps: 30,
  durationSec: 9, chapters: [{ title: "Opening", startSec: 0 }],
  videoClips: ["a", "b", "c"].map((id, index) => ({ id, source: { kind: "photo", shotId: `shot-${id}` }, startSec: index * 3, durationSec: 3, transitionIn: { kind: "cut", durationSec: 0 } })),
  audioClips: [], captions: [],
};

function repository() {
  return {
    getFilmTimeline: vi.fn(async () => ({ timeline: firstCut, sources: { "shot-a": "a.jpg", "shot-b": "b.jpg", "shot-c": "c.jpg" } })),
    getEdits: vi.fn(async () => ({ revision: 0, ops: [], updatedAt: null })),
    getPlan: vi.fn(async (planId: string) => ({ planId, moments: [], leftOut: [] })),
    getDirectionOptions: vi.fn(async () => ({ soundtracks: [{ id: "lyria-playful", name: "Sandcastle Days", description: "Upbeat" }] })),
    interpretEdit: vi.fn(async () => ({ reply: "Move the last photo earlier?", ops: [{ op: "move" as const, clipId: "c", toIndex: 0 }] })),
    saveEdits: vi.fn(async (_projectId: string, _generationId: string, revision: number, ops: unknown[]) => ({ revision, ops, updatedAt: 1 })),
    renderRevision: vi.fn(async () => ({ renderId: "render-1" })),
    getRender: vi.fn(async (_projectId: string, _generationId: string, revision: number) => ({ revision, status: "ready" as const, downloadUrl: `https://film.test/revision-${revision}.mp4` })),
    saveFilm: vi.fn(async () => ({ downloadKey: "first-cut.mp4" })),
  };
}

function Harness() {
  const editor = useEditor("p1", "g1", boundary.repository);
  return <div>
    <span data-testid="order">{editor.timeline?.videoClips.map((clip) => "kind" in clip ? clip.clipId : clip.id).join(",")}</span>
    <span data-testid="ops">{JSON.stringify(editor.ops)}</span>
    <span data-testid="state">{editor.save.state}</span>
    <span data-testid="download-url">{editor.downloadUrl}</span>
    <span role="alert">{editor.editError}</span>
    <SaveState save={editor.save} onReload={() => void editor.reloadAfterConflict()} />
    <button aria-label="Move c first" onClick={() => editor.apply({ op: "move", clipId: "c", toIndex: 0 })}>Move c first</button>
    <button aria-label="Move c second" onClick={() => editor.apply({ op: "move", clipId: "c", toIndex: 1 })}>Move c second</button>
    <button aria-label="Move b first" onClick={() => editor.apply({ op: "move", clipId: "b", toIndex: 0 })}>Move b first</button>
    <button aria-label="Apply two edits" onClick={() => editor.applyMany([{ op: "move", clipId: "c", toIndex: 0 }, { op: "move", clipId: "b", toIndex: 0 }])}>Apply two edits</button>
    <button aria-label="Apply rejected edit" onClick={() => editor.apply({ op: "remove", clipId: "missing" })}>Apply rejected edit</button>
    <button aria-label="Undo" onClick={editor.undo}>Undo</button>
    <button aria-label="Redo" onClick={editor.redo}>Redo</button>
    <button aria-label="Reload" onClick={() => void editor.reloadAfterConflict()}>Reload</button>
    <button aria-label="Save film" onClick={() => void editor.render()}>Save film</button>
    <button aria-label="Back to first cut" onClick={() => editor.reset([])}>Back to first cut</button>
  </div>;
}

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  boundary.repository = repository();
  boundary.params = { projectId: "p1", generationId: "g1", planId: undefined, repository: "fixture", request: undefined };
  boundary.back.mockReset();
  boundary.push.mockReset();
  boundary.navigate.mockReset();
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); });
async function render(component: React.ReactNode) { await act(async () => root.render(component)); }
async function click(label: string) {
  const button = host.querySelector(`[aria-label="${label}"]`) as HTMLButtonElement | null;
  expect(button).not.toBeNull();
  await act(async () => button!.click());
}
async function advance(ms: number) { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); }

describe("film editor", () => {
  it("loads the first cut into a selectable clip strip", async () => {
    await render(<EditorScreen />);
    expect([...host.querySelectorAll('[aria-label^="Select clip "]')].map((element) => element.getAttribute("aria-label"))).toEqual(["Select clip a", "Select clip b", "Select clip c"]);
    expect(host.textContent).toContain("Opening");
    expect(host.textContent).toContain("Edit film");
  });

  it("pauses playback and follows the centre playhead when a timeline drag begins", async () => {
    await render(<EditorScreen />);
    const timeline = host.querySelector('[aria-label="Unified timeline"]') as HTMLDivElement;
    await act(async () => timeline.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })));
    expect(host.querySelector('[data-testid="preview"]')?.getAttribute("data-pause-request")).toBe("1");
    expect(Number(host.querySelector('[data-testid="preview"]')?.getAttribute("data-playhead-sec"))).toBe(4);
  });

  it("puts playback beside the editor time and sends play toggles to the preview", async () => {
    await render(<EditorScreen />);
    expect(host.querySelector('[aria-label="Play film"]')).not.toBeNull();
    expect(host.querySelector('[aria-label="Fullscreen"]')).toBeNull();
    await click("Play film");
    expect(host.querySelector('[data-testid="preview"]')?.getAttribute("data-toggle-play-request")).toBe("1");
  });

  it("keeps only Remove, Add and Ask in the editor toolbar", async () => {
    await render(<EditorScreen />);
    for (const name of ["Swap", "Trim", "Move"]) expect(host.querySelector(`[aria-label="${name}"]`)).toBeNull();
    for (const name of ["Remove", "Add", "Ask"]) expect(host.querySelector(`[aria-label="${name}"]`)).not.toBeNull();
  });

  it("reorders a timeline clip after a 300 ms hold and saves one move operation", async () => {
    await render(<EditorScreen />);
    const pointer = (type: string, clientX: number) => {
      const event = new Event(type, { bubbles: true });
      Object.defineProperty(event, "clientX", { value: clientX });
      Object.defineProperty(event, "clientY", { value: 20 });
      Object.defineProperty(event, "pointerId", { value: 1 });
      return event;
    };
    const start = host.querySelector('[aria-label="Select clip a"]')!;
    await act(async () => start.dispatchEvent(pointer("pointerdown", 250)));
    await advance(300);
    await act(async () => start.dispatchEvent(pointer("pointermove", 515)));
    await act(async () => start.dispatchEvent(pointer("pointerup", 515)));
    expect([...host.querySelectorAll('[aria-label^="Select clip "]')].map((node) => node.getAttribute("aria-label"))).toEqual(["Select clip b", "Select clip c", "Select clip a"]);
    await advance(1500);
    expect(boundary.repository.saveEdits).toHaveBeenCalledWith("p1", "g1", 1, [{ op: "move", clipId: "a", toIndex: 2 }]);
  });

  it("renders prominent undo and redo arrows in 44px disabled header controls", async () => {
    await render(<EditorScreen />);
    for (const label of ["Undo", "Redo"]) {
      const button = host.querySelector(`[aria-label="${label}"]`) as HTMLButtonElement;
      expect(button.className).toContain("min-h-11");
      expect(button.className).toContain("min-w-11");
      const svg = button.querySelector("svg");
      expect(svg?.getAttribute("width")).toBe("28");
      expect(svg?.getAttribute("height")).toBe("28");
      const paths = [...(svg?.querySelectorAll("path") ?? [])];
      expect(paths.some((path) => Number(path.getAttribute("stroke-width")) >= 2)).toBe(true);
      expect(paths.every((path) => path.getAttribute("stroke") === "rgb(var(--color-ink-muted))")).toBe(true);
    }
  });

  it("adds an unused uploaded shot with its thumbnail after the selected clip", async () => {
    boundary.repository.getFilmTimeline.mockResolvedValue({
      timeline: firstCut,
      sources: { "shot-a": "a.jpg", "shot-b": "b.jpg", "shot-c": "c.jpg" },
      unusedMedia: [{ shotId: "shot-unused", kind: "photo", thumbnailUrl: "unused-thumb.jpg", previewUrl: "unused-thumb.jpg", date: "2026-06-03", eventLabel: "Day 3, evening" }],
    });
    await render(<EditorScreen />);
    await click("Add");
    expect(host.querySelector('img[src="unused-thumb.jpg"]')).not.toBeNull();
    await click("Add Photo · Day 3, evening");
    expect(host.querySelector('[aria-label="Select clip add:shot-unused:1"]')).not.toBeNull();
    await advance(1500);
    expect(boundary.repository.saveEdits).toHaveBeenCalledWith("p1", "g1", 1, [{ op: "add", shotId: "shot-unused", kind: "photo", afterClipId: "a", durationSec: 3 }]);
  });

  it("prefills Ask from request= and applies its proposal in a single undo step", async () => {
    boundary.params = { ...boundary.params, request: "move the last photo earlier" };
    await render(<EditorScreen />);
    expect((host.querySelector('[aria-label="Ask for an edit"]') as HTMLInputElement).value).toBe("move the last photo earlier");
    const original = [...host.querySelectorAll('[aria-label^="Select clip "]')].map((element) => element.getAttribute("aria-label"));
    await click("Suggest edit");
    expect([...host.querySelectorAll('[aria-label^="Select clip "]')].map((element) => element.getAttribute("aria-label"))).toEqual(original);
    await click("Apply edits");
    expect([...host.querySelectorAll('[aria-label^="Select clip "]')].map((element) => element.getAttribute("aria-label"))).toEqual(["Select clip c", "Select clip a", "Select clip b"]);
    await click("Undo");
    expect([...host.querySelectorAll('[aria-label^="Select clip "]')].map((element) => element.getAttribute("aria-label"))).toEqual(["Select clip a", "Select clip b", "Select clip c"]);
  });

  it("keeps the editor's rendered film ready for download", async () => {
    await render(<EditorScreen />);
    await click("Save");
    expect(host.querySelector('[aria-label="Download rendered film"]')).not.toBeNull();
    expect(boundary.push).not.toHaveBeenCalled();
  });

  it("shows renderProgress while waiting for the saved film render", async () => {
    let finish!: (value: { downloadKey: string }) => void;
    await render(<EditorScreen />);
    boundary.repository.getFilm = vi.fn(async () => ({ renderProgress: 0.45 }));
    boundary.repository.saveFilm = vi.fn(() => new Promise((resolve) => { finish = resolve; }));
    await click("Save");
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(host.textContent).toContain("Rendering… 45%");
    await act(async () => finish({ downloadKey: "https://film.test/saved.mp4" }));
  });

  it("observes the started generation until it is saved, then opens the Saved screen", async () => {
    let reads = 0;
    boundary.repository.saveFilm = vi.fn(() => new Promise(() => {}));
    boundary.repository.getFilm = vi.fn(async () => {
      reads++;
      return reads === 1
        ? { generationStatus: "rendering", renderProgress: 0.4 }
        : { generationStatus: "saved", renderProgress: 1, outputPath: "renders/u/p1/g1.mp4", videoUrl: "https://film.test/saved.mp4" };
    });

    await render(<EditorScreen />);
    await click("Save");
    await advance(1500);

    expect(boundary.repository.getFilm).toHaveBeenCalledTimes(2);
    expect(boundary.navigate).toHaveBeenCalledWith({
      pathname: "/save-film",
      params: { filmId: "g1", directorChat: "true", repository: "api", projectId: "p1" },
    });
  });

  it("shows revision renderProgress while edited MP4 is rendering", async () => {
    boundary.repository.getEdits.mockResolvedValue({ revision: 1, ops: [], updatedAt: null });
    boundary.repository.getRender.mockResolvedValue({ revision: 1, status: "rendering", renderProgress: 0.42 });
    await render(<EditorScreen />);
    await click("Save");
    await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
    expect(host.textContent).toContain("Rendering… 42%");
  });

  it("trims a photo edge and autosaves the new duration", async () => {
    await render(<EditorScreen />);
    const clip = host.querySelector('[aria-label="Select clip a"]') as HTMLButtonElement;
    const widthBefore = Number.parseFloat(clip.style.width);
    await click("Select clip a");
    const end = host.querySelector('[aria-label="Trim end of clip a"]')!;
    const pointer = (type: string, clientX: number) => {
      const event = new Event(type, { bubbles: true });
      Object.defineProperty(event, "clientX", { value: clientX });
      Object.defineProperty(event, "pointerId", { value: 1 });
      return event;
    };
    await act(async () => end.dispatchEvent(pointer("pointerdown", 100)));
    await act(async () => end.dispatchEvent(pointer("pointermove", 140)));
    await act(async () => end.dispatchEvent(pointer("pointerup", 140)));
    expect(host.textContent).toContain("0:04 / 0:10");
    expect(Number.parseFloat(clip.style.width)).toBeGreaterThan(widthBefore);
    await advance(1500);
    expect(boundary.repository.saveEdits).toHaveBeenCalledWith("p1", "g1", 1, [{ op: "setPhotoDuration", clipId: "a", sec: 4 }]);
  });

  it("trims a selected timeline clip by its edge, seeks live, and undoes as one edit", async () => {
    await render(<EditorScreen />);
    await click("Select clip a");
    const startHandle = host.querySelector('[aria-label="Trim start of clip a"]') as HTMLButtonElement | null;
    const endHandle = host.querySelector('[aria-label="Trim end of clip a"]') as HTMLButtonElement | null;
    expect(startHandle).not.toBeNull();
    expect(endHandle).not.toBeNull();
    expect(endHandle?.getAttribute("aria-pressed")).toBe("true");

    const pointer = (type: string, clientX: number) => {
      const event = new Event(type, { bubbles: true });
      Object.defineProperty(event, "clientX", { value: clientX });
      Object.defineProperty(event, "pointerId", { value: 1 });
      return event;
    };
    await act(async () => startHandle!.dispatchEvent(pointer("pointerdown", 100)));
    await act(async () => startHandle!.dispatchEvent(pointer("pointermove", 140)));
    expect(host.querySelector('[data-testid="preview"]')?.getAttribute("data-playhead-sec")).toBe("1");
    await act(async () => startHandle!.dispatchEvent(pointer("pointerup", 140)));
    expect(host.textContent).toContain("0:01 / 0:08");

    await click("Undo");
    expect(host.textContent).toContain("0:01 / 0:09");
    await click("Redo");
    expect(host.textContent).toContain("0:01 / 0:08");
  });

  it("deselects a timeline clip when tapping empty track space", async () => {
    await render(<EditorScreen />);
    await click("Select clip a");
    expect(host.querySelector('[aria-label="Trim start of clip a"]')).not.toBeNull();
    await click("Deselect selected clip");
    expect(host.querySelector('[aria-label="Trim start of clip a"]')).toBeNull();
  });

  it("shows the soundtrack catalog name and pacing label instead of its id", async () => {
    boundary.params = { ...boundary.params, planId: "proposal-1" };
    boundary.repository.getPlan.mockRejectedValue(new Error("proposal is unavailable"));
    boundary.repository.getFilmTimeline.mockResolvedValue({
      timeline: {
        ...firstCut,
        audioClips: [{ id: "music", source: { kind: "soundtrack", soundtrackId: "lyria-playful", sourceInSec: 0, sourceOutSec: 9 }, role: "music", startSec: 0, gainDb: -12, fadeInSec: 0.5, fadeOutSec: 0.5 }],
      },
      sources: { "shot-a": "a.jpg", "shot-b": "b.jpg", "shot-c": "c.jpg" },
    });
    await render(<EditorScreen />);
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(host.textContent).toContain("Sandcastle Days · paced to the film");
    expect(host.textContent).not.toContain("lyria-playful");
  });

  it("moves clips immediately and supports undo and redo", async () => {
    await render(<Harness />);
    await click("Move c first");
    expect(host.querySelector('[data-testid="order"]')?.textContent).toBe("c,a,b");
    await click("Undo");
    expect(host.querySelector('[data-testid="order"]')?.textContent).toBe("a,b,c");
    await click("Redo");
    expect(host.querySelector('[data-testid="order"]')?.textContent).toBe("c,a,b");
  });

  it("applies a group of edits as one undo step", async () => {
    await render(<Harness />);
    await click("Apply two edits");
    expect(host.querySelector('[data-testid="order"]')?.textContent).toBe("b,c,a");
    await click("Undo");
    expect(host.querySelector('[data-testid="order"]')?.textContent).toBe("a,b,c");
  });

  it("shows a message when applyEdits rejects an operation", async () => {
    await render(<Harness />);
    await click("Apply rejected edit");
    expect(host.querySelector('[role="alert"]')?.textContent).toBe("That change couldn’t be applied. Try another edit.");
    expect(host.querySelector('[data-testid="ops"]')?.textContent).toBe("[]");
  });

  it("autosaves merged operations once after 1.5 seconds", async () => {
    await render(<Harness />);
    await click("Move c first");
    await click("Move c second");
    await advance(1499);
    expect(boundary.repository.saveEdits).not.toHaveBeenCalled();
    await advance(1);
    expect(boundary.repository.saveEdits).toHaveBeenCalledTimes(1);
    expect(boundary.repository.saveEdits).toHaveBeenCalledWith("p1", "g1", 1, [{ op: "move", clipId: "c", toIndex: 1 }]);
  });

  it("saves the new branch after undoing a saved edit", async () => {
    await render(<Harness />);
    await click("Move c first");
    await advance(1500);
    await click("Undo");
    await click("Move b first");
    await advance(1500);
    expect(boundary.repository.saveEdits).toHaveBeenNthCalledWith(1, "p1", "g1", 1, [{ op: "move", clipId: "c", toIndex: 0 }]);
    expect(boundary.repository.saveEdits).toHaveBeenNthCalledWith(2, "p1", "g1", 2, [{ op: "move", clipId: "b", toIndex: 0 }]);
  });

  it("shows a conflict and reloads the server revision", async () => {
    boundary.repository.saveEdits.mockRejectedValueOnce(Object.assign(new Error("stale_revision"), { status: 409 }));
    await render(<Harness />);
    await click("Move c first");
    await advance(1500);
    expect(host.textContent).toContain("This film changed on another device");
    boundary.repository.getEdits.mockResolvedValueOnce({ revision: 4, ops: [{ op: "move", clipId: "b", toIndex: 0 }], updatedAt: 2 });
    await click("Reload");
    expect(host.querySelector('[data-testid="order"]')?.textContent).toBe("b,a,c");
    expect(host.textContent).not.toContain("This film changed on another device");
  });

  it("saves the first cut when there are no edit revisions", async () => {
    await render(<Harness />);
    await click("Save film");
    expect(boundary.repository.saveFilm).toHaveBeenCalledWith("g1");
    expect(boundary.repository.renderRevision).not.toHaveBeenCalled();
    expect(host.querySelector('[data-testid="state"]')?.textContent).toBe("ready");
    expect(host.querySelector('[data-testid="download-url"]')?.textContent).toBe("first-cut.mp4");
  });

  it("flushes edits before rendering and exposes the ready revision download", async () => {
    await render(<Harness />);
    await click("Move c first");
    await click("Save film");
    expect(boundary.repository.saveEdits).toHaveBeenCalledWith("p1", "g1", 1, [{ op: "move", clipId: "c", toIndex: 0 }]);
    expect(boundary.repository.renderRevision).toHaveBeenCalledWith("p1", "g1", 1);
    expect(host.querySelector('[data-testid="state"]')?.textContent).toBe("ready");
    expect(host.querySelector('[data-testid="download-url"]')?.textContent).toBe("https://film.test/revision-1.mp4");
  });

  it("ignores an older render result when a second Save targets a later revision", async () => {
    let resolveFirst!: (value: { renderId: string }) => void;
    boundary.repository.renderRevision
      .mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; }))
      .mockResolvedValueOnce({ renderId: "render-2" });
    await render(<Harness />);
    await click("Move c first");
    await click("Save film");
    await click("Move b first");
    await click("Save film");
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(boundary.repository.renderRevision).toHaveBeenNthCalledWith(2, "p1", "g1", 2);
    expect(host.querySelector('[data-testid="download-url"]')?.textContent).toBe("https://film.test/revision-2.mp4");
    await act(async () => { resolveFirst({ renderId: "render-1" }); await Promise.resolve(); });
    expect(host.querySelector('[data-testid="download-url"]')?.textContent).toBe("https://film.test/revision-2.mp4");
  });

  it("saves an empty edit revision when returning to the first cut", async () => {
    await render(<Harness />);
    await click("Move c first");
    await advance(1500);
    await click("Back to first cut");
    expect(host.querySelector('[data-testid="order"]')?.textContent).toBe("a,b,c");
    await advance(1500);
    expect(boundary.repository.saveEdits).toHaveBeenNthCalledWith(2, "p1", "g1", 2, []);
  });
});
