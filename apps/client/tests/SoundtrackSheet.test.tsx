import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react-native", () => {
  const element = (tag: string) => ({ children, onPress, onChangeText, accessibilityLabel, numberOfLines, ...props }: any) => React.createElement(tag, {
    ...props,
    ...(accessibilityLabel ? { "aria-label": accessibilityLabel } : {}),
    ...(numberOfLines ? { "data-number-of-lines": numberOfLines } : {}),
    onClick: onPress,
    onInput: onChangeText ? (event: any) => onChangeText(event.currentTarget.value) : undefined,
  }, children);
  const ScrollView = React.forwardRef(({ children, horizontal, ...props }: any, ref: any) => React.createElement("div", { ...props, ref, "data-horizontal": horizontal }, children));
  return { Platform: { OS: "web" }, View: element("div"), ScrollView, Text: element("span"), Pressable: element("button"), TextInput: element("input") };
});

import type { Soundtrack } from "@mosae/core";
import { SoundtrackSheet } from "../components/editor/SoundtrackSheet";

const tracks: Soundtrack[] = [
  { id: "one", name: "Gentle Shores", description: "Piano", mood: "tender", durationSec: 59.873, suggested: true },
  { id: "two", name: "Sunny Run", description: "Bright", mood: "energetic", durationSec: 62.3, suggested: false },
];
let host: HTMLDivElement;
let root: Root;
const apply = vi.fn();
const close = vi.fn();
async function render(node: React.ReactNode) { await act(async () => root.render(node)); }
async function click(label: string) { const node = host.querySelector(`[aria-label="${label}"]`) as HTMLElement; expect(node).toBeTruthy(); await act(async () => node.click()); }

beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined);
  HTMLMediaElement.prototype.pause = vi.fn();
  host = document.createElement("div"); document.body.append(host); root = createRoot(host); apply.mockClear(); close.mockClear();
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

describe("SoundtrackSheet", () => {
  it("opens with the current track ready for bottom-button playback and confirmation", async () => {
    await render(<SoundtrackSheet visible soundtracks={tracks} currentSoundtrackId="two" previewSourceForTrack={(track) => `/${track.id}.mp3`} onApply={apply} onClose={close} />);
    expect(host.querySelector("audio")?.getAttribute("src")).toBe("/two.mp3");
    expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
    await click("Play soundtrack preview");
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(1);
    await click("Confirm soundtrack");
    expect(apply).toHaveBeenCalledWith({ op: "setSoundtrack", soundtrackId: "two" });
  });

  it("selects a suggestion after the catalog loads when the film has no music", async () => {
    await render(<SoundtrackSheet visible loading soundtracks={[]} onApply={apply} onClose={close} />);
    await render(<SoundtrackSheet visible soundtracks={tracks} previewSourceForTrack={(track) => `/${track.id}.mp3`} onApply={apply} onClose={close} />);
    expect(host.querySelector("audio")?.getAttribute("src")).toBe("/one.mp3");
    await click("Confirm soundtrack");
    expect(apply).toHaveBeenCalledWith({ op: "setSoundtrack", soundtrackId: "one" });
  });
  it("filters by actual mood and search metadata, previews a real source, and confirms the selected track", async () => {
    await render(<SoundtrackSheet visible soundtracks={tracks} currentSoundtrackId="one" previewSourceForTrack={(track) => `https://media.test/${track.id}.mp3`} onApply={apply} onClose={close} />);
    expect(host.textContent).toContain("CURRENT");
    expect(host.textContent).toContain("1:00");
    await click("Soundtrack mood energetic");
    expect(host.textContent).toContain("Sunny Run");
    expect(host.querySelector('[aria-label="Preview Gentle Shores"]')).toBeNull();
    const search = host.querySelector('[aria-label="Search soundtracks"]') as HTMLInputElement;
    await act(async () => { search.value = "sunny"; search.dispatchEvent(new Event("input", { bubbles: true })); });
    expect(host.textContent).toContain("Sunny Run");
    await click("Preview Sunny Run");
    expect(host.querySelector("audio")?.getAttribute("src")).toBe("https://media.test/two.mp3");
    expect(host.querySelector("audio")?.hasAttribute("controls")).toBe(false);
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalled();
    await click("Confirm soundtrack");
    expect(apply).toHaveBeenCalledWith({ op: "setSoundtrack", soundtrackId: "two" });
    expect(close).toHaveBeenCalledOnce();
  });

  it("cancels without applying and stops preview playback", async () => {
    await render(<SoundtrackSheet visible soundtracks={tracks} previewSourceForTrack={(track) => `/${track.id}.mp3`} onApply={apply} onClose={close} />);
    await click("Soundtrack mood energetic");
    await click("Preview Sunny Run");
    await click("Close soundtrack");
    expect(apply).not.toHaveBeenCalled();
    expect(HTMLMediaElement.prototype.pause).toHaveBeenCalled();
    expect(close).toHaveBeenCalledOnce();
  });

  it("handles loading and empty catalogs explicitly", async () => {
    await render(<SoundtrackSheet visible loading soundtracks={[]} onApply={apply} onClose={close} />);
    expect(host.textContent).toContain("Loading soundtracks");
    await render(<SoundtrackSheet visible soundtracks={[]} onApply={apply} onClose={close} />);
    expect(host.textContent).toContain("No soundtracks found");
  });
});
