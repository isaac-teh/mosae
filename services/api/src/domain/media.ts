export type MediaKind = "photo" | "video";

export type GeoPoint = { lat: number; lng: number };

/**
 * What ingest reads from the file itself. `localTime` is wall-clock time where
 * the media was captured, as "YYYY-MM-DDTHH:mm:ss" with no zone, because day and
 * event grouping cares about the local calendar, not the UTC instant.
 */
export type MediaFacts = {
  kind: MediaKind;
  /** Oriented dimensions: EXIF orientation and video rotation already applied. */
  width: number;
  height: number;
  /** Null for photos. */
  durationSec: number | null;
  localTime: string | null;
  timeSource: "exif" | "video-utc" | "video-gps" | "none";
  gps: GeoPoint | null;
  camera: string | null;
};

export type QualityFacts = {
  /** 75th-percentile tile Laplacian variance of the 512px grayscale image. */
  sharpness: number;
  /** Mean luminance, 0 (black) to 255 (white). */
  exposure: number;
  blurry: boolean;
  /** 64-bit difference hash as 16 hex characters. */
  dHash: string;
};

/** Storage paths of what ingest produced. For a video, thumbPath is a poster frame. */
export type Derivatives = {
  thumbPath: string;
  renderPath: string | null;
  proxyPath: string | null;
};

export const BLUR_THRESHOLD = 20;

/**
 * Cloud Run temp storage is memory-backed, so ingest downloads each original
 * whole. Larger uploads are accepted (the upload limit is 10 GiB) but fail
 * ingest with a clear reason until a streaming path exists.
 */
export const MAX_INGEST_BYTES = 2 * 1024 ** 3;
export const MAX_INGEST_ATTEMPTS = 5;

/** A Firestore transaction allows 500 writes; one is the asset itself. */
export const MAX_SHOTS_PER_ASSET = 400;
