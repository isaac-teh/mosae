import React from "react";
import { AbsoluteFill, Audio, Img, OffthreadVideo, Sequence, interpolate, staticFile, useCurrentFrame } from "remotion";
import { fade } from "@remotion/transitions/fade";
import { linearTiming, TransitionSeries } from "@remotion/transitions";
import { birthdayStoryEdit, type Clip, type EditDecisionList } from "./edit";

function Media({ clip }: { clip: Clip }) {
  const frame = useCurrentFrame();
  const scale = clip.motion?.type === "slow-zoom-in"
    ? interpolate(frame, [0, clip.durationFrames], [clip.motion.from, clip.motion.to], { extrapolateRight: "clamp" })
    : 1;
  const style: React.CSSProperties = { width: "100%", height: "100%", objectFit: "cover", transform: `scale(${scale})` };
  return clip.kind === "video"
    ? <OffthreadVideo src={staticFile(clip.src)} startFrom={clip.sourceStartFrame} style={style} />
    : <Img src={staticFile(clip.src)} style={style} />;
}

function Soundtrack({ edit }: { edit: EditDecisionList }) {
  const frame = useCurrentFrame();
  const track = edit.soundtrack;
  if (!track) return null;
  const duration = edit.clips.reduce((total, clip) => total + clip.durationFrames, 0);
  const volume = interpolate(frame, [0, track.fadeInFrames, duration - track.fadeOutFrames, duration], [0, track.volume, track.volume, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return <Audio src={staticFile(track.src)} volume={volume} />;
}

export function MosaeFilm({ edit = birthdayStoryEdit }: { edit?: EditDecisionList }) {
  return <AbsoluteFill style={{ backgroundColor: "#15110f", overflow: "hidden" }}>
    <TransitionSeries>
      {edit.clips.map((clip) => {
        const transition = clip.transitionOut;
        return <React.Fragment key={clip.id}>
          <TransitionSeries.Sequence durationInFrames={clip.durationFrames}><Media clip={clip} /></TransitionSeries.Sequence>
          {transition?.type === "crossfade" && <TransitionSeries.Transition presentation={fade()} timing={linearTiming({ durationInFrames: transition.durationFrames })} />}
        </React.Fragment>;
      })}
    </TransitionSeries>
    <Soundtrack edit={edit} />
  </AbsoluteFill>;
}
