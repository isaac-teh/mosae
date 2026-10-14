import { describe, expect, it } from "vitest";
import { fitEditedCollageSlots, reassignCollageSlots, reorderSlots } from "./reorderSlots";
import { applyEdits, parseTimeline } from "@mosae/contracts";

describe("reorderSlots", () => {
  it("moves an item forward without mutating the source", () => {
    const values = ["a", "b", "c", "d"];
    expect(reorderSlots(values, 0, 2)).toEqual(["b", "c", "a", "d"]);
    expect(values).toEqual(["a", "b", "c", "d"]);
  });

  it("moves an item backward and clamps the target index", () => {
    expect(reorderSlots(["a", "b", "c"], 2, -3)).toEqual(["c", "a", "b"]);
    expect(reorderSlots(["a", "b", "c"], 0, 99)).toEqual(["b", "c", "a"]);
  });

  it("leaves the order alone for no-op or invalid source indexes", () => {
    expect(reorderSlots(["a", "b"], 1, 1)).toEqual(["a", "b"]);
    expect(reorderSlots(["a", "b"], 4, 0)).toEqual(["a", "b"]);
  });

  it("moves portrait and landscape photos to better fitting collage cells", () => {
    const slots = [
      { slotId: "landscape", width: 1600, height: 900 },
      { slotId: "portrait", width: 900, height: 1600 },
      { slotId: "landscape-2", width: 1600, height: 900 },
    ];
    const result = reassignCollageSlots(slots, "grid-tall-left", 16 / 9);
    expect(result.map((slot) => slot.slotId)).toEqual(["portrait", "landscape", "landscape-2"]);
  });

  it("adds a fitting spec edit after a photo replacement changes collage orientation", () => {
    const timeline = parseTimeline({ schemaVersion: 2, projectId: "p", mode: "memory", aspect: "16:9", fps: 30, durationSec: 2,
      chapters: [{ title: "Trip", startSec: 0 }], audioClips: [], captions: [], videoClips: [{ kind: "collage", clipId: "c", startSec: 0, durationSec: 2,
        spec: { layoutId: "grid-tall-left", motionId: "print-drop", effectId: null, seed: "s", durationSec: 2, slots: [
          { slotId: "landscape", shotId: "landscape", kind: "photo", width: 1600, height: 900 },
          { slotId: "landscape-2", shotId: "landscape-2", kind: "photo", width: 1600, height: 900 },
          { slotId: "portrait", shotId: "portrait", kind: "photo", width: 900, height: 1600 },
        ] } }] });
    const ops = fitEditedCollageSlots(timeline, [{ op: "replaceCollageSlot", clipId: "c", slotId: "landscape-2", shotId: "portrait-new", kind: "photo", width: 900, height: 1600 }]);
    const spec = ops.find((op) => op.op === "setCollageSpec");
    expect(spec && spec.op === "setCollageSpec" ? spec.spec.slots.map((slot) => slot.slotId) : []).toEqual(["landscape-2", "landscape", "portrait"]);
  });

  it("applies increased and decreased collage slot specs through the editor operation", () => {
    const timeline = parseTimeline({ schemaVersion: 2, projectId: "p", mode: "memory", aspect: "9:16", fps: 30, durationSec: 2,
      chapters: [{ title: "Trip", startSec: 0 }], audioClips: [], captions: [], videoClips: [{ kind: "collage", clipId: "c", startSec: 0, durationSec: 2,
        spec: { layoutId: "simple-three-stacked", motionId: "print-drop", effectId: null, seed: "s", durationSec: 2, slots: [
          { slotId: "a", shotId: "a", kind: "photo" }, { slotId: "b", shotId: "b", kind: "photo" }, { slotId: "c", shotId: "c", kind: "photo" },
        ] } }] });
    const collage = timeline.videoClips[0]!;
    if (!("kind" in collage)) throw new Error("expected collage fixture");
    const increased = applyEdits(timeline, [{ op: "setCollageSpec", clipId: "c", spec: { ...collage.spec, layoutId: "simple-grid-2x2", slots: [...collage.spec.slots, { slotId: "d", kind: "photo", empty: true }] } }]);
    expect(increased.ok).toBe(true);
    if (!increased.ok) return;
    const next = increased.timeline.videoClips[0]!;
    if (!("kind" in next)) throw new Error("expected collage fixture");
    expect(next.spec.slots).toHaveLength(4);
    const decreased = applyEdits(increased.timeline, [{ op: "setCollageSpec", clipId: "c", spec: { ...next.spec, layoutId: "simple-three-stacked", slots: next.spec.slots.slice(0, 3) } }]);
    expect(decreased.ok).toBe(true);
    if (decreased.ok) expect(decreased.timeline.videoClips[0]).toMatchObject({ spec: { layoutId: "simple-three-stacked", slots: [{ slotId: "a" }, { slotId: "b" }, { slotId: "c" }] } });
  });
});
