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
  const ScrollView = React.forwardRef(({ children, onLayout, onScroll, onScrollBeginDrag, onScrollEndDrag, onTouchStart, onTouchMove, accessibilityLabel, ...props }: any, ref: any) => {
    React.useEffect(() => { onLayout?.({ nativeEvent: { layout: { width: 100 } } }); }, [onLayout]);
    React.useImperativeHandle(ref, () => ({ scrollTo: (...args: any[]) => mockScrollTo(...args) }));
    return React.createElement("div", { ...props, "aria-label": accessibilityLabel, onPointerDown: onScrollBeginDrag, onPointerUp: onScrollEndDrag, onTouchStart, onTouchMove, onScroll: (event: any) => onScroll?.({ nativeEvent: { contentOffset: { x: event.currentTarget.scrollLeft } } }) }, children);
  });
  return { Platform: { OS: "web" }, View: element("div"), ScrollView, Text: element("span"), Pressable: element("button"), TextInput: element("input"), Image: ({ source, ...props }: any) => React.createElement("img", { ...props, src: source?.uri }) };
});
vi.mock("expo-asset", () => ({ Asset: { fromModule: () => ({ uri: "fixture.jpg" }) } }));
vi.mock("@/lib/demoAssets", () => ({ demoImage: () => 1 }));

import { SwapSheet } from "../components/editor/SwapSheet";
import { TrimControl } from "../components/editor/TrimControl";
import { MoveMode } from "../components/editor/MoveMode";
import { AddSheet } from "../components/editor/AddSheet";
import { CollagePanel, transitionCollageSheet } from "../components/editor/CollagePanel";
import { CollageCellSheet } from "../components/editor/CollageCellSheet";
import { SoundtrackSheet } from "../components/editor/SoundtrackSheet";
import { AudioVolumeSheet } from "../components/editor/AudioVolumeSheet";
import { RemoveConfirm } from "../components/editor/RemoveConfirm";
import { EditorMenu } from "../components/editor/EditorMenu";
import { AskSheet } from "../components/editor/AskSheet";
import { TimelineStrip } from "../components/editor/TimelineStrip";
import { xToTime } from "../components/editor/timelineScale";

const mockScrollTo = vi.fn();

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
beforeEach(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined); host = document.createElement("div"); document.body.append(host); root = createRoot(host); apply = vi.fn(); onSource.mockClear(); vi.mocked(repo.getAlternatives).mockClear(); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
async function render(element: React.ReactNode) { await act(async () => root.render(element)); }
async function click(label: string) { const target = host.querySelector(`[aria-label="${label}"]`) as HTMLElement | null; expect(target, `missing control: ${label}`).not.toBeNull(); await act(async () => target!.click()); }

