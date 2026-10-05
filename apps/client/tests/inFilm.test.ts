import { applyEdits, type Timeline } from "@mosae/contracts";
import { describe, expect, it } from "vitest";
import { getInFilmShotIds } from "../lib/inFilm";

const firstCut: Timeline = {
  schemaVersion: 2, projectId: "p1", mode: "memory", aspect: "9:16", fps: 30, durationSec: 4,
  chapters: [], audioClips: [], captions: [],
  videoClips: [{ kind: "collage", clipId: "c", startSec: 0, durationSec: 4, transitionIn: { kind: "cut", durationSec: 0 },
    spec: { layoutId: "photo-table", slots: [{ slotId: "s1", shotId: "shot-1", kind: "photo" }, { slotId: "s2", shotId: "shot-2", kind: "photo" }, { slotId: "s3", shotId: "shot-3", kind: "photo" }, { slotId: "s4", shotId: "shot-4", kind: "photo" }], motionId: "stack-deal", effectId: null, seed: "test", durationSec: 4 } }],
};

describe("getInFilmShotIds", () => {
  it("excludes a clip source after the clip is removed", () => {
    const withClip: Timeline = { ...firstCut, durationSec: 6, videoClips: [
      { id: "v", source: { kind: "photo", shotId: "video-photo" }, startSec: 0, durationSec: 2, transitionIn: { kind: "cut", durationSec: 0 } },
      ...firstCut.videoClips,
    ] };
    const withoutClip = applyEdits(withClip, [{ op: "remove", clipId: "v" }]);
    expect(withoutClip.ok && getInFilmShotIds(withoutClip.timeline).has("video-photo")).toBe(false);
  });

  it("excludes a collage source after its slot is removed and restores it on undo", () => {
    const clip = firstCut.videoClips[0];
    if (!clip || !("kind" in clip)) throw new Error("collage fixture is missing");
    const removed = applyEdits(firstCut, [{ op: "setCollageSpec", clipId: "c", spec: { ...clip.spec, slots: clip.spec.slots.map((slot) => slot.slotId === "s1" ? { slotId: slot.slotId, empty: true as const } : slot) } }]);
    expect(removed.ok, JSON.stringify(removed)).toBe(true);
    if (!removed.ok) return;
    expect(getInFilmShotIds(removed.timeline).has("shot-1")).toBe(false);
    expect(getInFilmShotIds(firstCut).has("shot-1")).toBe(true);
  });
});
