import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react-native", () => ({
  Pressable: ({ children, onPress, accessibilityLabel, ...props }: any) => React.createElement("button", { ...props, "aria-label": accessibilityLabel, onClick: onPress }, children),
  View: React.forwardRef((props: any, ref: any) => React.createElement("div", { ...props, ref }, props.children)),
}));
vi.mock("react-native-svg", () => ({ default: (props: any) => React.createElement("svg", props), Path: (props: any) => React.createElement("path", props) }));
vi.mock("expo-asset", () => ({ Asset: { fromModule: () => ({ uri: "poster.jpg" }) } }));

import { FilmPlayer } from "../components/FilmPlayer.web";

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

describe("web film player controls", () => {
  it("renders a wired fullscreen button and a touch-sized seek bar", async () => {
    await act(async () => root.render(<FilmPlayer source="film.mp4" poster={{ uri: "poster.jpg" }} durationSec={40} aspect="portrait" compact />));
    expect(host.querySelector('[aria-label="Fullscreen"]')).not.toBeNull();
    expect((host.querySelector('[aria-label="Film progress"]') as HTMLElement).className).toContain("h-11");
  });

  it("seeks on tap and steps five seconds with keyboard arrows", async () => {
    await act(async () => root.render(<FilmPlayer source="film.mp4" poster={{ uri: "poster.jpg" }} durationSec={40} aspect="portrait" />));
    const slider = host.querySelector('[aria-label="Film progress"]') as HTMLDivElement;
    const video = host.querySelector("video") as HTMLVideoElement;
    Object.defineProperty(video, "duration", { configurable: true, value: 40 });
    Object.defineProperty(video, "readyState", { configurable: true, value: 1 });
    Object.defineProperty(video, "currentTime", { configurable: true, writable: true, value: 0 });
    slider.getBoundingClientRect = () => ({ left: 0, right: 100, top: 0, bottom: 44, width: 100, height: 44, x: 0, y: 0, toJSON: () => ({}) });
    await act(async () => slider.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: 75 })));
    expect(video.currentTime).toBe(30);
    expect(slider.getAttribute("aria-valuenow")).toBe("30");
    await act(async () => slider.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "ArrowLeft" })));
    expect(video.currentTime).toBe(25);
    const play = vi.spyOn(video, "play").mockResolvedValue();
    await act(async () => (host.querySelector('[aria-label="Play"]') as HTMLButtonElement).click());
    expect(play).toHaveBeenCalledOnce();
    expect(video.currentTime).toBe(25);
  });

  it("keeps a tapped seek pending until video metadata arrives", async () => {
    await act(async () => root.render(<FilmPlayer source="film.mp4" poster={{ uri: "poster.jpg" }} durationSec={40} aspect="portrait" />));
    const slider = host.querySelector('[aria-label="Film progress"]') as HTMLDivElement;
    const video = host.querySelector("video") as HTMLVideoElement;
    Object.defineProperty(video, "duration", { configurable: true, value: 40 });
    Object.defineProperty(video, "readyState", { configurable: true, value: 0 });
    Object.defineProperty(video, "currentTime", { configurable: true, writable: true, value: 0 });
    slider.getBoundingClientRect = () => ({ left: 0, right: 100, top: 0, bottom: 44, width: 100, height: 44, x: 0, y: 0, toJSON: () => ({}) });
    await act(async () => slider.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: 75 })));
    expect(video.currentTime).toBe(0);
    await act(async () => video.dispatchEvent(new Event("loadedmetadata", { bubbles: true })));
    expect(video.currentTime).toBe(30);
  });

  it("opens and closes the overlay when Fullscreen API and webkit video fullscreen are absent", async () => {
    await act(async () => root.render(<FilmPlayer source="film.mp4" poster={{ uri: "poster.jpg" }} durationSec={40} aspect="portrait" />));
    await act(async () => (host.querySelector('[aria-label="Fullscreen"]') as HTMLButtonElement).click());
    expect(host.querySelector('[aria-label="Close fullscreen"]')).not.toBeNull();
    expect((host.firstElementChild as HTMLElement).className).toContain("fixed");
    await act(async () => (host.querySelector('[aria-label="Close fullscreen"]') as HTMLButtonElement).click());
    expect(host.querySelector('[aria-label="Close fullscreen"]')).toBeNull();
  });

  it("closes overlay fullscreen on swipe-down", async () => {
    await act(async () => root.render(<FilmPlayer source="film.mp4" poster={{ uri: "poster.jpg" }} durationSec={40} aspect="portrait" />));
    await act(async () => (host.querySelector('[aria-label="Fullscreen"]') as HTMLButtonElement).click());
    const container = host.firstElementChild as HTMLElement;
    const start = new Event("touchstart", { bubbles: true });
    Object.defineProperty(start, "touches", { value: [{ clientY: 80 }] });
    const end = new Event("touchend", { bubbles: true });
    Object.defineProperty(end, "changedTouches", { value: [{ clientY: 190 }] });
    await act(async () => { container.dispatchEvent(start); container.dispatchEvent(end); });
    expect(host.querySelector('[aria-label="Close fullscreen"]')).toBeNull();
  });

  it("calls iOS webkit fullscreen on the actual video element", async () => {
    const entered = vi.fn();
    Object.defineProperty(HTMLVideoElement.prototype, "webkitEnterFullscreen", { configurable: true, value: entered });
    try {
      await act(async () => root.render(<FilmPlayer source="film.mp4" poster={{ uri: "poster.jpg" }} durationSec={40} aspect="portrait" />));
      await act(async () => (host.querySelector('[aria-label="Fullscreen"]') as HTMLButtonElement).click());
      expect(entered).toHaveBeenCalledOnce();
      expect(host.querySelector('[aria-label="Close fullscreen"]')).toBeNull();
    } finally {
      delete (HTMLVideoElement.prototype as any).webkitEnterFullscreen;
    }
  });
});
