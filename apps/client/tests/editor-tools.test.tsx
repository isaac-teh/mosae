import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Timeline } from "@mosae/contracts";
import type { Moment, Soundtrack } from "@mosae/core";
import type { StoryRepository } from "@mosae/core";

vi.mock("react-native", () => {
  const element = (tag: string) => ({ children, onPress, onChangeText, accessibilityLabel, numberOfLines, onLayout, onResponderGrant, onResponderMove, ...props }: any) => {
    React.useEffect(() => { onLayout?.({ nativeEvent: { layout: { width: 100 } } }); }, [onLayout]);
    return React.createElement(tag, { ...props, ...(accessibilityLabel ? { "aria-label": accessibilityLabel } : {}), ...(numberOfLines ? { "data-number-of-lines": numberOfLines } : {}), onClick: onPress, onInput: onChangeText ? (event: any) => onChangeText(event.target.value) : undefined, onTouchStart: onResponderGrant, onTouchMove: onResponderMove }, children);
  };
  return { View: element("div"), ScrollView: element("div"), Text: element("span"), Pressable: element("button"), TextInput: element("input"), Image: ({ source, ...props }: any) => React.createElement("img", { ...props, src: source?.uri }) };
});
vi.mock("expo-asset", () => ({ Asset: { fromModule: () => ({ uri: "fixture.jpg" }) } }));
vi.mock("@/lib/demoAssets", () => ({ demoImage: () => 1 }));

import { SwapSheet } from "../components/editor/SwapSheet";
import { TrimControl } from "../components/editor/TrimControl";
import { MoveMode } from "../components/editor/MoveMode";
import { AddSheet } from "../components/editor/AddSheet";
import { CollagePanel } from "../components/editor/CollagePanel";
import { SoundtrackSheet } from "../components/editor/SoundtrackSheet";
import { RemoveConfirm } from "../components/editor/RemoveConfirm";
import { EditorMenu } from "../components/editor/EditorMenu";
import { AskSheet } from "../components/editor/AskSheet";
import { TimelineStrip } from "../components/editor/TimelineStrip";

const clips = ["a", "b", "c"].map((id, index) => ({
  id, source: { kind: "photo" as const, shotId: `shot-${id}` }, startSec: index * 3, durationSec: 3,
  transitionIn: { kind: "cut" as const, durationSec: 0 },
}));
const timeline: Timeline = { schemaVersion: 1, projectId: "p1", mode: "memory", aspect: "9:16", fps: 30, durationSec: 9, chapters: [], videoClips: clips, audioClips: [], captions: [] };
const videoClip = { id: "video-1", source: { kind: "video" as const, shotId: "video-shot", sourceInSec: 1, sourceOutSec: 9 }, startSec: 0, durationSec: 8, transitionIn: { kind: "cut" as const, durationSec: 0 } };
const collage = { kind: "collage" as const, clipId: "collage-1", startSec: 0, durationSec: 4, transitionIn: { kind: "cut" as const, durationSec: 0 }, spec: { layoutId: "photo-table" as const, slots: [{ slotId: "s1", shotId: "shot-1", kind: "photo" as const }, { slotId: "s2", shotId: "shot-2", kind: "photo" as const }, { slotId: "s3", shotId: "shot-3", kind: "photo" as const }, { slotId: "s4", shotId: "shot-4", kind: "photo" as const }], motionId: "stack-deal" as const, effectId: "vignette" as const, seed: "seed", durationSec: 4 } };
const moments: Moment[] = [{ id: "m-left", title: "Left out moment", meta: "Day 1", tag: { emoji: "📷", label: "Photo" }, imageKey: "left.jpg", kind: "photo", selected: false, favorite: false, shotId: "shot-left" }];
const soundtracks: Soundtrack[] = [{ id: "soft-piano", name: "Soft piano", description: "Quiet and warm" }];

