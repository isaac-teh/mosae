import { describe, expect, it } from "vitest";
import { applyEdits, mergeOps, type EditOp } from "./edits.js";
import { parseTimeline, type Timeline } from "./timeline.js";

const cut = { kind: "cut" as const, durationSec: 0 };
const firstCut: Timeline = parseTimeline({
  schemaVersion: 2, projectId: "project-1", mode: "memory", aspect: "9:16", fps: 30,
  durationSec: 10,
  chapters: [{ title: "Opening", startSec: 0 }, { title: "Journey", startSec: 5 }],
  videoClips: [
    { id: "p1", source: { kind: "photo", shotId: "shot-p1" }, startSec: 0, durationSec: 2, transitionIn: cut },
    { id: "v1", source: { kind: "video", shotId: "shot-v1", sourceInSec: 4, sourceOutSec: 7 }, startSec: 2, durationSec: 3, transitionIn: cut },
    { id: "p2", source: { kind: "photo", shotId: "shot-p2" }, startSec: 5, durationSec: 2, transitionIn: cut },
    {
      kind: "collage", clipId: "c1", startSec: 7, durationSec: 3,
      spec: {
        layoutId: "torn-paper", motionId: "print-drop", effectId: null,
        seed: "first-cut", durationSec: 3,
        slots: [
          { slotId: "s1", shotId: "shot-c1", kind: "photo" },
          { slotId: "s2", shotId: "shot-c2", kind: "photo" },
          { slotId: "s3", shotId: "shot-c3", kind: "video" },
        ],
      },
    },
  ],
  audioClips: [{ id: "music", source: { kind: "soundtrack", soundtrackId: "soft-piano", sourceInSec: 0, sourceOutSec: 10 }, role: "music", startSec: 0, gainDb: -12, fadeInSec: 0.5, fadeOutSec: 0.5 }],
  captions: [{ text: "At the station", startSec: 2.5, endSec: 3.5 }],
});

const geometry = (timeline: Timeline) => timeline.videoClips.map((clip) => ["kind" in clip ? clip.clipId : clip.id, clip.startSec, clip.durationSec]);
const apply = (ops: EditOp[]) => {
  const result = applyEdits(firstCut, ops);
  if (!result.ok) throw new Error(`${result.opIndex}: ${result.error}`);
  return result;
};

