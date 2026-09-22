import React from "react";
import {
  AbsoluteFill,
  Img,
  OffthreadVideo,
  Sequence,
  interpolate,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { PhotoTable } from "./PhotoTable";

/**
 * THROWAWAY SPIKE. Renders a poc/gemini composition end to end, with collage
 * shots spliced in by buildFilm.mjs.
 *
 * This is deliberately NOT the Timeline contract: it is the POC's own clip
 * shape, reshaped enough to watch. The real renderer is
 * packages/video/src/Timeline.tsx.
 */

export type FilmClip = {
  id: string;
  kind: "video" | "photo" | "collage";
  files: string[];
  startSec: number;
  durationSec: number;
  sourceInSec?: number;
  audio: "keep" | "mute";
  transitionIn: "cut" | "crossfade" | "dip";
  seed?: string;
  label: string;
};

export type FilmProps = {
  fps: number;
  durationSec: number;
  crossfadeSec: number;
  dipSec: number;
  clips: FilmClip[];
};

/** Slow push on a still, so a held photo is never a frozen frame. */
const STILL_ZOOM = 0.07;

const ClipBody: React.FC<{ clip: FilmClip; spanFrames: number }> = ({ clip, spanFrames }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  if (clip.kind === "collage") {
    return (
      <PhotoTable
        cells={clip.files.map((file) => staticFile(file))}
        seed={clip.seed}
        spanFrames={spanFrames}
      />
    );
  }

  const fill: React.CSSProperties = { width: "100%", height: "100%", objectFit: "cover" };

  if (clip.kind === "video") {
    return (
      <OffthreadVideo
        src={staticFile(clip.files[0])}
        trimBefore={Math.round((clip.sourceInSec ?? 0) * fps)}
        muted={clip.audio !== "keep"}
        style={fill}
      />
    );
  }

  const scale = interpolate(frame, [0, spanFrames], [1, 1 + STILL_ZOOM], { extrapolateRight: "clamp" });
  return <Img src={staticFile(clip.files[0])} style={{ ...fill, transform: `scale(${scale})` }} />;
};

/**
 * One clip's own opacity, and the black it dips through.
 *
 * A crossfade overlaps the previous clip and ramps this one up over it, so it is
 * the incoming clip's opacity. A dip does not overlap: the outgoing picture goes
 * to black over half the transition and the incoming comes up from black over
 * the other half, which is a black veil on each side of the boundary.
 */
const Clip: React.FC<{
  clip: FilmClip;
  dipOut: boolean;
  crossfadeSec: number;
  dipSec: number;
}> = ({ clip, dipOut, crossfadeSec, dipSec }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const spanFrames = Math.max(1, Math.round(clip.durationSec * fps));

  const fadeInFrames = clip.transitionIn === "crossfade" ? Math.round(crossfadeSec * fps) : 0;
  const opacity =
    fadeInFrames > 0
      ? interpolate(frame, [0, fadeInFrames], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })
      : 1;

  const halfDip = Math.max(1, Math.round((dipSec / 2) * fps));
  const veilIn = clip.transitionIn === "dip" ? interpolate(frame, [0, halfDip], [1, 0], { extrapolateRight: "clamp" }) : 0;
  const veilOut = dipOut
    ? interpolate(frame, [spanFrames - halfDip, spanFrames], [0, 1], { extrapolateLeft: "clamp" })
    : 0;
  const veil = Math.max(veilIn, veilOut);

  return (
    <AbsoluteFill style={{ opacity }}>
      <ClipBody clip={clip} spanFrames={spanFrames} />
      {veil > 0 ? <AbsoluteFill style={{ backgroundColor: "black", opacity: veil }} /> : null}
    </AbsoluteFill>
  );
};

export const Film: React.FC<FilmProps> = ({ fps, clips, crossfadeSec, dipSec }) => (
  <AbsoluteFill style={{ backgroundColor: "black" }}>
    {clips.map((clip, index) => (
      <Sequence
        key={clip.id}
        from={Math.round(clip.startSec * fps)}
        durationInFrames={Math.max(1, Math.round(clip.durationSec * fps))}
        // Later clips paint over earlier ones, which is what makes a crossfade
        // read as the incoming picture arriving rather than the outgoing leaving.
        layout="none"
      >
        <Clip
          clip={clip}
          dipOut={clips[index + 1]?.transitionIn === "dip"}
          crossfadeSec={crossfadeSec}
          dipSec={dipSec}
        />
      </Sequence>
    ))}
  </AbsoluteFill>
);

/** The composition's length comes from the built film, not a constant. */
export const filmMetadata = ({ props }: { props: FilmProps }) => ({
  durationInFrames: Math.round(props.durationSec * props.fps),
  fps: props.fps,
});
