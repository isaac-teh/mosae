// How much a face is what the photo is about. Size dominates; distance from the
// centre discounts it. Very small faces stay background even when they are the
// largest detection, and faces far below the photo's largest score are background.
export type BBox = [number, number, number, number]; // [ymin, xmin, ymax, xmax], 0–1
export type FaceRole = "subject" | "background";

export const SUBJECT_SCORE = 0.021;
export const LARGEST_MIN_SCORE = 0.021;

function rawScore([ymin, xmin, ymax, xmax]: BBox): number {
  const area = Math.max(0, ymax - ymin) * Math.max(0, xmax - xmin);
  const cy = (ymin + ymax) / 2, cx = (xmin + xmax) / 2;
  const off = Math.hypot(cx - 0.5, cy - 0.5) / Math.SQRT1_2;
  return Math.sqrt(area) * (1 - 0.5 * off);
}

export function faceProminence(box: BBox, allBoxesInPhoto: BBox[]): { score: number; role: FaceRole } {
  const score = rawScore(box);
  const largest = Math.max(...allBoxesInPhoto.map(rawScore), score);
  const isLargest = score >= largest;
  const isMuchSmaller = score < largest * 0.5;
  const role: FaceRole = !isMuchSmaller && (score >= SUBJECT_SCORE || (isLargest && score >= LARGEST_MIN_SCORE)) ? "subject" : "background";
  return { score, role };
}

export function photoRoles(boxes: BBox[]): FaceRole[] {
  return boxes.map((box) => faceProminence(box, boxes).role);
}
