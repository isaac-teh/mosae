import React from "react";
import type { AudioClip, VideoClip } from "@mosae/contracts";
import { AbsoluteFill, Audio, Img, OffthreadVideo, Sequence, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { audioTrimFrames, audioVolumeAt, clipFitForSource, type TimelineProps } from "./timelineMetadata";
import { Collage } from "./collage/Collage";
import { redactImageSource } from "./imageDiagnostic";
import { PhotoInteraction } from "./PhotoInteraction";

/**
 * Clips carry explicit output-relative start times, so they render as absolute
 * Sequences rather than a TransitionSeries. A crossfade or dip is expressed as
 * the incoming clip's opacity ramp over transitionIn.durationSec.
 */
function ClipBody({ clip, sources, sourceDimensions, aspect, selected, onSelect, onCommitPhotoCrop }: { clip: VideoClip; sources: Record<string, string>; sourceDimensions?: TimelineProps["sourceDimensions"]; aspect: TimelineProps["timeline"]["aspect"]; selected?: boolean; onSelect?: (clipId: string) => void; onCommitPhotoCrop?: TimelineProps["onCommitPhotoCrop"] }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const src = sources[clip.source.shotId];
  const fadeFrames = Math.round(clip.transitionIn.durationSec * fps);
  const opacity = fadeFrames > 0 ? interpolate(frame, [0, fadeFrames], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) : 1;
  const scale = clip.motion
    ? interpolate(frame, [0, Math.round(clip.durationSec * fps)], [clip.motion.from, clip.motion.to], { extrapolateRight: "clamp" })
    : 1;
  const photoTransform = clip.source.kind === "photo" ? clip.source.crop : undefined;
  const fit = clipFitForSource(sourceDimensions?.[clip.source.shotId] ?? (clip.source.width && clip.source.height ? { width: clip.source.width, height: clip.source.height } : undefined), aspect, photoTransform);
  const blurredFill = fit === "fill";
  const style: React.CSSProperties = { width: "100%", height: "100%", objectFit: "cover", objectPosition: photoTransform ? `${photoTransform.x * 100}% ${photoTransform.y * 100}%` : "50% 50%", transform: `scale(${scale * (photoTransform?.scale ?? 1)}) rotate(${photoTransform?.rotationDeg ?? 0}deg)` };

  if (!src) return null;
  return (
    <AbsoluteFill style={{ opacity }}>
      {blurredFill ? <div data-blurred-fill-background="true" style={{ position: "absolute", inset: 0, zIndex: 0, overflow: "hidden" }}>
        {clip.source.kind === "video" ? <OffthreadVideo src={src} trimBefore={Math.round(clip.source.sourceInSec * fps)} style={{ ...style, objectFit: "cover", filter: "blur(40px) brightness(0.6)", transform: "scale(1.15)" }} /> : <Img src={src} style={{ ...style, objectFit: "cover", filter: "blur(40px) brightness(0.6)", transform: "scale(1.15)" }} />}
      </div> : null}
      {clip.source.kind === "video" ? (
        <OffthreadVideo src={src} trimBefore={Math.round(clip.source.sourceInSec * fps)} style={blurredFill ? { ...style, position: "absolute", inset: 0, zIndex: 1, objectFit: "contain", objectPosition: "50% 50%" } : style} />
      ) : (
        <Img src={src} data-photo-media="true" style={blurredFill ? { ...style, position: "absolute", inset: 0, zIndex: 1, objectFit: "contain", objectPosition: "50% 50%" } : style} onImageError={(error) => console.error("render_image_decode_failed", { source: redactImageSource(src), error: error.name })} />
      )}
      {clip.source.kind === "photo" ? <PhotoInteraction clipId={clip.id} selected={selected} transform={photoTransform} onSelect={onSelect} onCommit={onCommitPhotoCrop} /> : onSelect ? <div role="button" aria-label={selected ? "Selected video clip" : "Select video clip"} aria-pressed={Boolean(selected)} onClick={(event) => { event.stopPropagation(); onSelect(clip.id); }} style={{ position: "absolute", inset: 0, boxSizing: "border-box", border: selected ? "12px solid #f38a5b" : "3px solid transparent", cursor: "pointer" }} /> : null}
    </AbsoluteFill>
  );
}

function AudioTrack({ clip, fps, sources }: { clip: AudioClip; fps: number; sources: Record<string, string> }) {
  const key = clip.source.kind === "asset" ? clip.source.assetId : clip.source.soundtrackId;
  const src = sources[key];
  if (!src) return null;
  const { trimBeforeFrames, trimAfterFrames } = audioTrimFrames(clip.source, fps);
  const durationFrames = Math.max(1, Math.round((clip.source.sourceOutSec - clip.source.sourceInSec) * fps));
  const fadeInFrames = Math.round(clip.fadeInSec * fps);
  const fadeOutFrames = Math.round(clip.fadeOutSec * fps);
  return (
    <Sequence from={0} durationInFrames={Number.MAX_SAFE_INTEGER}>
      <Audio
        src={src}
        volume={(frame) => audioVolumeAt(clip.gainDb, frame, durationFrames, fadeInFrames, fadeOutFrames)}
        trimBefore={trimBeforeFrames}
        trimAfter={trimAfterFrames}
      />
    </Sequence>
  );
}

export const MosaeTimeline: React.FC<TimelineProps> = ({ timeline, sources, sourceDimensions, selectedClipId, onSelectClip, onCommitPhotoCrop, selectedCollageCellId, onSelectCollageCell, onCommitCollageCrop }) => {
  const fps = timeline.fps;
  return (
    <AbsoluteFill style={{ backgroundColor: "#15110f", overflow: "hidden" }}>
      {timeline.videoClips.map((clip) => (
        <Sequence
          key={"kind" in clip ? clip.clipId : clip.id}
          from={Math.round(clip.startSec * fps)}
          durationInFrames={Math.max(1, Math.round(clip.durationSec * fps))}
        >
          {"kind" in clip ? <Collage spec={clip.spec} sources={sources} clipId={clip.clipId} selectedCollageCellId={selectedCollageCellId} onSelectCollageCell={onSelectCollageCell} onCommitCollageCrop={onCommitCollageCrop} /> : <ClipBody clip={clip} sources={sources} sourceDimensions={sourceDimensions} aspect={timeline.aspect} selected={selectedClipId === clip.id} onSelect={onSelectClip} onCommitPhotoCrop={onCommitPhotoCrop} />}
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
