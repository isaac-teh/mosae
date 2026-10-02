import { COLLAGE_GRID_VARIANTS } from "./collage.js";

export type CollageGridVariant = typeof COLLAGE_GRID_VARIANTS[number]["id"];
export type CollageGridRect = { x: number; y: number; w: number; h: number };
const r = (x: number, y: number, w: number, h: number): CollageGridRect => ({ x, y, w, h });

const threePhoto: Record<CollageGridVariant, CollageGridRect[]> = {
  "grid-wide-top": [r(0, 0, 100, 49), r(0, 51, 49, 49), r(51, 51, 49, 49)],
  "grid-wide-bottom": [r(0, 0, 49, 49), r(51, 0, 49, 49), r(0, 51, 100, 49)],
  "grid-stacked-rows": [r(0, 0, 100, 32), r(0, 34, 100, 32), r(0, 68, 100, 32)],
  "grid-tall-left": [r(0, 0, 49, 100), r(51, 0, 49, 49), r(51, 51, 49, 49)],
  "grid-tall-right": [r(0, 0, 49, 49), r(0, 51, 49, 49), r(51, 0, 49, 100)],
  "grid-three-columns": [r(0, 0, 32, 100), r(34, 0, 32, 100), r(68, 0, 32, 100)],
};

const twoPhoto: Record<CollageGridVariant, CollageGridRect[]> = {
  "grid-wide-top": [r(0, 0, 100, 60), r(0, 62, 100, 38)],
  "grid-wide-bottom": [r(0, 0, 100, 38), r(0, 40, 100, 60)],
  "grid-stacked-rows": [r(0, 0, 100, 49), r(0, 51, 100, 49)],
  "grid-tall-left": [r(0, 0, 60, 100), r(62, 0, 38, 100)],
  "grid-tall-right": [r(0, 0, 38, 100), r(40, 0, 60, 100)],
  "grid-three-columns": [r(0, 0, 49, 100), r(51, 0, 49, 100)],
};

const fourPhoto: Record<CollageGridVariant, CollageGridRect[]> = {
  "grid-wide-top": [r(0, 0, 100, 49), r(0, 51, 32, 49), r(34, 51, 32, 49), r(68, 51, 32, 49)],
  "grid-wide-bottom": [r(0, 0, 32, 49), r(34, 0, 32, 49), r(68, 0, 32, 49), r(0, 51, 100, 49)],
  "grid-stacked-rows": [r(0, 0, 100, 23.5), r(0, 25.5, 100, 23.5), r(0, 51, 100, 23.5), r(0, 76.5, 100, 23.5)],
  "grid-tall-left": [r(0, 0, 49, 100), r(51, 0, 49, 32), r(51, 34, 49, 32), r(51, 68, 49, 32)],
  "grid-tall-right": [r(0, 0, 49, 32), r(0, 34, 49, 32), r(0, 68, 49, 32), r(51, 0, 49, 100)],
  "grid-three-columns": [r(0, 0, 49, 49), r(51, 0, 49, 49), r(0, 51, 49, 49), r(51, 51, 49, 49)],
};

function splitLargest(rects: CollageGridRect[], variant: CollageGridVariant): CollageGridRect[] {
  const index = rects.reduce((best, item, i) => item.w * item.h > rects[best]!.w * rects[best]!.h ? i : best, 0);
  const target = rects[index]!;
  const gap = 2;
  const horizontal = variant === "grid-wide-top" || variant === "grid-wide-bottom" || variant === "grid-stacked-rows"
    ? target.w >= target.h
    : variant === "grid-tall-left" || variant === "grid-tall-right" ? target.h >= target.w : target.w >= target.h;
  const first = { ...target };
  const second = { ...target };
  if (horizontal) {
    first.w = (target.w - gap) / 2;
    second.x += first.w + gap;
    second.w = first.w;
  } else {
    first.h = (target.h - gap) / 2;
    second.y += first.h + gap;
    second.h = first.h;
  }
  return rects.flatMap((item, i) => i === index ? [first, second] : [item]);
}

/** Normalized, non-overlapping photo rectangles shared by the drawer and renderer. */
export function collageGridRects(variant: CollageGridVariant, count: number): CollageGridRect[] {
  if (!Number.isInteger(count) || count < 1 || count > 9) throw new RangeError("grid photo count must be 1–9");
  if (count === 1) return [r(0, 0, 100, 100)];
  if (count === 2) return twoPhoto[variant].map((item) => ({ ...item }));
  if (count === 3) return threePhoto[variant].map((item) => ({ ...item }));
  const rects = fourPhoto[variant].map((item) => ({ ...item }));
  while (rects.length < count) splitLargest(rects, variant).forEach((item, i) => { rects[i] = item; });
  return rects;
}
