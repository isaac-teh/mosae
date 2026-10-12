import { describe, expect, it } from "vitest";
import { parseTimeline } from "@mosae/contracts";
import { collageCellAspect } from "./focalCrop.js";
import { fitCollageCrops } from "./fitCollageCrops.js";

const shot = (shotId: string) => [{ bbox: [0.2, 0.01, 0.7, 0.19] as [number, number, number, number], confidence: 1, faceVisible: true }];
const base = parseTimeline({ schemaVersion: 2, projectId: "p", mode: "memory", aspect: "16:9", fps: 30, durationSec: 2,
  chapters: [{ title: "Trip", startSec: 0 }], audioClips: [], captions: [], videoClips: [{ kind: "collage", clipId: "c", startSec: 0, durationSec: 2,
    spec: { layoutId: "grid-tall-left", motionId: "print-drop", effectId: null, seed: "s", durationSec: 2,
      slots: ["wide", "other-1", "other-2"].map((shotId) => ({ slotId: shotId, shotId, kind: "photo" as const, width: 1600, height: 900 })) } }] });

describe("fitCollageCrops", () => {
  it("keeps an edge face in the visible window of its new collage slot", () => {
    const result = fitCollageCrops(base, new Map([["wide", shot("wide")]]));
    const clip = result.videoClips[0]!;
    if (!("kind" in clip)) throw new Error("expected collage");
    const crop = clip.spec.slots[0]!.crop!;
    const slotAspect = collageCellAspect("grid-tall-left", 3, 0, 16 / 9)!;
    const visibleWidth = slotAspect / (16 / 9);
    const left = crop.x * (1 - visibleWidth);
    expect(left).toBeLessThanOrEqual(0.01);
    expect(left + visibleWidth).toBeGreaterThanOrEqual(0.19);
  });

  it("leaves a user-set crop unchanged while recalculating neighboring automatic crops", () => {
    const manual = { ...base, videoClips: base.videoClips.map((clip) => "kind" in clip
      ? { ...clip, spec: { ...clip.spec, slots: clip.spec.slots.map((slot, index) => index === 0 ? { ...slot, crop: { x: 0.8, y: 0.4, scale: 1.2 }, manualCrop: true as const } : slot) } }
      : clip) };
    const result = fitCollageCrops(manual, new Map([["wide", shot("wide")], ["other-1", shot("other-1")]]));
    const clip = result.videoClips[0]!;
    if (!("kind" in clip)) throw new Error("expected collage");
    expect(clip.spec.slots[0]!.crop).toEqual({ x: 0.8, y: 0.4, scale: 1.2 });
    expect(clip.spec.slots[1]!.crop).toBeDefined();
  });
});
