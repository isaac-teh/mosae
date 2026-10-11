import type { PhotoCrop } from "@mosae/contracts";

export type FramingFace = { bbox: [number, number, number, number]; confidence?: number; characterId?: string; prominence?: string; faceVisible?: boolean };

/** Convert normalized face boxes to CSS object-position coordinates for cover-fit. */
export function focalCrop(faces: FramingFace[], sourceAspect: number, frameAspect: number, focusIds: Set<string> = new Set()): PhotoCrop | undefined {
  const usable = faces.filter((face) => face.faceVisible !== false && face.prominence !== "background" && face.bbox.every(Number.isFinite));
  if (!usable.length || !(sourceAspect > 0) || !(frameAspect > 0)) return undefined;
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
