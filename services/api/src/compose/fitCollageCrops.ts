import type { Timeline } from "@mosae/contracts";
import { collageCellAspect, focalCrop, type FramingFace } from "./focalCrop.js";

/** Reframe automatic collage crops against rendered slot geometry after edits. */
export function fitCollageCrops(timeline: Timeline, facesByShot: ReadonlyMap<string, FramingFace[]>, focusIds = new Set<string>()): Timeline {
  const frameAspect = timeline.aspect === "16:9" ? 16 / 9 : 9 / 16;
  if (!(frameAspect > 0)) return timeline;
  return {
    ...timeline,
    videoClips: timeline.videoClips.map((clip) => {
      if (!("kind" in clip)) return clip;
      const slots = clip.spec.slots.map((slot, index) => {
        if (!slot.shotId || slot.manualCrop) return slot;
        const sourceAspect = slot.width && slot.height ? slot.width / slot.height : undefined;
        const targetAspect = collageCellAspect(clip.spec.layoutId, clip.spec.slots.length, index, frameAspect);
        const crop = focalCrop(facesByShot.get(slot.shotId) ?? [], sourceAspect, targetAspect, focusIds);
        return crop ? { ...slot, crop } : { ...slot, crop: undefined };
      });
      return { ...clip, spec: { ...clip.spec, slots } };
    }),
  };
}
