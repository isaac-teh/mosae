import type { PhotoCrop } from "@mosae/contracts";
import { COLLAGE_GRID_VARIANTS, collageGridRects } from "@mosae/contracts";

export type FramingFace = { bbox: [number, number, number, number]; confidence?: number; characterId?: string; prominence?: string; faceVisible?: boolean };

/** Parse a ratio setting such as 9:16, 1:1 or 4:5 into width / height. */
export function aspectRatio(aspect: string): number | undefined {
  const match = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(aspect);
  if (!match) return undefined;
  const width = Number(match[1]);
  const height = Number(match[2]);
  return width > 0 && height > 0 ? width / height : undefined;
}

/** Return the rendered cell aspect from normalized cell bounds and frame ratio. */
export function cellAspect(frameAspect: number, rect: { w: number; h: number }): number | undefined {
  return frameAspect > 0 && rect.w > 0 && rect.h > 0 ? frameAspect * rect.w / rect.h : undefined;
}

/** Match the grid cell geometry used by the shared collage layout helper. */
export function collageCellAspect(layoutId: string, slotCount: number, slotIndex: number, frameAspect: number): number | undefined {
  if (COLLAGE_GRID_VARIANTS.some(({ id }) => id === layoutId)) {
    const rect = collageGridRects(layoutId as typeof COLLAGE_GRID_VARIANTS[number]["id"], slotCount)[slotIndex];
    return rect ? cellAspect(frameAspect, rect) : undefined;
  }
  const wide = frameAspect > 1;
  if (layoutId === "travel-mosaic" && slotCount === 8) {
    const cells = [{ w: 24, h: 32 }, { w: 24, h: 32 }, { w: 49, h: 32 }, { w: 49.5, h: 32 }, { w: 18, h: 32 }, { w: 24, h: 33 }, { w: 24, h: 33 }, { w: 49, h: 33 }];
    return cells[slotIndex] ? cellAspect(frameAspect, cells[slotIndex]!) : undefined;
  }
  if (layoutId === "travel-story" && slotCount === 5) {
    const cells = wide
      ? [{ w: 49, h: 32 }, { w: 49.5, h: 65.5 }, { w: 24, h: 66.5 }, { w: 23.5, h: 32 }, { w: 74.5, h: 33 }]
      : [{ w: 65.5, h: 32 }, { w: 33, h: 65.5 }, { w: 32, h: 66.5 }, { w: 32, h: 32 }, { w: 66.5, h: 33 }];
    return cells[slotIndex] ? cellAspect(frameAspect, cells[slotIndex]!) : undefined;
  }
  if (layoutId === "botanical-scrapbook") {
    const cells = slotCount <= 4 ? [{ w: 39, h: 43 }, { w: 41, h: 39 }, { w: 38.5, h: 34 }, { w: 38, h: 40 }] : Array.from({ length: slotCount }, () => ({ w: 39, h: 25 }));
    return cells[slotIndex] ? cellAspect(frameAspect, cells[slotIndex]!) : undefined;
  }
  if (["photo-table", "torn-paper", "polaroid-garland", "postcard-stack", "route-map"].includes(layoutId)) {
    return frameAspect * (wide ? 1 / (0.77 * 0.73) : 1 / (0.77 * 0.56));
  }
  // Match SampleLayouts' row/column grid for the remaining layouts.
  const hasTitle = layoutId === "travel-mosaic";
  const total = slotCount + Number(hasTitle);
  const columns = total === 9 ? 3 : wide ? Math.min(4, Math.ceil(total / 2)) : Math.min(3, Math.ceil(Math.sqrt(total)));
  const rows = Math.ceil(total / columns);
  const titleOrder = hasTitle ? Math.floor(total / 2) : -1;
  const order = titleOrder >= 0 && slotIndex >= titleOrder ? slotIndex + 1 : slotIndex;
  const row = Math.floor(order / columns);
  const rowCount = Math.min(columns, total - row * columns);
  return slotIndex >= 0 && slotIndex < slotCount ? frameAspect * ((100 - 2 * (rowCount - 1)) / rowCount) / ((100 - 2 * (rows - 1)) / rows) : undefined;
}

/** Convert normalized face boxes to CSS object-position coordinates for cover-fit. */
export function focalCrop(faces: FramingFace[], sourceAspect: number | undefined, frameAspect: number | undefined, focusIds: Set<string> = new Set()): PhotoCrop | undefined {
  const usable = faces.filter((face) => face.faceVisible !== false && face.prominence !== "background" && face.bbox.every(Number.isFinite));
  if (!usable.length || sourceAspect === undefined || frameAspect === undefined || !(sourceAspect > 0) || !(frameAspect > 0)) return undefined;
  const focused = usable.filter((face) => face.characterId && focusIds.has(face.characterId));
  // Fit all faces when possible; if the union is too wide/tall, frame the
  // largest confirmed focus face, otherwise the largest visible face.
  const focus = focused.length ? focused : usable;
  const union = bounds(focus);
  const largest = focus.reduce((best, face) => area(face) > area(best) ? face : best);
  const visibleW = sourceAspect > frameAspect ? frameAspect / sourceAspect : 1;
  const visibleH = sourceAspect > frameAspect ? 1 : sourceAspect / frameAspect;
  const faceUnion = fits(union, visibleW, visibleH) ? union : bounds([largest]);
  const cx = (faceUnion.left + faceUnion.right) / 2;
  const cy = (faceUnion.top + faceUnion.bottom) / 2;
  // Visible normalized span under object-fit:cover.
  return { x: position(cx, visibleW, faceUnion.left, faceUnion.right), y: position(cy, visibleH, faceUnion.top, faceUnion.bottom), scale: 1 };
}

function bounds(faces: FramingFace[]) {
  return faces.reduce((b, face) => ({ top: Math.min(b.top, face.bbox[0]), left: Math.min(b.left, face.bbox[1]), bottom: Math.max(b.bottom, face.bbox[2]), right: Math.max(b.right, face.bbox[3]) }), { top: 1, left: 1, bottom: 0, right: 0 });
}
function area(face: FramingFace) { return (face.bbox[2] - face.bbox[0]) * (face.bbox[3] - face.bbox[1]); }
function fits(box: ReturnType<typeof bounds>, visibleW: number, visibleH: number) { return box.right - box.left <= visibleW && box.bottom - box.top <= visibleH; }
function position(center: number, span: number, min: number, max: number) {
  if (span >= 1) return 0.5;
  const p = Math.max(0, Math.min(1, (center - span / 2) / (1 - span)));
  const low = Math.max(0, (max - span) / (1 - span));
  const high = Math.min(1, min / (1 - span));
  return low <= high ? Math.max(low, Math.min(high, p)) : p;
}
