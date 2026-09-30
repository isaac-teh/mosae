import React, { act, useImperativeHandle } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const playerMock = vi.hoisted(() => ({ seekTo: vi.fn(), play: vi.fn(), pause: vi.fn(), inputProps: [] as unknown[], listeners: new Map<string, (event: { detail: { frame: number } }) => void>() }));
vi.mock("react-native", () => ({
  View: ({ children, ...props }: any) => React.createElement("div", props, children),
  Pressable: ({ children, accessibilityLabel, onPress, ...props }: any) => React.createElement("button", { ...props, "aria-label": accessibilityLabel, onClick: onPress }, children),
  Text: ({ children, ...props }: any) => React.createElement("span", props, children),
}));
vi.mock("@remotion/player", () => ({
  Player: React.forwardRef((props: any, ref: any) => {
    playerMock.inputProps.push(props.inputProps);
    useImperativeHandle(ref, () => ({
      seekTo: playerMock.seekTo,
      addEventListener: (name: string, callback: (event: { detail: { frame: number } }) => void) => playerMock.listeners.set(name, callback),
      removeEventListener: (name: string) => playerMock.listeners.delete(name),
      play: playerMock.play,
      pause: playerMock.pause,
    }));
    return React.createElement("div", { "data-testid": "player", "data-duration": props.durationInFrames });
  }),
}));
vi.mock("@mosae/video/timeline", () => ({ MosaeTimeline: () => null }));

import { EditorPreview } from "../components/editor/EditorPreview.web";
import type { Timeline } from "@mosae/contracts";

const timeline: Timeline = { schemaVersion: 1, projectId: "p1", mode: "memory", aspect: "9:16", fps: 30, durationSec: 9, chapters: [], videoClips: [], audioClips: [], captions: [] };
let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  playerMock.seekTo.mockReset();
  playerMock.play.mockReset();
  playerMock.pause.mockReset();
  playerMock.inputProps.length = 0;
  playerMock.listeners.clear();
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

describe("web editor preview seeks", () => {
  it("seeks the Remotion player to requested seconds and reports frame updates", async () => {
    const onTimeChange = vi.fn();
    await act(async () => root.render(<EditorPreview timeline={timeline} sources={{}} onTimeChange={onTimeChange} seekRequest={{ seconds: 2.25 }} />));
    expect(playerMock.seekTo).toHaveBeenCalledWith(68);
    await act(async () => playerMock.listeners.get("frameupdate")?.({ detail: { frame: 120 } }));
    expect(onTimeChange).toHaveBeenCalledWith(4);
  });

  it("keeps player inputs stable and never seeks when a playback frame updates", async () => {
    const sources = { "shot-a": "photo.jpg", "lyria-playful": "soundtrack.mp3" };
    function Harness() {
      const [time, setTime] = React.useState(0);
      const onTimeChange = React.useCallback((seconds: number) => setTime(seconds), []);
      return <><span>{time}</span><EditorPreview timeline={timeline} sources={sources} onTimeChange={onTimeChange} /></>;
    }
    await act(async () => root.render(<Harness />));
    const inputProps = playerMock.inputProps[0];
    await act(async () => playerMock.listeners.get("frameupdate")?.({ detail: { frame: 90 } }));
    expect(host.textContent).toContain("3");
    expect(playerMock.seekTo).not.toHaveBeenCalled();
    expect(playerMock.inputProps.length).toBeGreaterThan(1);
    expect(playerMock.inputProps.at(-1)).toBe(inputProps);
  });

  it("pauses and seeks when a timeline drag takes over playback", async () => {
    await act(async () => root.render(<EditorPreview timeline={timeline} sources={{}} seekRequest={{ seconds: 3.2 }} pauseRequest={1} />));
    expect(playerMock.pause).toHaveBeenCalledOnce();
    expect(playerMock.seekTo).toHaveBeenCalledWith(96);
  });

  it("starts playback from the centred scrubbed playhead", async () => {
    await act(async () => root.render(<EditorPreview timeline={timeline} sources={{}} playheadSec={4.5} />));
    const play = host.querySelector('[aria-label="Play preview"]') as HTMLButtonElement;
    await act(async () => play.click());
    expect(playerMock.seekTo).toHaveBeenCalledWith(135);
    expect(playerMock.play).toHaveBeenCalledOnce();
  });

  it("seeks immediately when tapping the progress bar and supports keyboard steps", async () => {
    const onTimeChange = vi.fn();
    await act(async () => root.render(<EditorPreview timeline={timeline} sources={{}} onTimeChange={onTimeChange} />));
    const slider = host.querySelector('[aria-label="Film progress"]') as HTMLDivElement;
    slider.getBoundingClientRect = () => ({ left: 100, right: 700, top: 0, bottom: 44, width: 600, height: 44, x: 100, y: 0, toJSON: () => ({}) });
    await act(async () => slider.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: 550 })));
    expect(playerMock.seekTo).toHaveBeenCalledWith(203);
    expect(onTimeChange).toHaveBeenCalledWith(6.75);
    expect(slider.getAttribute("aria-valuenow")).toBe("6.75");
    await act(async () => slider.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "ArrowLeft" })));
    expect(playerMock.seekTo).toHaveBeenLastCalledWith(53);
    expect(onTimeChange).toHaveBeenLastCalledWith(1.75);
    await act(async () => (host.querySelector('[aria-label="Play preview"]') as HTMLButtonElement).click());
    expect(playerMock.seekTo).toHaveBeenLastCalledWith(53);
    expect(playerMock.play).toHaveBeenCalledOnce();
  });

  it("uses an in-app fullscreen overlay when native fullscreen is unavailable", async () => {
    await act(async () => root.render(<EditorPreview timeline={timeline} sources={{}} />));
    await act(async () => (host.querySelector('[aria-label="Fullscreen"]') as HTMLButtonElement).click());
    const fullscreen = host.querySelector('[aria-label="Close fullscreen"]');
    expect(fullscreen).not.toBeNull();
    expect((host.firstElementChild as HTMLElement).className).toContain("fixed");
    expect(document.body.style.overflow).toBe("hidden");
    await act(async () => (fullscreen as HTMLButtonElement).click());
    expect(host.querySelector('[aria-label="Close fullscreen"]')).toBeNull();
    expect(document.body.style.overflow).toBe("");
  });
});
