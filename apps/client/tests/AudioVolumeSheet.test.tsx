import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react-native", () => {
  const element = (tag: string) => ({ children, onPress, accessibilityLabel, ...props }: any) => React.createElement(tag, {
    ...props,
    ...(accessibilityLabel ? { "aria-label": accessibilityLabel } : {}),
    onClick: onPress,
  }, children);
  return { Platform: { OS: "web" }, View: element("div"), Text: element("span"), Pressable: element("button") };
});

import { AudioVolumeSheet } from "../components/editor/AudioVolumeSheet";

let host: HTMLDivElement;
let root: Root;
const apply = vi.fn();
const close = vi.fn();
async function render(node: React.ReactNode) { await act(async () => root.render(node)); }
async function click(label: string) { const node = host.querySelector(`[aria-label="${label}"]`) as HTMLElement; expect(node).toBeTruthy(); await act(async () => node.click()); }

beforeEach(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; host = document.createElement("div"); document.body.append(host); root = createRoot(host); apply.mockClear(); close.mockClear(); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

describe("AudioVolumeSheet", () => {
  it("confirms the target clip with the logarithmic percentage mapping", async () => {
    await render(<AudioVolumeSheet visible audioClipId="music-clip" gainDb={0} onApply={apply} onClose={close} />);
    const slider = host.querySelector('input[type="range"]') as HTMLInputElement;
    await act(async () => { slider.value = "50"; slider.dispatchEvent(new Event("input", { bubbles: true })); });
    expect(host.textContent).toContain("50%");
    await click("Apply audio volume");
    expect(apply).toHaveBeenCalledWith({ op: "setMusicVolume", audioClipId: "music-clip", gainDb: expect.closeTo(-6.0206, 3) });
    expect(close).toHaveBeenCalledOnce();
  });

  it("preserves the explicit mute sentinel when confirming zero", async () => {
    await render(<AudioVolumeSheet visible audioClipId="music-clip" gainDb={-60} onApply={apply} onClose={close} />);
    const slider = host.querySelector('input[type="range"]') as HTMLInputElement;
    expect(slider.value).toBe("0");
    await click("Apply audio volume");
    expect(apply).toHaveBeenCalledWith({ op: "setMusicVolume", audioClipId: "music-clip", gainDb: -60 });
  });
});