let host: HTMLDivElement;
let root: Root;
let apply: ReturnType<typeof vi.fn>;
const onSource = vi.fn();
const repo = { getAlternatives: vi.fn(async () => [{ shotId: "shot-alt", thumbnailUrl: "alt.jpg" }]) } as unknown as StoryRepository;
beforeEach(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; host = document.createElement("div"); document.body.append(host); root = createRoot(host); apply = vi.fn(); onSource.mockClear(); vi.mocked(repo.getAlternatives).mockClear(); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
async function render(element: React.ReactNode) { await act(async () => root.render(element)); }
async function click(label: string) { const target = host.querySelector(`[aria-label="${label}"]`) as HTMLElement | null; expect(target, `missing control: ${label}`).not.toBeNull(); await act(async () => target!.click()); }

describe("editor tool operations", () => {
  it("swaps a clip using same event alternatives", async () => {
    await render(<SwapSheet visible clipId="a" planId="proposal-1" momentId="m1" repository={repo} onApply={apply} onSource={onSource} onClose={() => {}} />);
    await act(async () => { await Promise.resolve(); });
    await click("Use alternative shot-alt");
    expect(repo.getAlternatives).toHaveBeenCalledWith("proposal-1", "m1");
    expect(apply).toHaveBeenCalledWith({ op: "swapShot", clipId: "a", shotId: "shot-alt" });
    expect(onSource).toHaveBeenCalledWith("shot-alt", "alt.jpg");
  });

  it("trims a video clip in source time", async () => {
    await render(<TrimControl clip={videoClip} onApply={apply} onClose={() => {}} />);
    const start = host.querySelector('[aria-label="Source in"]') as HTMLInputElement;
    const end = host.querySelector('[aria-label="Source out"]') as HTMLInputElement;
    await act(async () => { start.value = "2"; start.dispatchEvent(new Event("input", { bubbles: true })); end.value = "7"; end.dispatchEvent(new Event("input", { bubbles: true })); });
    await click("Apply trim");
    expect(apply).toHaveBeenCalledWith({ op: "trim", clipId: "video-1", inSec: 2, outSec: 7 });
  });

  it("changes photo duration in the supported range", async () => {
    await render(<TrimControl clip={clips[0]} onApply={apply} onClose={() => {}} />);
    await click("Photo duration 4 seconds");
    expect(apply).toHaveBeenCalledWith({ op: "setPhotoDuration", clipId: "a", sec: 4 });
  });

  it("explains when a photo duration edit is rejected", async () => {
    apply.mockReturnValue(false);
    await render(<TrimControl clip={clips[0]} onApply={apply} onClose={() => {}} />);
    await click("Photo duration 2 seconds");
    expect(host.textContent).toContain("That change couldn’t be applied. Try another edit.");
    expect(host.querySelector('[aria-label="Photo duration 2 seconds"]')).not.toBeNull();
  });

  it("moves a clip to the pointer drop position", async () => {
    await render(<MoveMode timeline={timeline} clipId="a" onApply={apply} onClose={() => {}} />);
    const source = host.querySelector('[aria-label="Move clip a"]')!;
    const target = host.querySelector('[aria-label="Drop clip at position 3"]')!;
    await act(async () => source.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true })));
    await act(async () => target.dispatchEvent(new MouseEvent("pointerup", { bubbles: true })));
    expect(apply).toHaveBeenCalledWith({ op: "move", clipId: "a", toIndex: 2 });
  });

  it("adds a left-out moment after the selected clip", async () => {
    await render(<AddSheet visible moments={moments} selectedClipId="b" onApply={apply} onClose={() => {}} />);
    await click("Add Left out moment");
    expect(apply).toHaveBeenCalledWith({ op: "add", shotId: "shot-left", kind: "photo", afterClipId: "b", durationSec: 3 });
  });

  it("adds a video moment with its source bounds", async () => {
    const videoMoment = { ...moments[0], id: "m-video", title: "Video moment", kind: "video" as const, sourceInSec: 2, sourceOutSec: 10 };
    await render(<AddSheet visible moments={[videoMoment]} selectedClipId="b" onApply={apply} onClose={() => {}} />);
    await click("Add Video moment");
    expect(apply).toHaveBeenCalledWith({ op: "add", shotId: "shot-left", kind: "video", afterClipId: "b", durationSec: 6, sourceInSec: 2, sourceOutSec: 10 });
  });

  it("keeps long chapter names to one line inside their chapter widths", async () => {
    const chapterTimeline: Timeline = {
      ...timeline,
      chapters: [
        { title: "A very long opening chapter title that needs truncating", startSec: 0, durationSec: 3 },
        { title: "A second chapter title that also must stay on one line", startSec: 3, durationSec: 6 },
      ],
    };
    await render(<TimelineStrip timeline={chapterTimeline} sources={{}} selectedClipId={null} playheadSec={0} onSelect={() => {}} onScrub={() => {}} />);
    const labels = [...host.querySelectorAll('[data-number-of-lines="1"]')];
    expect(labels).toHaveLength(2);
    expect(labels.every((label) => Number.parseFloat((label.parentElement as HTMLElement).style.width) > 0)).toBe(true);
  });

  it("selects a strip clip at its actual timeline start and shows the current playhead", async () => {
    const onSelect = vi.fn();
    await render(<TimelineStrip timeline={timeline} sources={{}} selectedClipId={null} playheadSec={4.5} onSelect={onSelect} onScrub={() => {}} />);
    await click("Select clip b");
    expect(onSelect).toHaveBeenCalledWith("b", 3);
    expect(host.querySelector('[aria-label="Timeline playhead"]')?.getAttribute("style")).toContain("left: 50%");
  });

  it("maps scrub bar touch positions to timeline seconds", async () => {
    const onScrub = vi.fn();
    await render(<TimelineStrip timeline={timeline} sources={{}} selectedClipId={null} playheadSec={0} onSelect={() => {}} onScrub={onScrub} />);
    const scrubber = host.querySelector('[aria-label="Scrub timeline"]') as HTMLElement;
    await act(async () => scrubber.dispatchEvent(Object.assign(new Event("touchstart", { bubbles: true }), { locationX: 25 })));
    await act(async () => scrubber.dispatchEvent(Object.assign(new Event("touchmove", { bubbles: true }), { locationX: 75 })));
    expect(onScrub).toHaveBeenLastCalledWith(6.75);
  });

  it("uses page coordinates when a browser touch has no locationX", async () => {
    const onScrub = vi.fn();
    await render(<TimelineStrip timeline={timeline} sources={{}} selectedClipId={null} playheadSec={0} onSelect={() => {}} onScrub={onScrub} />);
    const scrubber = host.querySelector('[aria-label="Scrub timeline"]') as HTMLElement;
    vi.spyOn(scrubber, "getBoundingClientRect").mockReturnValue({ x: 40, y: 0, left: 40, right: 140, top: 0, bottom: 10, width: 100, height: 10, toJSON: () => ({}) });
    await act(async () => scrubber.dispatchEvent(Object.assign(new Event("touchmove", { bubbles: true }), { pageX: 115 })));
    expect(onScrub).toHaveBeenCalledWith(6.75);
  });

  it("shows selected collage chips, every allowed layout, and only motions allowed by the selected layout", async () => {
    await render(<CollagePanel clip={collage} sources={{ "shot-1": "one.jpg", "shot-2": "two.jpg", "shot-3": "three.jpg", "shot-4": "four.jpg" }} slotAlternatives={{ s1: [{ shotId: "slot-alt", thumbnailUrl: "alt.jpg" }] }} onApply={apply} onSource={onSource} onClose={() => {}} />);
    expect(host.querySelector('[aria-label="Layout Photo table"]')?.getAttribute("aria-pressed")).toBe("true");
    expect(host.querySelector('[aria-label="Motion Stack deal"]')?.getAttribute("aria-pressed")).toBe("true");
    expect(host.querySelector('[aria-label="Effect Vignette"]')?.getAttribute("aria-pressed")).toBe("true");
    for (const label of ["Photo table", "Torn paper mosaic", "Polaroid garland", "Film negative", "Postcard stack", "Route map"]) {
      expect(host.querySelector(`[aria-label="Layout ${label}"]`)).not.toBeNull();
    }
    await click("Layout Torn paper mosaic");
    expect(apply).toHaveBeenLastCalledWith([
      { op: "setCollageLayout", clipId: "collage-1", layoutId: "torn-paper" },
      { op: "setCollageMotion", clipId: "collage-1", motionId: "print-drop" },
    ]);
    expect(host.querySelector('[aria-label="Motion Print drop"]')).not.toBeNull();
    expect(host.querySelector('[aria-label="Motion Tape slap"]')).not.toBeNull();
    expect(host.querySelector('[aria-label="Motion Stack deal"]')).toBeNull();
  });

  it("shows a photo thumbnail and lets the user replace a collage slot", async () => {
    await render(<CollagePanel clip={collage} sources={{ "shot-1": "one.jpg", "shot-2": "two.jpg", "shot-3": "three.jpg", "shot-4": "four.jpg" }} slotAlternatives={{ s1: [{ shotId: "slot-alt", thumbnailUrl: "alt.jpg" }] }} onApply={apply} onSource={onSource} onClose={() => {}} />);
    expect(host.querySelector('img[src="one.jpg"]')).not.toBeNull();
    expect(host.textContent).toContain("Photo 1");
    await click("Replace Photo 1");
    await click("Replace Photo 1 with option 1");
    expect(apply).toHaveBeenLastCalledWith({ op: "replaceCollageSlot", clipId: "collage-1", slotId: "s1", shotId: "slot-alt", kind: "photo" });
    expect(onSource).toHaveBeenCalledWith("slot-alt", "alt.jpg");
  });

  it("emits collage effect and split operations", async () => {
    await render(<CollagePanel clip={collage} onApply={apply} onSource={onSource} onClose={() => {}} />);
    await click("Effect Warm grade");
    expect(apply).toHaveBeenLastCalledWith({ op: "setCollageEffect", clipId: "collage-1", effectId: "warm-grade" });
    await click("Split into single photos");
    expect(apply).toHaveBeenLastCalledWith({ op: "splitCollage", clipId: "collage-1" });
  });

  it("refuses a second video in a collage slot", async () => {
    const withVideo = { ...collage, spec: { ...collage.spec, slots: collage.spec.slots.map((slot, index) => index === 0 ? { ...slot, kind: "video" as const } : slot) } };
    await render(<CollagePanel clip={withVideo} slotAlternatives={{ s2: [{ shotId: "video-alt", thumbnailUrl: "alt.jpg", kind: "video" }] }} onApply={apply} onSource={onSource} onClose={() => {}} />);
    await click("Replace Photo 2");
    await click("Replace Photo 2 with option 1");
    expect(host.textContent).toContain("A collage can hold one video.");
    expect(apply).not.toHaveBeenCalled();
  });

  it("previews an Ask proposal without editing, then applies all operations together", async () => {
    const askRepository = { interpretEdit: vi.fn(async () => ({ reply: "Move the second photo earlier?", ops: [{ op: "move" as const, clipId: "b", toIndex: 0 }] })) };
    await render(<AskSheet visible projectId="p1" generationId="g1" revision={0} timeline={timeline} sources={{}} repository={askRepository} initialRequest="move this earlier" onApply={apply} onClose={() => {}} />);
    expect((host.querySelector('[aria-label="Ask for an edit"]') as HTMLInputElement).value).toBe("move this earlier");
    await click("Suggest edit");
    expect(askRepository.interpretEdit).toHaveBeenCalledWith("p1", "g1", "move this earlier", 0);
    expect(host.textContent).toContain("Move the second photo earlier?");
    expect(host.textContent).toContain("Before");
    expect(host.textContent).toContain("After");
    expect(apply).not.toHaveBeenCalled();
    await click("Apply edits");
    expect(apply).toHaveBeenCalledOnce();
    expect(apply).toHaveBeenCalledWith([{ op: "move", clipId: "b", toIndex: 0 }]);
  });

  it("sets the selected soundtrack", async () => {
    await render(<SoundtrackSheet visible soundtracks={soundtracks} onApply={apply} onClose={() => {}} />);
    await click("Choose Soft piano");
    expect(apply).toHaveBeenCalledWith({ op: "setSoundtrack", soundtrackId: "soft-piano" });
  });

  it("confirms removal and exposes undo", async () => {
    const undo = vi.fn();
    await render(<RemoveConfirm clipId="b" onApply={apply} onUndo={undo} />);
    await click("Remove clip");
    expect(apply).toHaveBeenCalledWith({ op: "remove", clipId: "b" });
    await click("Undo remove");
    expect(undo).toHaveBeenCalledOnce();
  });

  it("clears edits only after confirming back to first cut", async () => {
    await render(<EditorMenu onReset={apply} />);
    await click("More editor actions");
    await click("Back to first cut");
    expect(apply).not.toHaveBeenCalled();
    await click("Confirm back to first cut");
    expect(apply).toHaveBeenCalledWith([]);
  });
});
