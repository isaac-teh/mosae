import { assignCollageSlots, applyEdits, collageSlotAspects, type EditOp, type Timeline } from "@mosae/contracts";

/** Returns a copy with the item at `fromIndex` moved to `toIndex`. */
export function reorderSlots<T>(items: readonly T[], fromIndex: number, toIndex: number): T[] {
  if (fromIndex < 0 || fromIndex >= items.length || !Number.isInteger(fromIndex) || !items.length) return [...items];
  const target = Math.max(0, Math.min(items.length - 1, Math.trunc(toIndex)));
  if (fromIndex === target) return [...items];
  const result = [...items];
  const [item] = result.splice(fromIndex, 1);
  result.splice(target, 0, item!);
  return result;
}

/** Reassigns collage sources to the target cells with the closest rendered aspect. */
export function reassignCollageSlots<T extends { slotId: string; shotId?: string; width?: number; height?: number }>(
  slots: readonly T[], layoutId: string, frameAspect: number,
): T[] {
  if (!slots.length || !(frameAspect > 0)) return [...slots];
  const sourceAspects = slots.map((slot) => slot.width && slot.height ? slot.width / slot.height : frameAspect);
  const targets = collageSlotAspects(layoutId, layoutId, slots.length, frameAspect);
  const assignment = assignCollageSlots(sourceAspects, targets);
  return slots.map((slot, sourceIndex) => ({ slot, sourceIndex }))
    .sort((a, b) => assignment[a.sourceIndex]! - assignment[b.sourceIndex]!)
    .map(({ slot }) => slot);
}

/** Appends a normalized spec edit when a direct slot add/replacement changes source-to-cell fit. */
export function fitEditedCollageSlots(timeline: Timeline, ops: EditOp[]): EditOp[] {
  const changed = applyEdits(timeline, ops);
  if (!changed.ok) return ops;
  const affected = new Set(ops.flatMap((op) => ["addCollageSlot", "replaceCollageSlot", "setCollageSpec"].includes(op.op) && "clipId" in op ? [op.clipId] : []));
  const fitted = [...ops];
  for (const clip of changed.timeline.videoClips) {
    if (!("kind" in clip) || !affected.has(clip.clipId)) continue;
    const frameAspect = timeline.aspect === "16:9" ? 16 / 9 : 9 / 16;
    const slots = reassignCollageSlots(clip.spec.slots, clip.spec.layoutId, frameAspect);
    if (!slots.some((slot, index) => slot.slotId !== clip.spec.slots[index]?.slotId)) continue;
    const refreshed = slots.map((slot) => {
      if (slot.manualCrop) return slot;
      const { crop: _automaticCrop, ...withoutAutomaticCrop } = slot;
      return withoutAutomaticCrop;
    });
    fitted.push({ op: "setCollageSpec", clipId: clip.clipId, spec: { ...clip.spec, slots: refreshed } });
  }
  return fitted;
}
