import { z } from "zod";

/**
 * Validate + normalize raw Gemini face output into clean [0,1] boxes.
 *
 * Gemini Vision is observed to return raw PIXEL coordinates despite instructions
 * to return normalized values; this module auto-detects that case when image
 * dimensions are supplied (any coordinate above 1.05 ⇒ pixel space) and rescales
 * each box to [0,1] before validating shape, confidence-gating, and IoU-deduping
 * (lightweight NMS). It is the pure, dependency-free half of that step; the stable
 * `faceId` (`${shotId}-${index}`) is assigned by the caller once the shot id is known.
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

/** True when any coordinate exceeds the normalized [0,1] range ⇒ pixel space. */
function looksLikePixels(raw: unknown[]): boolean {
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
  dims?: { width: number; height: number },
): { bbox: [number, number, number, number]; confidence: number }[] {
  const parsed = z.array(FaceSchema).safeParse(raw);
  if (!parsed.success) return [];
  // Gemini Vision returns pixel coordinates; rescale using image dimensions when
  // present. Auto-detect so this keeps working if it ever returns [0,1].
  const asPixels = dims && dims.width > 0 && dims.height > 0 && looksLikePixels(parsed.data);
  const boxes: { bbox: number[]; confidence: number }[] = [];
  for (const item of parsed.data) {
    let [ymin, xmin, ymax, xmax] = item.bbox as [number, number, number, number];
    if (asPixels) {
      ymin /= dims!.height;
      xmin /= dims!.width;
      ymax /= dims!.height;
      xmax /= dims!.width;
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