describe("applyEdits", () => {
  it("returns the first cut unchanged when there are no edits", () => {
    const result = applyEdits(firstCut, []);
    expect(result).toEqual({ ok: true, timeline: firstCut, leftOutShotIds: [] });
  });

  it("applies the two second photo length and ripples the soundtrack with the shorter film", () => {
    const longPhoto: Timeline = {
      ...firstCut,
      durationSec: 10.5,
      videoClips: firstCut.videoClips.map((clip, index) => index === 0
        ? { ...clip, durationSec: 2.5 }
        : { ...clip, startSec: clip.startSec + 0.5 }),
      audioClips: firstCut.audioClips.map((clip) => ({
        ...clip,
        source: clip.source.kind === "soundtrack" ? { ...clip.source, sourceOutSec: 10.5 } : clip.source,
      })),
    };
    const result = applyEdits(longPhoto, [{ op: "setPhotoDuration", clipId: "p1", sec: 2 }]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.timeline.videoClips[0]).toMatchObject({ id: "p1", durationSec: 2, startSec: 0 });
      expect(result.timeline.videoClips[1].startSec).toBe(2);
      expect(result.timeline.durationSec).toBe(10);
      expect(result.timeline.audioClips[0].source).toMatchObject({ kind: "soundtrack", sourceOutSec: 10 });
    }
  });

  it("allows a half-second video trim and ripples every following clip", () => {
    const result = applyEdits(firstCut, [{ op: "trim", clipId: "v1", inSec: 6.5, outSec: 7 }]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(geometry(result.timeline)).toEqual([
      ["p1", 0, 2], ["v1", 2, 0.5], ["p2", 2.5, 2], ["c1", 4.5, 3],
    ]);
    expect(result.timeline.durationSec).toBe(7.5);
  });

  it("allows a half-second photo and ripples following clips", () => {
    const result = applyEdits(firstCut, [{ op: "setPhotoDuration", clipId: "p1", sec: 0.5 }]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(geometry(result.timeline)[1]).toEqual(["v1", 0.5, 3]);
    expect(result.timeline.durationSec).toBe(8.5);
  });

  it("trims a collage as one clip and keeps its spec duration in sync", () => {
    const result = applyEdits(firstCut, [{ op: "setCollageDuration", clipId: "c1", sec: 2 }]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const collage = result.timeline.videoClips.at(-1);
    expect(collage && "kind" in collage ? collage.spec.durationSec : null).toBe(2);
    expect(result.timeline.durationSec).toBe(9);
  });

  it.each<{
    name: string; op: EditOp; clips: Array<[string, number, number]>; duration: number;
  }>([
    { name: "swapShot", op: { op: "swapShot", clipId: "p1", shotId: "replacement" }, clips: [["p1", 0, 2], ["v1", 2, 3], ["p2", 5, 2], ["c1", 7, 3]], duration: 10 },
    { name: "trim", op: { op: "trim", clipId: "v1", inSec: 5, outSec: 7 }, clips: [["p1", 0, 2], ["v1", 2, 2], ["p2", 4, 2], ["c1", 6, 3]], duration: 9 },
    { name: "setPhotoDuration", op: { op: "setPhotoDuration", clipId: "p1", sec: 4 }, clips: [["p1", 0, 4], ["v1", 4, 3], ["p2", 7, 2], ["c1", 9, 3]], duration: 12 },
    { name: "move", op: { op: "move", clipId: "p2", toIndex: 0 }, clips: [["p2", 0, 2], ["p1", 2, 2], ["v1", 4, 3], ["c1", 7, 3]], duration: 10 },
    { name: "remove", op: { op: "remove", clipId: "v1" }, clips: [["p1", 0, 2], ["p2", 2, 2], ["c1", 4, 3]], duration: 7 },
    { name: "add", op: { op: "add", shotId: "new-shot", kind: "photo", afterClipId: "p1", durationSec: 3 }, clips: [["p1", 0, 2], ["add:new-shot:1", 2, 3], ["v1", 5, 3], ["p2", 8, 2], ["c1", 10, 3]], duration: 13 },
    { name: "setCollageLayout", op: { op: "setCollageLayout", clipId: "c1", layoutId: "travel-mosaic" }, clips: [["p1", 0, 2], ["v1", 2, 3], ["p2", 5, 2], ["c1", 7, 3]], duration: 10 },
    { name: "setCollageMotion", op: { op: "setCollageMotion", clipId: "c1", motionId: "tape-slap" }, clips: [["p1", 0, 2], ["v1", 2, 3], ["p2", 5, 2], ["c1", 7, 3]], duration: 10 },
    { name: "setCollageEffect", op: { op: "setCollageEffect", clipId: "c1", effectId: "vignette" }, clips: [["p1", 0, 2], ["v1", 2, 3], ["p2", 5, 2], ["c1", 7, 3]], duration: 10 },
    { name: "replaceCollageSlot", op: { op: "replaceCollageSlot", clipId: "c1", slotId: "s1", shotId: "other-photo", kind: "photo" }, clips: [["p1", 0, 2], ["v1", 2, 3], ["p2", 5, 2], ["c1", 7, 3]], duration: 10 },
    { name: "splitCollage", op: { op: "splitCollage", clipId: "c1" }, clips: [["p1", 0, 2], ["v1", 2, 3], ["p2", 5, 2], ["c1:s1", 7, 1], ["c1:s2", 8, 1], ["c1:s3", 9, 1]], duration: 10 },
    { name: "setSoundtrack", op: { op: "setSoundtrack", soundtrackId: "new-theme" }, clips: [["p1", 0, 2], ["v1", 2, 3], ["p2", 5, 2], ["c1", 7, 3]], duration: 10 },
  ])("applies $name and reflows every visual clip", ({ op, clips, duration }) => {
    const result = apply([op]);
    expect(geometry(result.timeline)).toEqual(clips);
    expect(result.timeline.durationSec).toBe(duration);
  });

  it("drops a chapter when its last clip is removed", () => {
    const result = applyEdits(parseTimeline({ ...firstCut, durationSec: 7, videoClips: firstCut.videoClips.slice(0, 3), audioClips: [] }), [{ op: "remove", clipId: "p2" }]);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.timeline.chapters).toEqual([{ title: "Opening", startSec: 0, durationSec: 5 }]);
  });

  it("moves captions with their clip and trims the soundtrack after removal", () => {
    const moved = apply([{ op: "move", clipId: "v1", toIndex: 3 }]);
    expect(moved.timeline.captions).toEqual([{ text: "At the station", startSec: 7.5, endSec: 8.5 }]);
    const removed = apply([{ op: "remove", clipId: "v1" }]);
    expect(removed.timeline.captions).toEqual([]);
    expect(removed.leftOutShotIds).toEqual(["shot-v1"]);
    expect(removed.timeline.audioClips[0].source.sourceOutSec).toBe(7);
    expect(removed.timeline.audioClips[0].fadeOutSec).toBe(0.5);
  });

  it("duplicates a selected clip immediately after it with a fresh id", () => {
    const duplicate = apply([{ op: "duplicate", clipId: "p1" }]);
    expect(geometry(duplicate.timeline)).toEqual([
      ["p1", 0, 2], ["duplicate:p1:1", 2, 2], ["v1", 4, 3], ["p2", 7, 2], ["c1", 9, 3],
    ]);
    expect(duplicate.timeline.videoClips[1]).toMatchObject({ source: { kind: "photo", shotId: "shot-p1" }, durationSec: 2 });
  });

  it("duplicates a collage slot as a collage", () => {
    const duplicate = apply([{ op: "duplicate", clipId: "c1" }]);
    expect(duplicate.timeline.videoClips.at(-1)).toMatchObject({ clipId: "duplicate:c1:1", kind: "collage", spec: { slots: firstCut.videoClips[3] && "kind" in firstCut.videoClips[3] ? firstCut.videoClips[3].spec.slots : [] } });
  });

  it("refuses a second collage video cell with an indexed error", () => {
    const result = applyEdits(firstCut, [{ op: "replaceCollageSlot", clipId: "c1", slotId: "s1", shotId: "second-video", kind: "video" }]);
    expect(result).toMatchObject({ ok: false, opIndex: 0 });
    if (!result.ok) expect(result.error).toContain("at most one video cell");
  });

  it("stores normalized collage cell crop and resets it when the layout changes", () => {
    const cropped = apply([{ op: "setCollageCrop", clipId: "c1", slotId: "s1", crop: { x: 0.7, y: 0.2, scale: 2 } }]);
    const croppedClip = cropped.timeline.videoClips[3]!;
    expect("kind" in croppedClip ? croppedClip.spec.slots[0]?.crop : null).toEqual({ x: 0.7, y: 0.2, scale: 2 });
    const reset = apply([{ op: "setCollageCrop", clipId: "c1", slotId: "s1", crop: { x: 0.7, y: 0.2, scale: 2 } }, { op: "setCollageLayout", clipId: "c1", layoutId: "travel-mosaic" }]);
    const resetClip = reset.timeline.videoClips[3]!;
    expect("kind" in resetClip ? resetClip.spec.slots[0]?.crop : null).toBeUndefined();
  });

  it("sets one complete collage spec atomically and retains clip duration", () => {
    const collageClip = firstCut.videoClips[3];
    if (!(collageClip && "kind" in collageClip)) throw new Error("fixture collage missing");
    const result = apply([{ op: "setCollageSpec", clipId: "c1", spec: { ...collageClip.spec, effectId: "film-grain", durationSec: 99 } }]);
    const updated = result.timeline.videoClips[3];
    expect(updated && "kind" in updated ? updated.spec : null).toMatchObject({ effectId: "film-grain", durationSec: 3 });
    expect(applyEdits(firstCut, [{ op: "setCollageSpec", clipId: "p1", spec: collageClip.spec }])).toMatchObject({ ok: false, opIndex: 0 });
    expect(applyEdits(firstCut, [{ op: "setCollageSpec", clipId: "c1", spec: { ...collageClip.spec, layoutId: "not-a-layout" } as never }])).toMatchObject({ ok: false, opIndex: 0 });
  });

  it("clears a slot atomically, then replaces it without retaining empty or stale slot metadata", () => {
    const collageClip = firstCut.videoClips[3];
    if (!(collageClip && "kind" in collageClip)) throw new Error("fixture collage missing");
    const clearedSpec = { ...collageClip.spec, slots: collageClip.spec.slots.map((slot, index) => index === 0 ? { slotId: slot.slotId, empty: true as const } : slot) };
    const result = applyEdits(firstCut, [
      { op: "setCollageSpec", clipId: "c1", spec: clearedSpec },
      { op: "replaceCollageSlot", clipId: "c1", slotId: "s1", shotId: "replacement-shot", kind: "photo" },
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const updated = result.timeline.videoClips[3];
    expect(updated && "kind" in updated ? updated.spec.slots : null).toHaveLength(3);
    expect(updated && "kind" in updated ? updated.spec.slots[0] : null).toEqual({ slotId: "s1", shotId: "replacement-shot", kind: "photo" });
    expect(updated && "kind" in updated ? updated.durationSec : null).toBe(3);
    expect(result.leftOutShotIds).toEqual(["shot-c1"]);
  });

  it("splits only populated slots and reports a clear error for an all-empty collage", () => {
    const collageClip = firstCut.videoClips[3];
    if (!(collageClip && "kind" in collageClip)) throw new Error("fixture collage missing");
    const mixedSpec = { ...collageClip.spec, slots: [
      { slotId: "s1", empty: true as const },
      { slotId: "s2", shotId: "photo-shot", kind: "photo" as const },
      { slotId: "s3", shotId: "video-shot", kind: "video" as const },
    ] };
    const split = apply([{ op: "setCollageSpec", clipId: "c1", spec: mixedSpec }, { op: "splitCollage", clipId: "c1" }]);
    expect(split.timeline.videoClips.slice(3)).toMatchObject([
      { id: "c1:s2", source: { kind: "photo", shotId: "photo-shot" }, durationSec: 1.5 },
      { id: "c1:s3", source: { kind: "photo", shotId: "video-shot" }, durationSec: 1.5 },
    ]);
    expect(split.leftOutShotIds).toEqual(["shot-c1", "shot-c2", "shot-c3"]);
    const emptySpec = { ...collageClip.spec, slots: collageClip.spec.slots.map((slot) => ({ slotId: slot.slotId, empty: true as const })) };
    const empty = applyEdits(firstCut, [{ op: "setCollageSpec", clipId: "c1", spec: emptySpec }, { op: "splitCollage", clipId: "c1" }]);
    expect(empty).toMatchObject({ ok: false, opIndex: 1, error: "Cannot split a collage with no populated slots" });
  });

  it("stores photo crop only on photo sources and supports collage rotation", () => {
    const crop = { x: 0.15, y: 0.25, scale: 1.7, rotationDeg: -27 };
    const photo = apply([{ op: "setPhotoCrop", clipId: "p1", crop }]).timeline.videoClips[0];
    expect(photo && "source" in photo ? photo.source : null).toMatchObject({ kind: "photo", crop });
    expect(photo && "crop" in photo ? photo.crop : undefined).toBeUndefined();
    const collage = apply([{ op: "setCollageCrop", clipId: "c1", slotId: "s1", crop }]).timeline.videoClips[3];
    expect(collage && "kind" in collage ? collage.spec.slots[0]?.crop : null).toEqual(crop);
    expect(applyEdits(firstCut, [{ op: "setPhotoCrop", clipId: "v1", crop }])).toMatchObject({ ok: false, opIndex: 0 });
  });

  it("adds and removes collage cells within the template limits", () => {
    const added = apply([{ op: "addCollageSlot", clipId: "c1", slotId: "s4", shotId: "shot-four", kind: "photo" }]);
    expect(added.timeline.videoClips[3]).toMatchObject({ spec: { layoutId: "torn-paper", slots: [{}, {}, {}, { slotId: "s4", shotId: "shot-four", kind: "photo" }] } });
    const removed = apply([{ op: "addCollageSlot", clipId: "c1", slotId: "s4", shotId: "shot-four", kind: "photo" }, { op: "removeCollageSlot", clipId: "c1", slotId: "s4" }]);
    expect(removed.timeline.videoClips[3]).toMatchObject({ spec: { slots: [{}, {}, {}] } });
    expect(applyEdits(firstCut, [{ op: "removeCollageSlot", clipId: "c1", slotId: "s1" }])).toMatchObject({ ok: false, opIndex: 0 });
    expect(applyEdits(firstCut, [{ op: "addCollageSlot", clipId: "c1", slotId: "s4", shotId: "shot-four", kind: "video" }])).toMatchObject({ ok: false, opIndex: 0 });
  });

  it("changes the requested shot, collage settings, slot, and soundtrack", () => {
    const swapped = apply([{ op: "swapShot", clipId: "p1", shotId: "replacement" }]).timeline.videoClips[0];
    expect("source" in swapped && swapped.source.shotId).toBe("replacement");
    const layout = apply([{ op: "setCollageLayout", clipId: "c1", layoutId: "travel-mosaic" }]).timeline.videoClips[3];
    expect("kind" in layout && layout.spec.layoutId).toBe("travel-mosaic");
    const motion = apply([{ op: "setCollageMotion", clipId: "c1", motionId: "tape-slap" }]).timeline.videoClips[3];
    expect("kind" in motion && motion.spec.motionId).toBe("tape-slap");
    const effect = apply([{ op: "setCollageEffect", clipId: "c1", effectId: "vignette" }]).timeline.videoClips[3];
    expect("kind" in effect && effect.spec.effectId).toBe("vignette");
    const replaced = apply([{ op: "replaceCollageSlot", clipId: "c1", slotId: "s1", shotId: "other-photo", kind: "photo" }]).timeline.videoClips[3];
    expect("kind" in replaced && replaced.spec.slots[0].shotId).toBe("other-photo");
    expect(apply([{ op: "setSoundtrack", soundtrackId: "new-theme" }]).timeline.audioClips[0].source).toMatchObject({ soundtrackId: "new-theme" });
  });

  it("changes only music gain and preserves it through subsequent timeline edits", () => {
    const withOtherAudio = { ...firstCut, audioClips: [...firstCut.audioClips, { id: "fx", source: { kind: "asset" as const, assetId: "shot-p1", sourceInSec: 0, sourceOutSec: 2 }, role: "ambient" as const, startSec: 0, gainDb: -3, fadeInSec: 0, fadeOutSec: 0 }] };
    const changed = applyEdits(withOtherAudio, [{ op: "setMusicVolume", audioClipId: "music", gainDb: 0 }, { op: "setPhotoDuration", clipId: "p1", sec: 3 }]);
    expect(changed.ok).toBe(true);
    if (changed.ok) {
      expect(changed.timeline.audioClips.find((clip) => clip.role === "music")?.gainDb).toBe(0);
      expect(changed.timeline.audioClips.find((clip) => clip.id === "fx")?.gainDb).toBe(-3);
    }
    expect(applyEdits(firstCut, [{ op: "setMusicVolume", audioClipId: "music", gainDb: 13 }])).toMatchObject({ ok: false, opIndex: 0 });
  });

  it("rejects volume for an uncreated editor soundtrack and applies it after setSoundtrack", () => {
    const noMusic = parseTimeline({ ...firstCut, audioClips: [] });
    expect(applyEdits(noMusic, [{ op: "setMusicVolume", audioClipId: "editor-soundtrack", gainDb: 0 }])).toMatchObject({ ok: false, opIndex: 0 });
    const created = applyEdits(noMusic, [
      { op: "setSoundtrack", soundtrackId: "new-theme" },
      { op: "setMusicVolume", audioClipId: "editor-soundtrack", gainDb: 0 },
    ]);
    expect(created.ok).toBe(true);
    if (created.ok) expect(created.timeline.audioClips).toMatchObject([{ id: "editor-soundtrack", role: "music", gainDb: 0, source: { kind: "soundtrack", soundtrackId: "new-theme" } }]);
  });

  it("applies a collage layout and its compatible motion as one validated change", () => {
    const result = applyEdits(firstCut, [
      { op: "setCollageLayout", clipId: "c1", layoutId: "polaroid-garland" },
      { op: "setCollageMotion", clipId: "c1", motionId: "page-turn" },
    ]);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.timeline.videoClips[3]).toMatchObject({ spec: { layoutId: "polaroid-garland", motionId: "page-turn" } });
  });

  it("adds source-backed clips, splits collage slots into photos, and tracks removed shots", () => {
    const added = apply([{ op: "add", shotId: "new-shot", kind: "video", afterClipId: "p1", durationSec: 2, sourceInSec: 1, sourceOutSec: 3 }]).timeline.videoClips[1];
    expect("source" in added && added.source).toEqual({ kind: "video", shotId: "new-shot", sourceInSec: 1, sourceOutSec: 3, sourceStartSec: 1, sourceEndSec: 3 });
    const split = apply([{ op: "splitCollage", clipId: "c1" }]).timeline.videoClips.slice(3);
    expect(split.map((clip) => "source" in clip ? clip.source : null)).toEqual([
      { kind: "photo", shotId: "shot-c1" }, { kind: "photo", shotId: "shot-c2" }, { kind: "photo", shotId: "shot-c3" },
    ]);
    const removed = apply([{ op: "remove", clipId: "c1" }]);
    expect(removed.leftOutShotIds).toEqual(["shot-c1", "shot-c2", "shot-c3"]);
  });

  it("moves a clip into the adjacent chapter and recomputes chapter durations", () => {
    const result = apply([{ op: "move", clipId: "v1", toIndex: 3 }]);
    expect(result.timeline.chapters).toEqual([
      { title: "Opening", startSec: 0, durationSec: 2 },
      { title: "Journey", startSec: 2, durationSec: 8 },
    ]);
  });

  it("keeps chapter membership when moving a clip to its current index", () => {
    const result = apply([{ op: "move", clipId: "p2", toIndex: 2 }]);
    expect(result.timeline.chapters).toEqual([
      { title: "Opening", startSec: 0, durationSec: 5 },
      { title: "Journey", startSec: 5, durationSec: 5 },
    ]);
  });

  it("keeps added clip IDs distinct when a shot is removed and added again", () => {
    const result = apply([
      { op: "add", shotId: "repeat-shot", kind: "photo", afterClipId: "p1", durationSec: 2 },
      { op: "add", shotId: "repeat-shot", kind: "photo", afterClipId: "p1", durationSec: 2 },
      { op: "remove", clipId: "add:repeat-shot:1" },
      { op: "add", shotId: "repeat-shot", kind: "photo", afterClipId: "p1", durationSec: 2 },
    ]);
    expect(result.timeline.videoClips.map((clip) => "kind" in clip ? clip.clipId : clip.id)).toEqual([
      "p1", "add:repeat-shot:3", "add:repeat-shot:2", "v1", "p2", "c1",
    ]);
  });

  it("keeps a caption on one clip when its original time overlaps a crossfade", () => {
    const overlapping = parseTimeline({
      ...firstCut,
      durationSec: 9.5,
      chapters: [{ title: "Opening", startSec: 0 }, { title: "Journey", startSec: 4.5 }],
      videoClips: firstCut.videoClips.map((clip, index) => ({ ...clip, startSec: [0, 1.5, 4.5, 6.5][index] })),
      audioClips: [],
      captions: [{ text: "Over the transition", startSec: 1.6, endSec: 1.9 }],
    });
    const result = applyEdits(overlapping, [{ op: "move", clipId: "v1", toIndex: 3 }]);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.timeline.captions).toEqual([{ text: "Over the transition", startSec: 7.1, endSec: 7.4 }]);
  });

  it("allows a later trim gesture to expand within the original video range", () => {
    const result = applyEdits(firstCut, [
      { op: "trim", clipId: "v1", inSec: 4, outSec: 6 },
      { op: "trim", clipId: "v1", inSec: 4, outSec: 7 },
    ]);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.timeline.durationSec).toBe(10);
  });

  it("allows video trims to expand to the source duration metadata", () => {
    const source = parseTimeline({ ...firstCut, videoClips: firstCut.videoClips.map((clip) => "id" in clip && clip.id === "v1" ? { ...clip, source: { ...clip.source, sourceDurationSec: 12 } } : clip) });
    const result = applyEdits(source, [{ op: "trim", clipId: "v1", inSec: 0, outSec: 10 }]);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.timeline.videoClips.find((clip) => "id" in clip && clip.id === "v1")).toMatchObject({ durationSec: 10, source: { sourceInSec: 0, sourceOutSec: 10, sourceDurationSec: 12 } });
  });

  it("clears stale candidate bounds when a later replacement has no trusted source bounds", () => {
    const videoTimeline: Timeline = { ...firstCut, videoClips: firstCut.videoClips.map((clip) => "id" in clip && clip.id === "v1" ? { ...clip, source: { ...clip.source, sourceDurationSec: 8, sourceStartSec: 2 } } : clip) };
    const result = applyEdits(videoTimeline, [{ op: "swapShot", clipId: "v1", shotId: "second" }]);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.timeline.videoClips.find((clip) => "id" in clip && clip.id === "v1")).toMatchObject({ source: { shotId: "second", sourceInSec: 4, sourceOutSec: 7 } });
    const swapped = result.ok && result.timeline.videoClips.find((clip) => "id" in clip && clip.id === "v1");
    if (swapped && "source" in swapped) {
      expect(swapped.source).not.toHaveProperty("sourceStartSec");
      expect(swapped.source).not.toHaveProperty("sourceDurationSec");
    }
  });

  it("preserves the incoming crossfade overlap after moving a clip", () => {
    const crossfading = parseTimeline({
      ...firstCut,
      durationSec: 9.5,
      chapters: [{ title: "Opening", startSec: 0 }, { title: "Journey", startSec: 4.5 }],
      videoClips: firstCut.videoClips.map((clip, index) => index === 1
        ? { ...clip, startSec: 1.5, transitionIn: { kind: "crossfade", durationSec: 0.5 } }
        : { ...clip, startSec: [0, 1.5, 4.5, 6.5][index] }),
      audioClips: [],
      captions: [],
    });
    const result = applyEdits(crossfading, [{ op: "move", clipId: "p2", toIndex: 0 }]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(geometry(result.timeline)).toEqual([
      ["p2", 0, 2], ["p1", 2, 2], ["v1", 3.5, 3], ["c1", 6.5, 3],
    ]);
    expect(result.timeline.durationSec).toBe(9.5);
  });

  it("rejects unknown clips and invalid trims without throwing", () => {
    expect(applyEdits(firstCut, [{ op: "remove", clipId: "missing" }])).toMatchObject({ ok: false, opIndex: 0 });
    expect(applyEdits(firstCut, [{ op: "trim", clipId: "p1", inSec: 0, outSec: 2 }])).toMatchObject({ ok: false, opIndex: 0 });
    expect(applyEdits(firstCut, [{ op: "trim", clipId: "v1", inSec: 5, outSec: 5.49 }])).toMatchObject({ ok: false, opIndex: 0 });
    expect(applyEdits(firstCut, [{ op: "setPhotoDuration", clipId: "p1", sec: 0.49 }])).toMatchObject({ ok: false, opIndex: 0 });
    expect(applyEdits(firstCut, [{ op: "setCollageDuration", clipId: "c1", sec: 0.49 }])).toMatchObject({ ok: false, opIndex: 0 });
  });

  it("merges only consecutive gestures on the same clip and operation", () => {
    expect(mergeOps([
      { op: "trim", clipId: "v1", inSec: 4, outSec: 6 },
      { op: "trim", clipId: "v1", inSec: 5, outSec: 7 },
      { op: "move", clipId: "p1", toIndex: 1 },
      { op: "move", clipId: "p1", toIndex: 2 },
      { op: "setPhotoDuration", clipId: "p1", sec: 3 },
      { op: "setPhotoDuration", clipId: "p1", sec: 4 },
      { op: "setMusicVolume", audioClipId: "music", gainDb: 2 },
      { op: "setMusicVolume", audioClipId: "music", gainDb: 6 },
    ])).toEqual([
      { op: "trim", clipId: "v1", inSec: 5, outSec: 7 },
      { op: "move", clipId: "p1", toIndex: 2 },
      { op: "setPhotoDuration", clipId: "p1", sec: 4 },
      { op: "setMusicVolume", audioClipId: "music", gainDb: 6 },
    ]);
  });
});
