import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react-native", () => {
  const element = (tag: string) => ({ children, onPress, onChangeText, accessibilityRole, accessibilityLabel, accessibilityState, accessibilityValue, accessibilityLiveRegion, accessibilityHint, editable, resizeMode, textAlignVertical, ...props }: any) =>
    React.createElement(tag, { ...props, role: props.role ?? accessibilityRole, "aria-label": props["aria-label"] ?? accessibilityLabel, "aria-disabled": accessibilityState?.disabled, "aria-pressed": accessibilityState?.selected, "aria-valuemin": accessibilityValue?.min, "aria-valuemax": accessibilityValue?.max, disabled: props.disabled ?? (editable === false ? true : undefined), onClick: onPress, onInput: onChangeText ? (event: any) => onChangeText(event.target.value) : undefined }, children);
  return { View: element("div"), Text: element("span"), Pressable: element("button"), TextInput: element("input"), Image: ({ source, accessibilityLabel, resizeMode, onLoad, ...props }: any) => React.createElement("img", { ...props, onLoad: onLoad ? () => onLoad({ nativeEvent: { source: { width: 400, height: 200 } } }) : undefined, src: source?.uri, alt: accessibilityLabel }) };
});

import { ChatComposer, ChatDirectionCard, ChatHeader, ChatMessage, ChatMomentGrid, ChatPeoplePick, ChatPersonQuestion, ChatProposal, ChatShaping, ChatTyping, MomentPickerSheet } from "../components/chat";