describe("editor tool operations", () => {
  it("expands and collapses the collage sheet from taps and vertical drags", () => {
    expect(transitionCollageSheet("collapsed")).toBe("expanded");
    expect(transitionCollageSheet("expanded")).toBe("collapsed");
    expect(transitionCollageSheet("collapsed", -80)).toBe("expanded");
    expect(transitionCollageSheet("expanded", 80)).toBe("collapsed");
    expect(transitionCollageSheet("expanded", -10)).toBe("expanded");
  });

  it("swaps a clip using same event alternatives", async () => {
    await render(<SwapSheet visible clipId="a" planId="proposal-1" momentId="m1" repository={repo} onApply={apply} onSource={onSource} onClose={() => {}} />);
    await act(async () => { await Promise.resolve(); });
    await click("Use alternative shot-alt");
    expect(repo.getAlternatives).toHaveBeenCalledWith("proposal-1", "m1");
    expect(apply).toHaveBeenCalledWith({ op: "swapShot", clipId: "a", shotId: "shot-alt" });
    expect(onSource).toHaveBeenCalledWith("shot-alt", "alt.jpg");
  });

  it("replaces a photo from already-uploaded project media", async () => {
    await render(<SwapSheet visible clipId="a" kind="photo" moments={moments} planId={null} momentId={null} repository={repo} onApply={apply} onSource={onSource} onClose={() => {}} />);
    await click("Replace with Left out moment");
    expect(onSource).toHaveBeenCalledWith("shot-left", "left.jpg");
    expect(apply).toHaveBeenCalledWith({ op: "swapShot", clipId: "a", shotId: "shot-left" });
  });

  it("hands a device-selected photo to the project replacement uploader", async () => {
    const onUploadFile = vi.fn();
    await render(<SwapSheet visible clipId="a" kind="photo" planId={null} momentId={null} repository={repo} onUploadFile={onUploadFile} onApply={apply} onSource={onSource} onClose={() => {}} />);
    const input = host.querySelector('[aria-label="Choose files from phone"]') as HTMLInputElement;
    const file = new File(["photo"], "replacement.jpg", { type: "image/jpeg" });
    Object.defineProperty(input, "files", { configurable: true, value: [file] });
    await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
    expect(onUploadFile).toHaveBeenCalledWith(file);
  });

  it("hands a device-selected photo to the captured collage cell uploader", async () => {
    const onUploadFile = vi.fn();
    await render(<CollageCellSheet mode="replace" clip={collage} slotId="s2" moments={moments} onUploadFile={onUploadFile} onApply={apply} onClose={() => {}} />);
    const input = host.querySelector('[aria-label="Choose files from phone"]') as HTMLInputElement;
    const file = new File(["photo"], "cell.jpg", { type: "image/jpeg" });
    Object.defineProperty(input, "files", { configurable: true, value: [file] });
    await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
    expect(onUploadFile).toHaveBeenCalledWith(file, "collage-1", "s2");
  });

  it("uses a shared text-free square grid for collage media choices", async () => {
    await render(<CollageCellSheet mode="replace" clip={collage} slotId="s2" moments={moments} onApply={apply} onClose={() => {}} />);
    expect(host.querySelector('[aria-label="Replace with Left out moment"]')).not.toBeNull();
    expect(host.textContent).not.toContain("Left out moment");
    expect(host.querySelector('[aria-label="Replace with Left out moment"]')?.getAttribute("style")).toContain("aspect-ratio: 1");
  });

  it("replaces a collage cell from project gallery and installs its preview source", async () => {
    await render(<CollageCellSheet mode="replace" clip={collage} slotId="s2" moments={moments} sources={{ "shot-left": "https://media.test/photo.jpg" }} onSource={onSource} onApply={apply} onClose={() => {}} />);
    await click("Replace with Left out moment");
    expect(onSource).toHaveBeenCalledWith("shot-left", "https://media.test/photo.jpg");
    expect(apply).toHaveBeenCalledWith({ op: "replaceCollageSlot", clipId: "collage-1", slotId: "s2", shotId: "shot-left", kind: "photo" });
  });

  it("shows Add photo for an empty collage cell and opens its picker", async () => {
    const { ToolBar } = await import("../components/editor/ToolBar");
    await render(<ToolBar selection="collageCell" emptyCollageCell onTool={() => {}} />);
    expect(host.querySelector('[aria-label="Add photo"]')?.textContent).toContain("Add photo");
    expect(host.querySelector('[aria-label="Add photo"]')?.firstElementChild?.textContent).toBe("+");
  });

  it("adds from the shared grid after the selected clip", async () => {
    const inFilm = { ...moments[0], id: "m-used", shotId: "shot-used", title: "Already in film", selected: true };
    await render(<AddSheet visible moments={[inFilm, moments[0]]} selectedClipId="b" timeline={timeline} playheadSec={1} onApply={apply} onClose={() => {}} />);
    expect(host.textContent).not.toContain("Left out moment");
    expect(host.querySelector('[aria-label="In film"]')).not.toBeNull();
    expect([...host.querySelectorAll('button[aria-label^="Add "]')].map((button) => button.getAttribute("aria-label"))).toEqual(["Add Left out moment", "Add Already in film"]);
    expect(host.querySelector('[aria-label="Add Already in film"]')?.getAttribute("disabled")).toBeNull();
    await click("Add Left out moment");
    expect(apply).toHaveBeenCalledWith(expect.objectContaining({ op: "add", afterClipId: "b" }));
  });

  it("shows the empty state only when project media is empty", async () => {
    await render(<AddSheet visible moments={[]} selectedClipId={null} onApply={apply} onClose={() => {}} />);
    expect(host.textContent).toContain("No photos or videos from this trip are available.");
    await render(<AddSheet visible moments={[{ ...moments[0], selected: true }]} selectedClipId={null} onApply={apply} onClose={() => {}} />);
    expect(host.textContent).not.toContain("No photos or videos");
    expect(host.querySelectorAll('button[aria-label^="Add "]')).toHaveLength(1);
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

  it("inserts uploaded media in selection order after the selected clip", async () => {
    const first = { ...moments[0]!, id: "uploaded-a", shotId: "uploaded-a", title: "Phone photo A" };
    const second = { ...moments[0]!, id: "uploaded-b", shotId: "uploaded-b", title: "Phone photo B" };
    const onUploadFiles = vi.fn(async () => [first, second]);
    await render(<AddSheet visible moments={[]} selectedClipId="b" onUploadFiles={onUploadFiles} onApply={apply} onClose={() => {}} />);
    const input = host.querySelector('[aria-label="Choose files from phone"]') as HTMLInputElement;
    const files = [new File(["a"], "a.jpg", { type: "image/jpeg" }), new File(["b"], "b.jpg", { type: "image/jpeg" })];
    Object.defineProperty(input, "files", { configurable: true, value: files });
    await act(async () => { input.dispatchEvent(new Event("change", { bubbles: true })); await Promise.resolve(); await Promise.resolve(); });
    expect(onUploadFiles).toHaveBeenCalledWith(files);
    expect(apply).toHaveBeenCalledWith([
      { op: "add", shotId: "uploaded-a", kind: "photo", afterClipId: "b", durationSec: 3 },
      { op: "add", shotId: "uploaded-b", kind: "photo", afterClipId: "add:uploaded-a:1", durationSec: 3 },
    ]);
  });

  it("shows uploaded-media thumbnails in newest-day order", async () => {
    const next = { ...moments[0], id: "newer", title: "Photo · Day 3, evening", meta: "2026-06-03", imageKey: "newer.jpg" };
    const older = { ...moments[0], id: "older", title: "Photo · Day 2, morning", meta: "2026-06-02", imageKey: "older.jpg" };
    await render(<AddSheet visible moments={[next, older]} selectedClipId="b" onApply={apply} onClose={() => {}} />);
    expect([...host.querySelectorAll('button[aria-label^="Add Photo"]')].map((button) => button.getAttribute("aria-label"))).toEqual(["Add Photo · Day 3, evening", "Add Photo · Day 2, morning"]);
    expect(host.textContent).not.toContain("Day 3, evening");
    expect([...host.querySelectorAll("img")].map((image) => image.getAttribute("src"))).toEqual(["newer.jpg", "older.jpg"]);
  });

  it("uses the clip under the playhead when nothing is selected", async () => {
    await render(<AddSheet visible moments={moments} selectedClipId={null} timeline={timeline} playheadSec={4} onApply={apply} onClose={() => {}} />);
    await click("Add Left out moment");
    expect(apply).toHaveBeenCalledWith(expect.objectContaining({ afterClipId: "b" }));
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
    const labels = [...host.querySelectorAll('[aria-label^="Chapter "] [data-number-of-lines="1"]')];
    expect(labels).toHaveLength(2);
    expect(labels.every((label) => Number.parseFloat((label.parentElement as HTMLElement).style.width) > 0)).toBe(true);
  });

  it("renders video poster frames repeatedly across a timeline slot without a video element", async () => {
    const videoTimeline: Timeline = { ...timeline, durationSec: 8, videoClips: [videoClip] };
    await render(<TimelineStrip {...({ timeline: videoTimeline, sources: { "video-shot": "proxy.mp4" }, thumbnails: { "video-shot": "poster.jpg" }, selectedClipId: null, playheadSec: 0, onSelect: () => {}, onScrub: () => {} } as any)} />);
    const slot = host.querySelector('[aria-label="Select clip video-1"]')!;
    const frames = [...slot.querySelectorAll('[data-video-frame="true"]')];
    expect(frames.length).toBeGreaterThan(1);
    expect(frames.every((frame) => (frame as HTMLImageElement).getAttribute("src") === "poster.jpg")).toBe(true);
    expect(slot.querySelector('[aria-label="Video clip badge"]')?.textContent).toBe("VIDEO");
    expect(slot.querySelector("video")).toBeNull();
    const contextMenu = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    await act(async () => slot.dispatchEvent(contextMenu));
    expect(contextMenu.defaultPrevented).toBe(true);
  });

  it("selects a clip at its timeline start while the playhead stays fixed in the centre", async () => {
    const onSelect = vi.fn();
    await render(<TimelineStrip timeline={timeline} sources={{}} selectedClipId={null} playheadSec={4.5} onSelect={onSelect} onScrub={() => {}} />);
    await click("Select clip b");
    expect(onSelect).toHaveBeenCalledWith("b", 3);
    expect(host.querySelector('[aria-label="Timeline playhead"]')?.getAttribute("style")).toContain("left: 49px");
  });

  it("deselects when the selected timeline clip is tapped again", async () => {
    const onDeselect = vi.fn();
    const onSelect = vi.fn();
    await render(<TimelineStrip timeline={timeline} sources={{}} selectedClipId="b" playheadSec={3} onSelect={onSelect} onScrub={() => {}} onDeselect={onDeselect} />);
    await click("Select clip b");
    expect(onDeselect).toHaveBeenCalledOnce();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("centres a tapped clip start under the playhead after its seek request", async () => {
    mockScrollTo.mockClear();
    function Harness() {
      const [playhead, setPlayhead] = React.useState(0);
      const [selected, setSelected] = React.useState<string | null>(null);
      return <TimelineStrip timeline={timeline} sources={{}} selectedClipId={selected} playheadSec={playhead} onSelect={(id, startSec) => { setSelected(id); setPlayhead(startSec); }} onScrub={setPlayhead} />;
    }
    await render(<Harness />);
    await click("Select clip b");
    expect(mockScrollTo).toHaveBeenLastCalledWith({ x: 120, animated: false });
  });

  it("uses one scale for ruler ticks, chapters, clip bounds and the music bar", async () => {
    const withRows: Timeline = {
      ...timeline,
      chapters: [{ title: "Zoo day", startSec: 0, durationSec: 3 }],
      audioClips: [{ id: "music-1", role: "music", source: { kind: "soundtrack", soundtrackId: "track-1", sourceInSec: 0, sourceOutSec: 9 }, startSec: 0, gainDb: 0, fadeInSec: 0, fadeOutSec: 0 }],
    };
    await render(<TimelineStrip timeline={withRows} sources={{ "shot-a": "a.jpg" }} selectedClipId="a" playheadSec={0} soundtrackName="Sandcastle Days" onSelect={() => {}} onScrub={() => {}} onSoundtrack={() => {}} />);
    expect(host.querySelector('[aria-label="Timeline ruler tick 2 seconds"]')?.getAttribute("style")).toContain("left: 130px");
    expect(host.querySelector('[aria-label="Timeline ruler label 0:02"]')).not.toBeNull();
    expect(host.querySelector('[aria-label="Chapter Zoo day"]')?.getAttribute("style")).toContain("left: 50px");
    expect(host.querySelector('[aria-label="Select clip a"]')?.parentElement?.getAttribute("style")).toContain("left: 50px");
    const musicTrack = host.querySelector('[aria-label="Music track Sandcastle Days"]')!;
    const photoClip = host.querySelector('[aria-label="Select clip a"]')!;
    expect(musicTrack.getAttribute("style")).toContain("width: 360px");
    expect(Boolean(musicTrack.compareDocumentPosition(photoClip) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
    expect(host.querySelector('[aria-label="Select music Sandcastle Days"]')).toBeNull();
  });

  it("selects an existing music track without opening the soundtrack picker", async () => {
    const onSelectAudio = vi.fn();
    const onSoundtrack = vi.fn();
    const withMusic: Timeline = {
      ...timeline,
      audioClips: [{ id: "music-1", role: "music", source: { kind: "soundtrack", soundtrackId: "track-1", sourceInSec: 0, sourceOutSec: 9 }, startSec: 0, gainDb: 0, fadeInSec: 0, fadeOutSec: 0 }],
    };
    await render(<TimelineStrip timeline={withMusic} sources={{}} selectedClipId={null} playheadSec={0} onSelect={() => {}} onScrub={() => {}} onSelectAudio={onSelectAudio} onSoundtrack={onSoundtrack} />);
    await click("Music track Soundtrack");
    expect(onSelectAudio).toHaveBeenCalledWith("music-1");
    expect(onSoundtrack).not.toHaveBeenCalled();
  });

  it("adds a clip from the plus button at the end of the timeline", async () => {
    const onAddClip = vi.fn();
    await render(<TimelineStrip timeline={timeline} sources={{}} selectedClipId={null} playheadSec={0} onSelect={() => {}} onScrub={() => {}} onAddClip={onAddClip} />);
    await click("Add clip");
    expect(onAddClip).toHaveBeenCalledOnce();
  });

  it("seeks by the time under the centre playhead when the user scrolls", async () => {
    const onScrub = vi.fn();
    await render(<TimelineStrip timeline={timeline} sources={{}} selectedClipId={null} playheadSec={0} onSelect={() => {}} onScrub={onScrub} />);
    const scroller = host.querySelector('[aria-label="Unified timeline"]')!;
    await act(async () => scroller.dispatchEvent(new Event("pointerdown", { bubbles: true })));
    Object.defineProperty(scroller, "scrollLeft", { configurable: true, value: 110 });
    await act(async () => scroller.dispatchEvent(new Event("scroll", { bubbles: true })));
    expect(onScrub).toHaveBeenLastCalledWith(xToTime(160, 40, 50));
  });

  it("moves under the fixed playhead on playback updates without seeking", async () => {
    const onScrub = vi.fn();
    const props = { timeline, sources: {}, selectedClipId: null, onSelect: () => {}, onScrub };
    await render(<TimelineStrip {...props} playheadSec={0} />);
    mockScrollTo.mockClear();
    await render(<TimelineStrip {...props} playheadSec={3} />);
    expect(mockScrollTo).toHaveBeenCalled();
    expect(onScrub).not.toHaveBeenCalled();
  });

  it("supports zoom controls at the allowed limits", async () => {
    await render(<TimelineStrip timeline={timeline} sources={{}} selectedClipId={null} playheadSec={0} onSelect={() => {}} onScrub={() => {}} />);
    await click("Zoom in timeline");
    expect(host.querySelector('[aria-label="Timeline zoom 44 pixels per second"]')).not.toBeNull();
    for (let i = 0; i < 20; i++) await click("Zoom out timeline");
    expect(host.querySelector('[aria-label="Timeline zoom 20 pixels per second"]')).not.toBeNull();
    for (let i = 0; i < 25; i++) await click("Zoom in timeline");
    expect(host.querySelector('[aria-label="Timeline zoom 120 pixels per second"]')).not.toBeNull();
  });

  it("shows selected collage chips, only layouts that fit the slots, and motions allowed by the selected layout", async () => {
    const threeSlotCollage = { ...collage, spec: { ...collage.spec, layoutId: "postcard-stack" as const, slots: collage.spec.slots.slice(0, 3) } };
    await render(<CollagePanel clip={threeSlotCollage} section="Layout" onApply={apply} onClose={() => {}} />);
    await click("Collage Styles");
    expect(host.querySelector('[aria-label="Layout Postcard stack"]')?.className).toContain("border-white");
    expect(host.querySelector('[aria-label="Motion Stack deal"]')).not.toBeNull();
    expect(host.querySelector('[aria-label="Effect Vignette"]')).toBeNull();
    for (const label of ["Botanical scrapbook", "Nine-photo grid", "Travel mosaic", "Travel story", "Torn paper mosaic", "Polaroid garland", "Postcard stack", "Route map"]) {
      expect(host.querySelector(`[aria-label="Layout ${label}"]`)).not.toBeNull();
    }
    expect((host.querySelector('[aria-label="Layout Photo table"]') as HTMLButtonElement).disabled).toBe(true);
    await click("Layout Torn paper mosaic");
    expect(apply).toHaveBeenLastCalledWith({ op: "setCollageSpec", clipId: "collage-1", spec: { ...threeSlotCollage.spec, layoutId: "torn-paper", motionId: "print-drop" } });
    expect(host.querySelector('[aria-label="Layout Torn paper mosaic"]')?.className).toContain("border-white");
  });

  it("keeps portrait-only styles out of landscape films and preserves slots when choosing Torn paper", async () => {
    await render(<CollagePanel clip={collage} aspect="16:9" section="Layout" onApply={apply} onClose={() => {}} />);
    await click("Collage Styles");
    expect(host.querySelector('[aria-label="Layout Polaroid garland"]')).toBeNull();
    expect(host.querySelector('[aria-label="Layout Postcard stack"]')).toBeNull();
    expect(host.querySelector('[aria-label="Layout Torn paper mosaic"]')).not.toBeNull();
    await click("Layout Torn paper mosaic");
    expect(apply).toHaveBeenLastCalledWith({ op: "setCollageSpec", clipId: collage.clipId, spec: { ...collage.spec, layoutId: "torn-paper", motionId: "print-drop" } });
  });

  it("shows the library for two photos and explains the required slot counts", async () => {
    const two = { ...collage, spec: { ...collage.spec, layoutId: "two-photo-diptych" as const, motionId: "print-drop" as const, slots: collage.spec.slots.slice(0, 2) } };
    await render(<CollagePanel clip={two} section="Layout" onApply={apply} onClose={() => {}} />);
    await click("Collage Styles");
    expect(host.querySelectorAll('[aria-label^="Layout "]')).toHaveLength(9);
    expect((host.querySelector('[aria-label="Layout Torn paper mosaic"]') as HTMLButtonElement).disabled).toBe(true);
    expect(host.textContent).toContain("Tap + above");
    await click("Increase number of photos");
    const op = apply.mock.lastCall![0];
    await render(<CollagePanel clip={{ ...two, spec: op.spec }} section="Layout" onApply={apply} onClose={() => {}} />);
    expect((host.querySelector('[aria-label="Layout Torn paper mosaic"]') as HTMLButtonElement).disabled).toBe(false);
  });

  it("shows only motion choices in the collage motion sheet", async () => {
    await render(<CollagePanel clip={collage} section="Motion" onApply={apply} onClose={() => {}} />);
    expect(host.querySelector('[aria-label="Layout Photo table"]')).toBeNull();
    expect(host.querySelector('[aria-label="Motion Stack deal"]')).not.toBeNull();
    await click("Motion Page turn");
    expect(apply).toHaveBeenLastCalledWith({ op: "setCollageMotion", clipId: "collage-1", motionId: "page-turn" });
  });

  it("shows a compact layout drawer and applies photo-count changes as one atomic editor update", async () => {
    apply.mockClear();
    const threeSlotCollage = { ...collage, spec: { ...collage.spec, slots: collage.spec.slots.slice(0, 3) } };
    await render(<CollagePanel clip={threeSlotCollage} section="Layout" onApply={apply} onClose={() => {}} />);
    expect(host.querySelector('[aria-label="Toggle layout drawer"]')).not.toBeNull();
    expect(host.querySelector('[aria-label="3 photos"]')?.textContent).toBe("3");
    await click("Increase number of photos");
    expect(apply).toHaveBeenLastCalledWith({ op: "setCollageSpec", clipId: "collage-1", spec: { ...threeSlotCollage.spec, slots: [...threeSlotCollage.spec.slots, { slotId: "empty:collage-1:4", kind: "photo", empty: true }] } });
    await click("Collage Styles");
    await click("Layout Postcard stack");
    expect(host.querySelector('[aria-label="Layout Postcard stack"]')?.getAttribute("aria-pressed")).toBe("true");
  });

  it("applies an Ask edit as one atomic timeline change and keeps Undo available", async () => {
    const snapshot = { key: "before" };
    const askRepository = {
      getEditConversation: vi.fn(async () => []), acknowledgeEditInterpretation: vi.fn(async () => {}),
      interpretEdit: vi.fn(async () => ({ kind: "edit" as const, baseRevision: 0, requestId: "r1", reply: "Move the second photo earlier.", ops: [{ op: "move" as const, clipId: "b", toIndex: 0 }] })),
    };
    await render(<AskSheet visible projectId="p1" generationId="g1" repository={askRepository} scope={{ kind: "film" }} savePending={async () => true} getSnapshotKey={() => snapshot.key} getSavedRevision={() => 0} applyMany={(ops) => { apply(ops); snapshot.key = "after"; return true; }} undo={() => {}} onPlayAt={() => {}} initialRequest="move this earlier" onClose={() => {}} />);
    expect((host.querySelector('[aria-label="Ask for an edit"]') as HTMLInputElement).value).toBe("move this earlier");
    await click("Suggest edit");
    expect(askRepository.interpretEdit).toHaveBeenCalledWith("p1", "g1", "move this earlier", 0, expect.objectContaining({ scope: { kind: "film" } }));
    expect(host.textContent).toContain("Applied 1 change.");
    expect(apply).toHaveBeenCalledOnce();
    expect(apply).toHaveBeenCalledWith([{ op: "move", clipId: "b", toIndex: 0 }]);
    expect(host.querySelector('[aria-label="Undo AI edit"]')).not.toBeNull();
  });

  it("seeks soundtrack preview from its touch-sized range and updates the time", async () => {
    await render(<SoundtrackSheet visible soundtracks={soundtracks.map(track => ({ ...track, durationSec: 20 }))} previewSourceForTrack={() => "real-track.mp3"} onApply={apply} onClose={() => {}} />);
    await click("Preview Soft piano");
    const range = host.querySelector('[aria-label="Seek soundtrack preview"]') as HTMLInputElement;
    expect(range.style.height).toBe("44px");
    const audio = host.querySelector("audio")!;
    Object.defineProperty(audio, "duration", { configurable: true, value: 20 });
    await act(async () => audio.dispatchEvent(new Event("loadedmetadata")));
    await act(async () => { range.value = "7"; range.dispatchEvent(new Event("input", { bubbles: true })); });
    expect(host.textContent).toContain("0:07 / 0:20");
  });

  it("previews a selected soundtrack and only applies it after confirmation", async () => {
    const close = vi.fn();
    await render(<SoundtrackSheet visible soundtracks={soundtracks} previewSourceForTrack={() => "real-track.mp3"} onApply={apply} onClose={close} />);
    await click("Preview Soft piano");
    expect(apply).not.toHaveBeenCalled();
    expect(host.querySelector("audio")?.getAttribute("src")).toBe("real-track.mp3");
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledOnce();
    await click("Confirm soundtrack");
    expect(apply).toHaveBeenCalledWith({ op: "setSoundtrack", soundtrackId: "soft-piano" });
    expect(close).toHaveBeenCalledOnce();
  });

  it("renders a large soundtrack catalog with mood filters", async () => {
    const many: Soundtrack[] = Array.from({ length: 38 }, (_, index) => ({
      id: `track-${index}`, name: `Track ${index}`, description: "Instrumental",
      mood: ["tender", "reflective", "playful", "energetic", "celebratory"][index % 5],
      suggested: index % 5 === 2,
    }));
    await render(<SoundtrackSheet visible soundtracks={many} onApply={() => {}} onClose={() => {}} />);
    expect(host.textContent).toContain("Track 2");
    expect(host.querySelectorAll('[aria-label^="Preview Track "]')).toHaveLength(8);
    expect(host.querySelector('[aria-label="Soundtrack mood Tender"]')).not.toBeNull();
  });

  it("does not mutate the timeline when soundtrack selection is cancelled", async () => {
    const close = vi.fn();
    await render(<SoundtrackSheet visible soundtracks={soundtracks} onApply={apply} onClose={close} />);
    await click("Preview Soft piano");
    await click("Close soundtrack");
    expect(apply).not.toHaveBeenCalled();
    expect(host.textContent).toContain("Preview unavailable");
  });

  it("confirms music volume using the slider", async () => {
    const close = vi.fn();
    await render(<AudioVolumeSheet visible audioClipId="music-1" gainDb={0} onApply={apply} onClose={close} />);
    const slider = host.querySelector('[aria-label="Music volume"]') as HTMLInputElement;
    slider.value = "0";
    await act(async () => slider.dispatchEvent(new Event("input", { bubbles: true })));
    await click("Apply audio volume");
    expect(apply).toHaveBeenCalledWith({ op: "setMusicVolume", audioClipId: "music-1", gainDb: -60 });
    expect(close).toHaveBeenCalledOnce();
  });

  it("shows a loading state while the soundtrack catalog is being fetched", async () => {
    await render(<SoundtrackSheet visible soundtracks={[]} loading onApply={apply} onClose={() => {}} />);
    expect(host.textContent).toContain("Loading soundtracks");
    expect(host.textContent).not.toContain("No soundtracks found");
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
