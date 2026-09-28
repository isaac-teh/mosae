import React from "react";
import { AbsoluteFill, Composition, registerRoot, staticFile } from "remotion";
import { Collage } from "./Collage";
import { COLLAGE_LAYOUTS, type CollageSpec } from "./schema";
import { TRIP_PHOTO_FILES } from "../../gallery/src/tripPhotos";
import { createCollageSpec, PLACEHOLDER_PHOTOS } from "./fixtures";

const WIDTH = 720;
const HEIGHT = 1280;
const FPS = 30;
const FRAMES = 90;
const sampleSources = process.env.MOSAE_COLLAGE_STILL_PLACEHOLDERS === "1"
  ? PLACEHOLDER_PHOTOS.map((file) => staticFile(file.replace(/^\//, "")))
  : TRIP_PHOTO_FILES.map((file) => staticFile(file));

export function specForLayout(layoutId: CollageSpec["layoutId"]): CollageSpec {
  const fixture = createCollageSpec(layoutId, {
    motionId: "ken-burns",
    effectId: null,
    seed: `review-still-${layoutId}`,
    slots: createCollageSpec(layoutId).slots.map((slot, index) => ({ slotId: slot.slotId, src: sampleSources[index % sampleSources.length] })),
  });
  return fixture;
}

const StillCard: React.FC<{ layoutId: CollageSpec["layoutId"]; index: number }> = ({ layoutId, index }) => {
  const left = 34 + (index % 4) * 284;
  const top = 72 + Math.floor(index / 4) * 482;
  const spec = specForLayout(layoutId);
  return <>
    <div style={{ position: "absolute", left, top: top - 27, width: 260, height: 22, color: "#14283a", font: "bold 16px Arial, sans-serif" }}>{layoutId}</div>
    <div style={{ position: "absolute", left, top, width: 260, height: 455, overflow: "hidden", backgroundColor: "#14283a" }}><Collage spec={spec} /></div>
  </>;
};

const ContactSheet: React.FC = () => <AbsoluteFill style={{ background: "#f4f5f3", padding: 0 }}>
  <div style={{ position: "absolute", left: 34, top: 20, color: "#14283a", font: "bold 22px Arial, sans-serif" }}>Mosaé collage layouts · Remotion stills · 9:16</div>
  {COLLAGE_LAYOUTS.map((layout, index) => <StillCard key={layout.id} layoutId={layout.id} index={index} />)}
</AbsoluteFill>;

const Root: React.FC = () => <>
  {COLLAGE_LAYOUTS.map((layout) => <Composition
    key={layout.id}
    id={`Collage-${layout.id}`}
    component={Collage}
    defaultProps={{ spec: specForLayout(layout.id) }}
    durationInFrames={FRAMES}
    fps={FPS}
    width={WIDTH}
    height={HEIGHT}
  />)}
  <Composition id="CollageContactSheet" component={ContactSheet} durationInFrames={FRAMES} fps={FPS} width={1160} height={1030} defaultProps={{}} />
</>;

registerRoot(Root);
