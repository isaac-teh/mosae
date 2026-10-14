import { describe, expect, it } from "vitest";
import { applyEdits, mergeOps, type EditOp } from "./edits.js";
import { parseTimeline } from "./timeline.js";
import composedCollageFixture from "./fixtures/composed-collage-count.json" with { type: "json" };
import { ALLOWED_COMBOS } from "./collageCombos.js";

const timeline = parseTimeline({
  schemaVersion: 2, projectId: "collage-count", mode: "memory", aspect: "9:16", fps: 30,
  durationSec: 4, chapters: [{ title: "Trip", startSec: 0 }], videoClips: [{
    kind: "collage", clipId: "c1", startSec: 0, durationSec: 4,
    spec: { layoutId: "travel-story", motionId: "focus-relay", effectId: null, seed: "stable", durationSec: 4, slots: [
      { slotId: "a", shotId: "photo-a", kind: "photo" },
      { slotId: "b", shotId: "photo-b", kind: "photo" },
      { slotId: "c", shotId: "photo-c", kind: "photo" },
    ] },
  }], audioClips: [], captions: [],
});

describe("atomic collage count edits", () => {
  it("lets a composed collage recover from superseded legacy spec edits and change to any supported count", () => {
    // Sanitized one-clip snapshot from a real composed first cut read from Firestore.
    const composed = parseTimeline(composedCollageFixture);
    const clip = composed.videoClips[0]!;
    if (!("kind" in clip)) throw new Error("expected composed collage fixture");

    // This is the stale design-magazine edit shape still present in older saved editor histories.
    const staleLegacyEdit = {
      op: "setCollageSpec",
      clipId: clip.clipId,
      spec: { ...clip.spec, layoutId: "design-magazine" },
    } as unknown as EditOp;

    for (let count = 1; count <= 6; count++) {
      const layoutId = (["simple-full", "simple-stacked", "simple-three-stacked", "simple-grid-2x2", "simple-five-top", "simple-grid-2x3"] as const)[count - 1]!;
      const motionId = ALLOWED_COMBOS.find((combo) => combo.layoutId === layoutId)!.motionId;
      const slots = clip.spec.slots.slice(0, count);
      for (let index = slots.length; index < count; index++) {
        slots.push({ slotId: `empty:${clip.clipId}:${index + 1}`, kind: "photo", empty: true });
      }
      const edit = { op: "setCollageSpec", clipId: clip.clipId, spec: { ...clip.spec, layoutId, motionId, slots } } as EditOp;
      const result = applyEdits(composed, mergeOps([staleLegacyEdit, edit]));
      expect(result.ok, `count ${count}${result.ok ? "" : `: ${result.error}`}`).toBe(true);
      if (result.ok) expect((result.timeline.videoClips[0] as typeof clip).spec.slots).toHaveLength(count);
    }
  });

  it("changes 2→3→4 slots atomically while preserving duration and surviving slot IDs", () => {
    const collage = timeline.videoClips[0]!;
    if (!("kind" in collage)) throw new Error("expected collage fixture");
    const two = { ...collage.spec, layoutId: "two-photo-diptych" as const, motionId: "print-drop" as const, slots: collage.spec.slots.slice(0, 2) };
    const three = { ...two, layoutId: "grid-wide-top" as const, slots: [...two.slots, { slotId: "empty:c1:3", kind: "photo" as const, empty: true as const }] };
    const four = { ...three, slots: [...three.slots, { slotId: "empty:c1:4", kind: "photo" as const, empty: true as const }] };
    const step2 = applyEdits(timeline, [{ op: "setCollageSpec", clipId: "c1", spec: two }]);
    expect(step2.ok).toBe(true);
    if (!step2.ok) return;
    expect(step2.timeline.videoClips[0]).toMatchObject({ durationSec: 4, spec: { durationSec: 4, slots: [{ slotId: "a" }, { slotId: "b" }] } });
    const step3 = applyEdits(step2.timeline, [{ op: "setCollageSpec", clipId: "c1", spec: three }]);
    expect(step3.ok).toBe(true);
    if (!step3.ok) return;
    expect(step3.timeline.durationSec).toBe(4);
    expect(step3.timeline.videoClips[0]).toMatchObject({ durationSec: 4, spec: { durationSec: 4, layoutId: "grid-wide-top", slots: [{ slotId: "a" }, { slotId: "b" }, { slotId: "empty:c1:3", empty: true }] } });
    const step4 = applyEdits(step3.timeline, [{ op: "setCollageSpec", clipId: "c1", spec: four }]);
    expect(step4.ok).toBe(true);
    if (!step4.ok) return;
    expect(step4.timeline.durationSec).toBe(4);
    expect(step4.timeline.videoClips[0]).toMatchObject({ durationSec: 4, spec: { durationSec: 4, layoutId: "grid-wide-top", slots: [{ slotId: "a" }, { slotId: "b" }, { slotId: "empty:c1:3", empty: true }, { slotId: "empty:c1:4", empty: true }] } });
  });
  it("keeps duration and surviving photos when the slot count decreases", () => {
    const collage = timeline.videoClips[0]!;
    if (!("kind" in collage)) throw new Error("expected collage fixture");
    const nextSpec = collage.spec;
    const result = applyEdits(timeline, [{ op: "setCollageSpec", clipId: "c1", spec: { ...nextSpec, layoutId: "two-photo-diptych", motionId: "print-drop", slots: nextSpec.slots.slice(0, 2) } }]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.timeline.durationSec).toBe(4);
    expect(result.timeline.videoClips[0]).toMatchObject({ durationSec: 4, spec: { durationSec: 4, layoutId: "two-photo-diptych", slots: [{ slotId: "a", shotId: "photo-a" }, { slotId: "b", shotId: "photo-b" }] } });
  });

  it("supports empty cells while preserving duration and the grid", () => {
    const collage = timeline.videoClips[0]!;
    if (!("kind" in collage)) throw new Error("expected collage fixture");
    const result = applyEdits(timeline, [{ op: "setCollageSpec", clipId: "c1", spec: { ...collage.spec, slots: collage.spec.slots.map((slot) => slot.slotId === "c" ? { slotId: slot.slotId, kind: "photo", empty: true as const } : slot) } }]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.timeline.durationSec).toBe(4);
    expect(result.timeline.videoClips[0]).toMatchObject({ durationSec: 4, spec: { slots: [{ slotId: "a" }, { slotId: "b" }, { slotId: "c", empty: true }] } });
  });
});
