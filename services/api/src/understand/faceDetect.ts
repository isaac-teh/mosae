import { z } from "zod";

/**
 * Validate + normalize raw Gemini face output into clean [0,1] boxes.
 *
 * Gemini returns detection boxes on a fixed 0–1000 grid regardless of the
 * image's real size, and regardless of the prompt asking for pixels. Dividing
 * by the image's pixel dimensions instead — which this did — is only harmless
 * when the image happens to be about 1000px on a side: a 1024x1024 photo lands
 * within 2.4% and looks correct, while a 1365x2048 one puts every face about
 * twice as high as it belongs, out of the frame entirely. So the divisor is the
 * grid, not the picture.
 *
 * Boxes are then validated for shape, confidence-gated, and IoU-deduped
 * (lightweight NMS). The stable `faceId` (`${shotId}-${index}`) is assigned by
 * the caller once the shot id is known.
 *
 * Detection quality is intentionally not this module's concern — Gemini Vision is
 * a noisy detector on real albums, so it acts as a filter the picker corrects, not
 * a guarantee (see docs/research/face-tagging-history.md).
 */

// IoU overlap threshold for NMS-style dedup of heavily-overlapping boxes.
export const IOU_THRESHOLD = 0.7;
// Confidence gate — drop faces below this score (conservative for an MVP where
// detection is known noisy).
export const CONFIDENCE_MIN = 0.3;

export const FaceSchema = z.object({
  bbox: z.array(z.number()).length(4), // [ymin, xmin, ymax, xmax] normalized 0–1 (or pixels; see normalizeFaces)
  confidence: z.number().finite().nonnegative().optional(),
});

function iou(a: number[], b: number[]): number {
  const [y0a, x0a, y1a, x1a] = a;
  const [y0b, x0b, y1b, x1b] = b;
  const ix0 = Math.max(x0a, x0b);
  const iy0 = Math.max(y0a, y0b);
  const ix1 = Math.min(x1a, x1b);
  const iy1 = Math.min(y1a, y1b);
  const iw = Math.max(0, ix1 - ix0);
  const ih = Math.max(0, iy1 - iy0);
  const inter = iw * ih;
  if (inter === 0) return 0;
  const aArea = (x1a - x0a) * (y1a - y0a);
  const bArea = (x1b - x0b) * (y1b - y0b);
  return inter / (aArea + bArea - inter);
}

function dedup(boxes: { bbox: number[]; confidence: number }[]): { bbox: number[]; confidence: number }[] {
  const kept: { bbox: number[]; confidence: number }[] = [];
  for (const box of boxes) {
    if (!kept.some((k) => iou(k.bbox, box.bbox) > IOU_THRESHOLD)) kept.push(box);
  }
  return kept;
}

/** The grid Gemini reports detection boxes on. */
export const DETECTION_GRID = 1000;

/** True when any coordinate is off the [0,1] scale ⇒ it is on the 0–1000 grid. */
function onDetectionGrid(raw: unknown[]): boolean {
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const bbox = (item as { bbox?: unknown }).bbox;
    if (!Array.isArray(bbox)) continue;
    for (const v of bbox) if (typeof v === "number" && v > 1.05) return true;
  }
  return false;
}

export function normalizeFaces(
  raw: unknown[],
): { bbox: [number, number, number, number]; confidence: number }[] {
  const parsed = z.array(FaceSchema).safeParse(raw);
  if (!parsed.success) return [];
  // Auto-detected rather than assumed, so a reply that is already normalised
  // passes through untouched.
  const scaled = onDetectionGrid(parsed.data);
  const boxes: { bbox: number[]; confidence: number }[] = [];
  for (const item of parsed.data) {
    let [ymin, xmin, ymax, xmax] = item.bbox as [number, number, number, number];
    if (scaled) {
      ymin /= DETECTION_GRID;
      xmin /= DETECTION_GRID;
      ymax /= DETECTION_GRID;
      xmax /= DETECTION_GRID;
    }
    const conf = Number(item.confidence ?? 1);
    if (!Number.isFinite(conf) || conf < CONFIDENCE_MIN) continue;
    // Reject degenerate boxes (zero area). Works in either coordinate space.
    if (ymax <= ymin || xmax <= xmin) continue;
    boxes.push({
      bbox: [Math.min(1, Math.max(0, ymin)), Math.min(1, Math.max(0, xmin)), Math.min(1, Math.max(0, ymax)), Math.min(1, Math.max(0, xmax))],
      confidence: Math.min(1, conf),
    });
  }
  return dedup(boxes).map(({ bbox, confidence }) => ({ bbox: [bbox[0], bbox[1], bbox[2], bbox[3]] as const, confidence }));
}
