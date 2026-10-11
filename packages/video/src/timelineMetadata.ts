import type { Timeline } from "@mosae/contracts";

export type TimelineProps = {
  timeline: Timeline;
  /**
   * shotId, assetId or soundtrackId to a resolvable URL. Rendering never derives
   * a storage path itself: the caller resolves and signs, so the renderer stays
   * usable from a test fixture and from Cloud Run without changing.
   */
  sources: Record<string, string>;
  sourceDimensions?: Record<string, { width: number; height: number }>;
  selectedClipId?: string | null;
  onSelectClip?: (clipId: string) => void;
  onCommitPhotoCrop?: (clipId: string, crop: { x: number; y: number; scale: number; rotationDeg?: number }) => void;
  selectedCollageCellId?: string | null;
  onSelectCollageCell?: (clipId: string, slotId: string) => void;
  onCommitCollageCrop?: (clipId: string, slotId: string, crop: { x: number; y: number; scale: number; rotationDeg?: number }) => void;
};

export type ClipFit = "fill" | "cover";
export function clipFitForSource(dimensions: { width: number; height: number } | undefined, aspect: Timeline["aspect"], photoTransform?: unknown): ClipFit {
  if (photoTransform || !dimensions || dimensions.width <= 0 || dimensions.height <= 0) return "cover";
  const sourceLandscape = dimensions.width / dimensions.height > 1;
  const timelineLandscape = aspect === "16:9";
  return sourceLandscape === timelineLandscape ? "cover" : "fill";
}

const FRAME_SIZES = { "16:9": { width: 1920, height: 1080 }, "9:16": { width: 1080, height: 1920 } } as const;

export function timelineMetadata({ props }: { props: TimelineProps }) {
  const { timeline } = props;
  return {
    durationInFrames: Math.max(1, Math.round(timeline.durationSec * timeline.fps)),
    fps: timeline.fps,
    ...FRAME_SIZES[timeline.aspect],
  };
}

/** Decibels are the contract's unit; Remotion wants a linear multiplier. */
export function gainToVolume(gainDb: number): number {
  if (gainDb <= -60) return 0;
  return Math.max(0, 10 ** (gainDb / 20));
}

export function audioTrimFrames(
  source: { sourceInSec: number; sourceOutSec: number },
  fps: number,
): { trimBeforeFrames: number; trimAfterFrames: number } {
  return {
    trimBeforeFrames: Math.round(source.sourceInSec * fps),
    trimAfterFrames: Math.round(source.sourceOutSec * fps),
  };
}

/** Apply timeline fades with frame based volume so previews and renders agree. */
export function audioVolumeAt(gainDb: number, frame: number, durationFrames: number, fadeInFrames: number, fadeOutFrames: number): number {
  const fadeIn = fadeInFrames > 0 ? Math.min(1, Math.max(0, frame / fadeInFrames)) : 1;
  const remaining = durationFrames - frame;
  const fadeOut = fadeOutFrames > 0 ? Math.min(1, Math.max(0, remaining / fadeOutFrames)) : 1;
  return gainToVolume(gainDb) * Math.min(fadeIn, fadeOut);
}
