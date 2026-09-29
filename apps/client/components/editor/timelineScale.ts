export const DEFAULT_PIXELS_PER_SECOND = 40;
export const MIN_PIXELS_PER_SECOND = 20;
export const MAX_PIXELS_PER_SECOND = 120;

export const timeToX = (seconds: number, pixelsPerSecond: number, leadingPadding: number) =>
  leadingPadding + seconds * pixelsPerSecond;

export const xToTime = (x: number, pixelsPerSecond: number, leadingPadding: number) =>
  (x - leadingPadding) / pixelsPerSecond;

export const timelineContentWidth = (durationSec: number, viewportWidth: number, pixelsPerSecond: number) =>
  durationSec * pixelsPerSecond + viewportWidth;
