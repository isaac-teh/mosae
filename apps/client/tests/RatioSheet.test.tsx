import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react-native", () => {
  const element = (tag: string) => ({ children, onPress, accessibilityLabel, accessibilityState, ...props }: any) => React.createElement(tag, { ...props, ...(accessibilityLabel ? { "aria-label": accessibilityLabel } : {}), ...(accessibilityState?.selected ? { "aria-selected": "true" } : {}), onClick: onPress }, children);
  return { View: element("div"), Text: element("span"), Pressable: element("button") };
});
vi.mock("react-native-svg", () => ({ default: ({ children, ...props }: any) => React.createElement("svg", props, children), Path: (props: any) => React.createElement("path", props), Rect: (props: any) => React.createElement("rect", props) }));
import { RatioSheet } from "../components/editor/RatioSheet";
let host: HTMLDivElement; let root: Root;
const onApply = vi.fn(); const onClose = vi.fn();
async function render(node: React.ReactNode) { await act(async () => root.render(node)); }
async function click(label: string) { const node = host.querySelector(`[aria-label="${label}"]`) as HTMLElement; expect(node).toBeTruthy(); await act(async () => node.click()); }
beforeEach(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; host = document.createElement("div"); document.body.append(host); root = createRoot(host); onApply.mockClear(); onClose.mockClear(); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
describe("RatioSheet", () => {
  it("shows aspect-shaped choices and applies a new ratio immediately", async () => {
    await render(<RatioSheet visible aspect="16:9" onApply={onApply} onClose={onClose} />);
    const vertical = host.querySelector('[aria-label="9:16 Portrait"]')!;
    const horizontal = host.querySelector('[aria-label="16:9 Landscape"]')!;
    expect(vertical.getAttribute("aria-selected")).toBeNull();
    expect(horizontal.getAttribute("aria-selected")).toBe("true");
    expect(host.textContent).toContain("Ratio");
    expect(vertical.querySelector("svg path")).not.toBeNull();
    expect(horizontal.querySelector("svg rect")).not.toBeNull();
    await click("9:16 Portrait");
    expect(onApply).toHaveBeenCalledOnce();
    expect(onApply).toHaveBeenCalledWith({ op: "setAspect", aspect: "9:16" });
    expect(onClose).not.toHaveBeenCalled();
  });
  it("does nothing when selecting the current ratio and closes from the check button", async () => {
    await render(<RatioSheet visible aspect="16:9" onApply={onApply} onClose={onClose} />);
    await click("16:9 Landscape");
    expect(onApply).not.toHaveBeenCalled(); expect(onClose).not.toHaveBeenCalled();
    await click("Done");
    expect(onClose).toHaveBeenCalledOnce();
  });
});
