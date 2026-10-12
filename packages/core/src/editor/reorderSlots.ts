import { assignCollageSlots, collageSlotAspects } from "@mosae/contracts";

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
