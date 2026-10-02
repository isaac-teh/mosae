import React from "react";
import type { AudioClip, VideoClip } from "@mosae/contracts";
import { AbsoluteFill, Audio, Img, OffthreadVideo, Sequence, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { audioTrimFrames, gainToVolume, type TimelineProps } from "./timelineMetadata";
import { Collage } from "./collage/Collage";
import { redactImageSource } from "./imageDiagnostic";

/**
 * Clips carry explicit output-relative start times, so they render as absolute
 * Sequences rather than a TransitionSeries. A crossfade or dip is expressed as
 * the incoming clip's opacity ramp over transitionIn.durationSec.
 */
function ClipBody({ clip, sources }: { clip: VideoClip; sources: Record<string, string> }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const src = sources[clip.source.shotId];
  const fadeFrames = Math.round(clip.transitionIn.durationSec * fps);
  const opacity = fadeFrames > 0 ? interpolate(frame, [0, fadeFrames], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) : 1;
  const scale = clip.motion
    ? interpolate(frame, [0, Math.round(clip.durationSec * fps)], [clip.motion.from, clip.motion.to], { extrapolateRight: "clamp" })
    : 1;
  const style: React.CSSProperties = { width: "100%", height: "100%", objectFit: "cover", transform: `scale(${scale})` };

  if (!src) return null;
  return (
    <AbsoluteFill style={{ opacity }}>
      {clip.source.kind === "video" ? (
        <OffthreadVideo src={src} trimBefore={Math.round(clip.source.sourceInSec * fps)} style={style} />
      ) : (
        <Img src={src} style={style} onImageError={(error) => console.error("render_image_decode_failed", { source: redactImageSource(src), error: error.name })} />
      )}
    </AbsoluteFill>
  );
}

function AudioTrack({ clip, fps, sources }: { clip: AudioClip; fps: number; sources: Record<string, string> }) {
  const key = clip.source.kind === "asset" ? clip.source.assetId : clip.source.soundtrackId;
  const src = sources[key];
  if (!src) return null;
  const { trimBeforeFrames, trimAfterFrames } = audioTrimFrames(clip.source, fps);
  return (
    <Sequence from={0} durationInFrames={Number.MAX_SAFE_INTEGER}>
      <Audio
        src={src}
        volume={gainToVolume(clip.gainDb)}
        trimBefore={trimBeforeFrames}
        trimAfter={trimAfterFrames}
      />
    </Sequence>
  );
}

export const MosaeTimeline: React.FC<TimelineProps> = ({ timeline, sources, selectedCollageCellId, onSelectCollageCell, onCommitCollageCrop }) => {
  const fps = timeline.fps;
  return (
    <AbsoluteFill style={{ backgroundColor: "#15110f", overflow: "hidden" }}>
      {timeline.videoClips.map((clip) => (
        <Sequence
          key={"kind" in clip ? clip.clipId : clip.id}
          from={Math.round(clip.startSec * fps)}
          durationInFrames={Math.max(1, Math.round(clip.durationSec * fps))}
        >
          {"kind" in clip ? <Collage spec={clip.spec} sources={sources} clipId={clip.clipId} selectedCollageCellId={selectedCollageCellId} onSelectCollageCell={onSelectCollageCell} onCommitCollageCrop={onCommitCollageCrop} /> : <ClipBody clip={clip} sources={sources} />}
        </Sequence>
      ))}
      {timeline.audioClips.map((clip) => (
        <Sequence key={clip.id} from={Math.round(clip.startSec * fps)} durationInFrames={Math.max(1, Math.round((clip.source.sourceOutSec - clip.source.sourceInSec) * fps))}>
          <AudioTrack clip={clip} fps={fps} sources={sources} />
        </Sequence>
      ))}
      {timeline.captions.map((caption, index) => (
        <Sequence
          key={`caption-${index}`}
          from={Math.round(caption.startSec * fps)}
          durationInFrames={Math.max(1, Math.round((caption.endSec - caption.startSec) * fps))}
        >
          <AbsoluteFill style={{ justifyContent: "flex-end", alignItems: "center", paddingBottom: "8%" }}>
            <span style={{ color: "white", fontSize: 42, fontFamily: "sans-serif", textAlign: "center", padding: "0 6%", textShadow: "0 2px 8px rgba(0,0,0,0.8)" }}>
              {caption.text}
            </span>
          </AbsoluteFill>
        </Sequence>
      ))}
    </AbsoluteFill>
  );
};
