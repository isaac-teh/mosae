import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Timeline } from "@mosae/contracts";

const boundary = vi.hoisted(() => ({ repository: {} as any, params: { projectId: "p1", generationId: "g1", repository: "fixture", request: undefined as string | undefined }, back: vi.fn() }));
vi.mock("expo-router", () => ({ useLocalSearchParams: () => boundary.params, useRouter: () => ({ back: boundary.back }) }));
vi.mock("@/lib/storyFlow", () => ({ useStoryFlow: () => ({ repository: boundary.repository }) }));
vi.mock("@/components/editor/EditorPreview", () => ({ EditorPreview: () => React.createElement("div", { "data-testid": "preview" }) }));
vi.mock("expo-asset", () => ({ Asset: { fromModule: () => ({ uri: "fixture.jpg" }) } }));
vi.mock("react-native-svg", () => ({ default: () => null, Path: () => null, Circle: () => null }));
vi.mock("react-native", () => {
  const element = (tag: string) => ({ children, onPress, onChangeText, accessibilityLabel, ...props }: any) =>
    React.createElement(tag, { ...props, ...(accessibilityLabel ? { "aria-label": accessibilityLabel } : {}), onClick: onPress, onInput: onChangeText ? (event: any) => onChangeText(event.target.value) : undefined }, children);
  return { View: element("div"), ScrollView: element("div"), Text: element("span"), Pressable: element("button"), TextInput: element("input"), Image: element("img"), Share: { share: vi.fn() }, Linking: { openURL: vi.fn() }, useWindowDimensions: () => ({ width: 390, height: 844 }) };
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
    <SaveState save={editor.save} onReload={() => void editor.reloadAfterConflict()} />
    <button aria-label="Move c first" onClick={() => editor.apply({ op: "move", clipId: "c", toIndex: 0 })}>Move c first</button>
    <button aria-label="Move c second" onClick={() => editor.apply({ op: "move", clipId: "c", toIndex: 1 })}>Move c second</button>
    <button aria-label="Move b first" onClick={() => editor.apply({ op: "move", clipId: "b", toIndex: 0 })}>Move b first</button>
    <button aria-label="Apply two edits" onClick={() => editor.applyMany([{ op: "move", clipId: "c", toIndex: 0 }, { op: "move", clipId: "b", toIndex: 0 }])}>Apply two edits</button>
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
  boundary.params = { projectId: "p1", generationId: "g1", repository: "fixture", request: undefined };
  boundary.back.mockReset();
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

  it("offers Download and Share after the latest render is ready", async () => {
    await render(<EditorScreen />);
    await click("Save");
    expect(host.querySelector('[aria-label="Download rendered film"]')).not.toBeNull();
    expect(host.querySelector('[aria-label="Share rendered film"]')).not.toBeNull();
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
