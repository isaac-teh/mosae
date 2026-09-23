/** Repeat the Figma hero / half + half / hero rhythm over any list length. */
export function momentRows<T>(moments: T[]): { size: "hero" | "half"; moments: T[] }[] {
  const rows: { size: "hero" | "half"; moments: T[] }[] = [];
  for (let index = 0; index < moments.length;) {
    const size = index % 4 === 1 ? "half" : "hero";
    const count = size === "half" ? 2 : 1;
    rows.push({ size, moments: moments.slice(index, index + count) });
    index += count;
  }
  return rows;
}
