import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react-native", () => {
  const element = (tag: string) => ({ children, onPress, accessibilityLabel, accessibilityState, ...props }: any) => React.createElement(tag, { ...props, ...(accessibilityLabel ? { "aria-label": accessibilityLabel } : {}), ...(accessibilityState?.selected ? { "aria-selected": true } : {}), onClick: onPress }, children);
  return { View: element("div"), Text: element("span"), Pressable: element("button") };
});
import { FormatSheet } from "../components/editor/FormatSheet";
let host: HTMLDivElement; let root: Root;
const onApply = vi.fn(); const onClose = vi.fn();
async function render(node: React.ReactNode) { await act(async () => root.render(node)); }
async function click(label: string) { const node = host.querySelector(`[aria-label="${label}"]`) as HTMLElement; expect(node).toBeTruthy(); await act(async () => node.click()); }
beforeEach(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; host = document.createElement("div"); document.body.append(host); root = createRoot(host); onApply.mockClear(); onClose.mockClear(); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
describe("FormatSheet", () => {
  it("marks current format selected and closes without applying it", async () => {
    await render(<FormatSheet visible aspect="16:9" onApply={onApply} onClose={onClose} />);
    expect(host.querySelector('[aria-label="🖥️ Landscape — best for TV & laptop"]')?.getAttribute("aria-selected")).toBe("true");
    expect(host.textContent).toContain("🖥️ Landscape — best for TV & laptop (current)");
    await click("🖥️ Landscape — best for TV & laptop");
    expect(onApply).not.toHaveBeenCalled(); expect(onClose).toHaveBeenCalledOnce();
  });
});
