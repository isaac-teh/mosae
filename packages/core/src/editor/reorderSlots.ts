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
