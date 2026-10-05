import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DeviceUploadControl } from "../components/editor/DeviceUploadControl";

vi.mock("react-native", () => ({
  Platform: { OS: "web" },
  Pressable: ({ children, onPress, accessibilityLabel, accessibilityRole, ...props }: any) => React.createElement("button", { ...props, role: accessibilityRole, "aria-label": accessibilityLabel, onClick: onPress }, children),
  Text: ({ children, ...props }: any) => React.createElement("span", props, children),
  View: ({ children, ...props }: any) => React.createElement("div", props, children),
}));

let host: HTMLDivElement;
let root: Root;
beforeEach(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

describe("DeviceUploadControl", () => {
  it("offers a touch friendly upload button and forwards selected files", async () => {
    const onFiles = vi.fn();
    await act(async () => root.render(<DeviceUploadControl onFiles={onFiles} />));
    const button = host.querySelector('button[aria-label="Upload from phone"]')!;
    expect(button.textContent).toContain("Upload from phone");
    expect(Number.parseInt((button as HTMLElement).style.minHeight, 10)).toBeGreaterThanOrEqual(44);
    const input = host.querySelector('input[type="file"]') as HTMLInputElement;
    expect(input.accept).toBe("image/*");
    expect(input.multiple).toBe(false);
    const file = new File(["image"], "photo.jpg", { type: "image/jpeg" });
    Object.defineProperty(input, "files", { configurable: true, value: [file] });
    await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
    expect(onFiles).toHaveBeenCalledWith([file]);
  });
});
