import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react-native", () => {
  const element = (tag: string) => ({ children, onPress, onChangeText, accessibilityRole, accessibilityLabel, accessibilityState, accessibilityHint, accessibilityValue, multiline, editable, textAlignVertical, nativeID, style, ...props }: any) =>
    React.createElement(tag, { ...props, style: typeof style === "function" ? style({ pressed: false }) : style, role: props.role ?? accessibilityRole, "aria-label": props["aria-label"] ?? accessibilityLabel, "aria-disabled": accessibilityState?.disabled, "aria-pressed": accessibilityState?.selected, "aria-invalid": props["aria-invalid"], "aria-describedby": props["aria-describedby"], id: nativeID, disabled: props.disabled ?? (editable === false ? true : undefined), "aria-valuemin": accessibilityValue?.min, "aria-valuemax": accessibilityValue?.max, "aria-valuenow": accessibilityValue?.now, onClick: onPress, onInput: onChangeText ? (event: any) => onChangeText(event.target.value) : undefined }, children);
  return { View: element("div"), Text: element("span"), Pressable: element("button"), TextInput: element("input"), Image: ({ source, ...props }: any) => React.createElement("img", { ...props, src: source?.uri }) };
});

import { Button, FilmCard, FocusChip, JourneySteps, MomentTile, TextField } from "../components/ds";

let root: Root;
let host: HTMLDivElement;
beforeEach(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
async function render(node: React.ReactNode) { await act(async () => root.render(<>{node}</>)); }

describe("design system base components", () => {
  it("renders accessible button variants, disabled state, loading state, and presses", async () => {
    const onPress = vi.fn();
    await render(<><Button label="Save" onPress={onPress} /><Button label="Skip" variant="secondary" /><Button label="Replay" variant="quiet" size="sm" /><Button label="Media" variant="on-media" /><Button label="Saving" loading /><Button label="Unavailable" disabled /></>);
    const buttons = [...host.querySelectorAll('[role="button"]')];
    expect(buttons.map((button) => button.textContent)).toEqual(["Save", "Skip", "Replay", "Media", "Saving", "Unavailable"]);
    expect(buttons[5]?.getAttribute("aria-disabled")).toBe("true");
    await act(async () => buttons[0]?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    await act(async () => buttons[5]?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(onPress).toHaveBeenCalledOnce();
  });

  it("renders labeled text fields, hint and error state", async () => {
    const onChangeText = vi.fn();
    await render(<><TextField label="Email address" value="" onChangeText={onChangeText} hint="Use your email" /><TextField label="Name" value="" onChangeText={onChangeText} error="Name is required" multiline /></>);
    expect(host.querySelector('input[aria-label="Email address"]')).not.toBeNull();
    expect(host.textContent).toContain("Use your email");
    expect(host.querySelector('[aria-invalid="true"]')).not.toBeNull();
    expect(host.textContent).toContain("Name is required");
    await act(async () => host.querySelector("input")?.dispatchEvent(new Event("input", { bubbles: true })));
    expect(onChangeText).toHaveBeenCalled();
  });

  it("exposes chip selected state and responds to press", async () => {
    const onPress = vi.fn();
    await render(<><FocusChip label="Scenery" selected onPress={onPress} /><FocusChip label="Food" /></>);
    const scenery = host.querySelector('[aria-label="Scenery"]')!;
    expect(scenery.getAttribute("aria-pressed")).toBe("true");
    await act(async () => scenery.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(onPress).toHaveBeenCalledOnce();
  });

  it("shows journey progress without making the steps navigable", async () => {
    await render(<JourneySteps current={4} compact />);
    expect(host.textContent).toContain("Direct");
    expect(host.textContent).toContain("Step 4 of 6");
    expect(host.querySelector('[role="progressbar"]')?.getAttribute("aria-valuenow")).toBe("4");
    expect(host.querySelectorAll('button,[role="button"]')).toHaveLength(0);
  });

  it("shows selected state and clip duration on a moment tile", async () => {
    const onPress = vi.fn();
    await render(<MomentTile label="Ramen stall, Day 2" selected clip duration="0:06" onPress={onPress} />);
    const tile = host.querySelector('[role="button"]')!;
    expect(tile.getAttribute("aria-pressed")).toBe("true");
    expect(tile.getAttribute("aria-label")).toContain("Ramen stall, Day 2");
    expect(host.textContent).toContain("0:06");
    expect(host.querySelector('[aria-label="Selected"]')).not.toBeNull();
    await act(async () => tile.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(onPress).toHaveBeenCalledOnce();
  });

  it("shows FilmCard title, metadata, status, and duration and supports presses", async () => {
    const onPress = vi.fn();
    await render(<FilmCard title="Japan, autumn" meta="38 moments · 3 min 20 s" status="Ready to watch" duration="3:20" onPress={onPress} />);
    expect(host.textContent).toContain("Japan, autumn");
    expect(host.textContent).toContain("38 moments · 3 min 20 s");
    expect(host.textContent).toContain("Ready to watch");
    expect(host.textContent).toContain("3:20");
    const card = host.querySelector(`[role="button"][aria-label*="Japan, autumn"]`)!;
    expect(card).not.toBeNull();
    await act(async () => card.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(onPress).toHaveBeenCalledOnce();
  });
});
