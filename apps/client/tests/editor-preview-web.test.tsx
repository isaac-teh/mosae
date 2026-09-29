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
});