let root: Root;
let host: HTMLDivElement;
beforeEach(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
async function render(node: React.ReactNode) { await act(async () => root.render(<>{node}</>)); }
async function click(label: string) { const button = host.querySelector(`[aria-label="${label}"]`) ?? [...host.querySelectorAll("button")].find((item) => item.textContent?.trim() === label); expect(button).not.toBeNull(); await act(async () => button!.dispatchEvent(new MouseEvent("click", { bubbles: true }))); }

describe("director chat components", () => {
  it("aligns Mosaé messages plainly and puts user messages in a bubble", async () => {
    await render(<><ChatMessage from="mosae" text="Hello" facts={["Japan", "7 days"]} photos={["/one.jpg", "/two.jpg"]} /><ChatMessage from="you" text="Our trip" /></>);
    expect(host.textContent).toContain("Hello");
    expect(host.textContent).toContain("Japan");
    expect(host.querySelectorAll("img")).toHaveLength(2);
    expect(host.textContent).toContain("Our trip");
    expect(host.querySelector('[data-from="mosae"]')).not.toBeNull();
    expect(host.querySelector('[data-from="you"]')).not.toBeNull();
  });

  it("shows three quiet typing tiles and the supplied status without a duration", async () => {
    await render(<ChatTyping text="Shaping your film…" />);
    expect(host.textContent).toContain("Shaping your film…");
    expect(host.querySelectorAll('[aria-hidden="true"]')).toHaveLength(3);
    expect(host.textContent).not.toMatch(/\b\d+\s*(seconds?|minutes?)\b/i);
  });

  it("renders proposal replies and calls onReply with the selected id", async () => {
    const onReply = vi.fn();
    await render(<ChatProposal label="PACE" question="About 3 minutes, unhurried?" detail="Good for watching together." replies={[{ id: "yes", label: "Sounds right" }, { id: "shorter", label: "Shorter" }]} onReply={onReply} />);
    expect(host.textContent).toContain("Good for watching together.");
    await click("Shorter");
    expect(onReply).toHaveBeenCalledWith("shorter");
  });

  it("renders square people faces and toggles people in the picker", async () => {
    const onToggle = vi.fn();
    await render(<ChatPeoplePick people={[{ personId: "mia", uri: "/mia.jpg", name: "Mia" }]} selected={[]} onToggle={onToggle} onAddName={vi.fn()} onDone={vi.fn()} />);
    expect(host.querySelector('img[alt="Mia"]')).not.toBeNull();
    await click("Mia");
    expect(onToggle).toHaveBeenCalledWith("mia");
  });

  it("shows each person question's photos, days, role choices, and skip action", async () => {
    const onPick = vi.fn(); const onTypeName = vi.fn(); const onSkip = vi.fn();
    await render(<ChatPersonQuestion momentCount={212} samples={["/a.jpg", "/b.jpg", "/c.jpg", "/d.jpg"].map((uri, index) => ({ uri, bbox: [0.4, 0.2, 0.7, 0.5] as [number, number, number, number], shotId: `s${index}` }))} days={[2, 3, 5, 6]} chips={["My daughter", "My wife", "Me"]} onPick={onPick} onTypeName={onTypeName} onSkip={onSkip} />);
    expect(host.textContent).toContain("One person appears in 212 moments. Who is this?");
    expect(host.textContent).toContain("4 of 212 shown · Day 2, 3, 5 and 6");
    expect(host.querySelectorAll('[data-face-preview="true"]')).toHaveLength(4);
    expect(host.querySelector('[data-face-preview="true"]')?.className).toContain("rounded-md");
    const firstImage = host.querySelector('[data-face-preview="true"] img') as HTMLImageElement;
    await act(async () => firstImage.dispatchEvent(new Event("load")));
    // With a 400×200 source and [ymin,xmin,ymax,xmax] = [0.4,0.2,0.7,0.5],
    // the 30%-padded face crop has a 192px square source window, scaled to 72px.
    expect(firstImage.style.position).toBe("absolute");
    expect(firstImage.style.width).toBe("150px");
    expect(firstImage.style.height).toBe("75px");
    expect(firstImage.style.left).toBe("-16.5px");
    expect(firstImage.style.top).toBe("-3px");
    await click("My daughter"); expect(onPick).toHaveBeenCalledWith("My daughter");
    await click("Type a name"); expect(onTypeName).toHaveBeenCalledOnce();
    expect(host.querySelectorAll("[role=button]")).toHaveLength(5);
    await click("Skip"); expect(onSkip).toHaveBeenCalledOnce();
  });

  it("cycles inline moment tiles and reports kept and left out counts", async () => {
    const onTap = vi.fn(); const onDone = vi.fn(); const onChooseAll = vi.fn();
    await render(<ChatMomentGrid tiles={[{ shotId: "s1", uri: "/one.jpg" }, { shotId: "s2", uri: "/two.jpg" }]} state={{ s1: "keep", s2: "leave" }} onTap={onTap} total={465} onChooseAll={onChooseAll} onDone={onDone} />);
    expect(host.textContent).toContain("1 kept · 1 left out");
    await click("Moment s1, Keep, Selected"); expect(onTap).toHaveBeenCalledWith("s1");
    await click("Choose from all 465"); expect(onChooseAll).toHaveBeenCalledOnce();
    await click("Done"); expect(onDone).toHaveBeenCalledOnce();
  });

  it("sends composer text without duplicating header confirmation progress", async () => {
    const onSend = vi.fn();
    await render(<ChatComposer placeholder="Tell me anything about the story" onSend={onSend} />);
    const input = host.querySelector("input") as HTMLInputElement;
    await act(async () => { input.value = "Grandma's birthday"; input.dispatchEvent(new Event("input", { bubbles: true })); });
    await click("Send");
    expect(onSend).toHaveBeenCalledWith("Grandma's birthday");
    expect(host.textContent).not.toContain("3 of 4 confirmed");
  });

  it("opens a grouped moment picker and confirms the selected result", async () => {
    const onToggle = vi.fn(); const onConfirm = vi.fn();
    await render(<MomentPickerSheet days={[{ label: "Day 2 · Kyoto", tiles: [{ shotId: "s1", uri: "/one.jpg" }] }]} selected={["s1"]} onToggle={onToggle} onCancel={vi.fn()} onConfirm={onConfirm} />);
    expect(host.textContent).toContain("Must-include moments");
    expect(host.textContent).toContain("1 selected");
    expect(host.textContent).toContain("Day 2 · Kyoto");
    await click("Add 1 moments"); expect(onConfirm).toHaveBeenCalledOnce();
  });

  it("renders the direction controls and header progress", async () => {
    const onChange = vi.fn();
    await render(<><ChatDirectionCard pace="gentle" lengthSec={120} focus="family" focusOptions={[{ id: "family", label: "Whole family" }, { id: "reactions", label: "Her reactions" }]} onChange={onChange} /><ChatHeader title="Japan, autumn" confirmed={3} ready={false} onBack={vi.fn()} /></>);
    expect(host.textContent).toContain("Pace"); expect(host.textContent).toContain("Length"); expect(host.textContent).toContain("Focus");
    expect(host.textContent).toContain("3 of 4 confirmed");
    await click("Lively"); expect(onChange).toHaveBeenCalled();
  });

  it("shows shaping progress without promising a duration", async () => {
    await render(<ChatShaping stepsDone={2} />);
    expect(host.textContent).toContain("Shaping your film");
    expect(host.textContent).toContain("Picked moments for each chapter");
    expect(host.textContent).not.toMatch(/\b\d+\s*(seconds?|minutes?)\b/i);
  });
});
