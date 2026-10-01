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

  it("fills the viewport while scrolling moments and pinning the add footer", async () => {
    await render(<MomentPickerSheet days={[{ label: "Day 2 · Kyoto", tiles: [{ shotId: "s1", uri: "/one.jpg" }] }]} selected={[]} onToggle={vi.fn()} onCancel={vi.fn()} onConfirm={vi.fn()} />);
    const dialog = host.querySelector('[role="dialog"]') as HTMLElement;
    const sheet = dialog.firstElementChild as HTMLElement;
    const scrollArea = sheet.querySelector(".overflow-y-auto") as HTMLElement;
    const footer = sheet.lastElementChild as HTMLElement;
    expect(dialog.className).toContain("absolute");
    expect(dialog.className).toContain("inset-0");
    expect(sheet.className).toContain("mt-3");
    expect(sheet.className).toContain("flex-1");
    expect(scrollArea.className).toContain("min-h-0");
    expect(scrollArea.className).toContain("flex-1");
    expect(footer.className).toContain("shrink-0");
  });

  it("closes on a downward header drag but keeps the sheet open for short or upward touches", async () => {
    const onCancel = vi.fn();
    await render(<MomentPickerSheet days={[]} selected={[]} onToggle={vi.fn()} onCancel={onCancel} onConfirm={vi.fn()} />);
    const header = host.querySelector('[aria-label="Moment picker header"]') as HTMLElement;
    const touch = (type: string, pageY: number) => {
      const event = new Event(type, { bubbles: true });
      Object.defineProperty(event, "pageY", { value: pageY });
      header.dispatchEvent(event);
    };
    await act(async () => { touch("touchstart", 100); touch("touchend", 130); });
    expect(onCancel).not.toHaveBeenCalled();
    await act(async () => { touch("touchstart", 120); touch("touchend", 40); });
    expect(onCancel).not.toHaveBeenCalled();
    await act(async () => { touch("touchstart", 100); touch("touchend", 190); });
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("renders the direction controls and header progress", async () => {
    const onChange = vi.fn();
    await render(<><ChatDirectionCard pace="gentle" lengthSec={120} durations={[{ id: "30s", label: "30 sec", seconds: 30 }, { id: "1m", label: "1 min", seconds: 60 }, { id: "2m", label: "2 min", seconds: 120 }]} maximumDurationLabel="2 min" focus="family" collageAmount="few" motionFeel="calm" focusOptions={[{ id: "family", label: "Whole family" }, { id: "reactions", label: "Her reactions" }]} onChange={onChange} /><ChatHeader title="Japan, autumn" confirmed={3} ready={false} onBack={vi.fn()} /></>);
    expect(host.textContent).toContain("Pace"); expect(host.textContent).toContain("Length"); expect(host.textContent).toContain("Focus");
    expect(host.textContent).toContain("Style"); expect(host.textContent).toContain("Collages"); expect(host.textContent).toContain("Motion");
    expect(host.querySelector('[aria-label="A few"]')?.getAttribute("aria-pressed")).toBe("true");
    expect(host.querySelector('[aria-label="Calm"]')?.getAttribute("aria-pressed")).toBe("true");
    await click("Lots"); expect(onChange).toHaveBeenCalledWith({ collageAmount: "lots" });
    await click("Playful"); expect(onChange).toHaveBeenCalledWith({ motionFeel: "playful" });
    expect(host.textContent).toContain("3 of 4 confirmed");
    await click("Lively"); expect(onChange).toHaveBeenCalled();
  });

  it("shows shaping progress without promising a duration", async () => {
    await render(<ChatShaping progress={0.74} stepsDone={2} />);
    expect(host.textContent).toContain("Shaping your film");
    expect(host.textContent).toContain("Picked moments for each chapter");
    expect(host.textContent).not.toMatch(/\b\d+\s*(seconds?|minutes?)\b/i);
    expect(host.querySelector('[data-step="Picked moments for each chapter"]')?.getAttribute("data-status")).toBe("done");
    expect(host.querySelector('[data-step="Picked moments for each chapter"]')?.textContent).toBe("✓");
    expect(host.querySelector('[data-step="Trimmed the best parts of each clip"]')?.getAttribute("data-status")).toBe("done");
    expect(host.querySelector('[data-step="Film ready"]')?.getAttribute("data-status")).toBe("current");
    expect(host.querySelector('[data-step="Film ready"]')?.textContent).toBe("◷");
    const segments = [...host.querySelectorAll<HTMLElement>("[data-progress-segment]")];
    expect(segments).toHaveLength(10);
    expect(segments.filter((segment) => segment.getAttribute("data-filled") === "true")).toHaveLength(8);
    expect(parseFloat((segments[7]!.querySelector("[data-progress-fill]") as HTMLElement).style.width)).toBeCloseTo(40);
    await render(<ChatShaping progress={0.9} stepsDone={2} />);
    expect([...host.querySelectorAll("[data-progress-segment]")].filter((segment) => segment.getAttribute("data-filled") === "true")).toHaveLength(9);
  });
});
