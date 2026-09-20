import type { Timeline } from "@mosae/contracts";

export type TimelineProps = {
  timeline: Timeline;
  /**
   * shotId, assetId or soundtrackId to a resolvable URL. Rendering never derives
   * a storage path itself: the caller resolves and signs, so the renderer stays
   * usable from a test fixture and from Cloud Run without changing.
   */
  sources: Record<string, string>;
};

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
