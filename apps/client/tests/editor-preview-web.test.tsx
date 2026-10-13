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
    return React.createElement("div", { "data-testid": "player", "data-duration": props.durationInFrames, "data-initial-frame": props.initialFrame });
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
  it("shows the first fully visible frame while paused at zero, then starts playback at frame zero", async () => {
    const fadingTimeline: Timeline = { ...timeline, videoClips: [{ id: "opening", source: { kind: "photo", shotId: "poster" }, startSec: 0, durationSec: 3, transitionIn: { kind: "crossfade", durationSec: 0.4 } }] };
    await act(async () => root.render(<EditorPreview timeline={fadingTimeline} sources={{ poster: "poster.jpg" }} />));
    expect(host.querySelector('[data-testid="player"]')?.getAttribute("data-initial-frame")).toBe("12");
    expect(host.querySelector('[aria-label="Play preview"]')?.getAttribute("data-current-time")).toBe("0");
    expect(playerMock.seekTo).not.toHaveBeenCalled();
    expect(playerMock.play).not.toHaveBeenCalled();
    await act(async () => (host.querySelector('[aria-label="Play preview"]') as HTMLDivElement).click());
    expect(playerMock.seekTo).toHaveBeenCalledWith(0);
    expect(playerMock.play).toHaveBeenCalledOnce();
  });

  it("leaves the shared chat player seek and fullscreen lifecycle alone on mount", async () => {
    await act(async () => root.render(<EditorPreview timeline={timeline} sources={{}} controls="chat" />));
    expect(playerMock.seekTo).not.toHaveBeenCalled();
  });

  it.each([undefined, "chat"] as const)("passes a replaced video source through the %s shared preview", async (controls) => {
    const videoTimeline: Timeline = { ...timeline, durationSec: 4, videoClips: [{ id: "replaced", source: { kind: "video", shotId: "video-shot", sourceInSec: 2, sourceOutSec: 6, sourceDurationSec: 12, width: 1920, height: 1080 }, startSec: 0, durationSec: 4, transitionIn: { kind: "cut", durationSec: 0 } }] };
    await act(async () => root.render(<EditorPreview timeline={videoTimeline} sources={{ "video-shot": "signed-proxy.mp4" }} controls={controls} />));
    expect(playerMock.inputProps.at(-1)).toMatchObject({ timeline: { videoClips: [{ source: { kind: "video", sourceInSec: 2, sourceOutSec: 6 } }] }, sources: { "video-shot": "signed-proxy.mp4" } });
  });

  it("seeks the Remotion player to requested seconds and reports frame updates", async () => {
    const onTimeChange = vi.fn();
    await act(async () => root.render(<EditorPreview timeline={timeline} sources={{}} onTimeChange={onTimeChange} seekRequest={{ seconds: 2.25 }} />));
    expect(playerMock.seekTo).toHaveBeenCalledWith(68);
    await act(async () => playerMock.listeners.get("frameupdate")?.({ detail: { frame: 120 } }));
    expect(onTimeChange).toHaveBeenCalledWith(4);
    expect(host.querySelector(".mosae-editor-preview [role=button]")?.getAttribute("data-current-time")).toBe("4");
  });

  it("seeks back inside a shortened timeline when the prior playhead is beyond its new end", async () => {
    const collage = (durationSec: number) => ({ kind: "collage" as const, clipId: "collage-1", startSec: 0, durationSec, transitionIn: { kind: "cut" as const, durationSec: 0 }, spec: { layoutId: "photo-table", motionId: "stack-deal", effectId: null, seed: "test", durationSec, slots: [{ slotId: "s1", shotId: "photo", kind: "photo" }] } });
    const longer: Timeline = { ...timeline, durationSec: 9, videoClips: [collage(9)] as any };
    const shorter: Timeline = { ...longer, durationSec: 6, videoClips: [collage(6)] as any };
    await act(async () => root.render(<EditorPreview timeline={longer} sources={{ photo: "photo.jpg" }} onTimeChange={() => {}} />));
    await act(async () => playerMock.listeners.get("play")?.({ detail: { frame: 0 } }));
    await act(async () => playerMock.listeners.get("frameupdate")?.({ detail: { frame: 255 } }));
    playerMock.seekTo.mockClear();
    await act(async () => root.render(<EditorPreview timeline={shorter} sources={{ photo: "photo.jpg" }} onTimeChange={() => {}} />));
    expect(playerMock.seekTo).toHaveBeenLastCalledWith(179);
    expect(host.querySelector('[data-current-time]')?.getAttribute("data-current-time")).toBe("5.966666666666667");
    expect(playerMock.inputProps.at(-1)).toMatchObject({ timeline: { videoClips: [{ durationSec: 6, spec: { durationSec: 6 } }] } });
  });

  it("passes a landscape timeline through to the shared Remotion composition", async () => {
    await act(async () => root.render(<EditorPreview timeline={{ ...timeline, aspect: "16:9" }} sources={{}} />));
    expect(playerMock.inputProps[0]).toMatchObject({ timeline: { aspect: "16:9" } });
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
    playerMock.seekTo.mockClear();
    await act(async () => playerMock.listeners.get("play")?.({ detail: { frame: 0 } }));
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

  it("plays from a newly requested AI edit position", async () => {
    const props = { timeline, sources: {}, seekRequest: null as { seconds: number } | null, togglePlayRequest: 0 };
    await act(async () => root.render(<EditorPreview {...props} />));
    await act(async () => root.render(<EditorPreview {...props} seekRequest={{ seconds: 2.25 }} togglePlayRequest={1} />));
    expect(playerMock.seekTo).toHaveBeenLastCalledWith(68);
    expect(playerMock.play).toHaveBeenCalledTimes(1);
  });

  it("starts and pauses playback from the editor control row", async () => {
    const onPlayingChange = vi.fn();
    await act(async () => root.render(<EditorPreview timeline={timeline} sources={{}} playheadSec={4.5} onPlayingChange={onPlayingChange} />));
    await act(async () => root.render(<EditorPreview timeline={timeline} sources={{}} playheadSec={4.5} togglePlayRequest={1} onPlayingChange={onPlayingChange} />));
    expect(playerMock.seekTo).toHaveBeenCalledWith(135);
    expect(playerMock.play).toHaveBeenCalledOnce();
    await act(async () => playerMock.listeners.get("play")?.({ detail: { frame: 135 } }));
    expect(onPlayingChange).toHaveBeenLastCalledWith(true);
    await act(async () => root.render(<EditorPreview timeline={timeline} sources={{}} playheadSec={4.5} togglePlayRequest={2} onPlayingChange={onPlayingChange} />));
    expect(playerMock.pause).toHaveBeenCalledOnce();
  });

  it("keeps the preview free of its own progress and time controls", async () => {
    await act(async () => root.render(<EditorPreview timeline={timeline} sources={{}} />));
    expect(host.querySelector('[aria-label="Film progress"]')).toBeNull();
    expect(host.querySelector('[aria-label="Fullscreen"]')).toBeNull();
    expect(host.textContent).not.toContain("00:00");
    expect(host.textContent).not.toContain("00:09");
  });

  it("shows chat controls with formatted current and total time", async () => {
    await act(async () => root.render(<EditorPreview timeline={timeline} sources={{}} controls="chat" />));
    expect(host.querySelector('[aria-label="Film progress"]')).not.toBeNull();
    expect(host.querySelector('[aria-label="Fullscreen"]')).not.toBeNull();
    expect(host.textContent).toContain("00:00");
    expect(host.textContent).toContain("00:09");
  });

  it("seeks the chat preview with a tap and keyboard arrows", async () => {
    await act(async () => root.render(<EditorPreview timeline={timeline} sources={{}} controls="chat" />));
    const slider = host.querySelector('[aria-label="Film progress"]') as HTMLDivElement;
    vi.spyOn(slider, "getBoundingClientRect").mockReturnValue({ left: 0, width: 100, top: 0, right: 100, bottom: 44, height: 44, x: 0, y: 0, toJSON() {} });
    const tap = new Event("touchstart", { bubbles: true });
    Object.defineProperty(tap, "touches", { value: [{ clientX: 50 }] });
    await act(async () => slider.dispatchEvent(tap));
    expect(playerMock.seekTo).toHaveBeenLastCalledWith(135);
    await act(async () => slider.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, clientX: 25 })));
    await act(async () => slider.dispatchEvent(new MouseEvent("pointermove", { bubbles: true, clientX: 75 })));
    await act(async () => slider.dispatchEvent(new MouseEvent("pointerup", { bubbles: true })));
    expect(playerMock.seekTo).toHaveBeenLastCalledWith(203);
    await act(async () => slider.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })));
    expect(playerMock.seekTo).toHaveBeenLastCalledWith(269);
  });

  it("uses native fullscreen when available and an overlay fallback otherwise", async () => {
    const requestFullscreen = vi.fn().mockResolvedValue(undefined);
    await act(async () => root.render(<EditorPreview timeline={timeline} sources={{}} controls="chat" />));
    const container = host.querySelector(".mosae-editor-preview") as HTMLDivElement;
    Object.defineProperty(container, "requestFullscreen", { configurable: true, value: requestFullscreen });
    await act(async () => (host.querySelector('[aria-label="Fullscreen"]') as HTMLButtonElement).click());
    expect(requestFullscreen).toHaveBeenCalledOnce();

    Object.defineProperty(container, "requestFullscreen", { configurable: true, value: undefined });
    await act(async () => (host.querySelector('[aria-label="Fullscreen"]') as HTMLButtonElement).click());
    expect(document.body.querySelector('[aria-label="Close fullscreen"]')).not.toBeNull();
  });

  it("passes selected-photo crop and selection callbacks into the frame renderer", async () => {
    const onSelectClip = vi.fn();
    const onCommitPhotoCrop = vi.fn();
    await act(async () => root.render(<EditorPreview timeline={timeline} sources={{}} selectedClipId="photo-1" onSelectClip={onSelectClip} onCommitPhotoCrop={onCommitPhotoCrop} />));
    expect(host.querySelector(".mosae-editor-preview style")?.textContent).toContain("#168dff");
    expect(playerMock.inputProps.at(-1)).toMatchObject({ selectedClipId: "photo-1", onSelectClip, onCommitPhotoCrop });
  });

  it("toggles playback when the preview surface is tapped", async () => {
    await act(async () => root.render(<EditorPreview timeline={timeline} sources={{}} />));
    const preview = host.querySelector('[aria-label="Play preview"]') as HTMLDivElement;
    expect(preview).not.toBeNull();
    await act(async () => preview.click());
    expect(playerMock.play).toHaveBeenCalledOnce();
    expect(preview.getAttribute("aria-label")).toBe("Pause preview");
    await act(async () => preview.click());
    expect(playerMock.pause).toHaveBeenCalledOnce();
    expect(preview.getAttribute("aria-label")).toBe("Play preview");
  });
});
