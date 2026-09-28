import React from "react";
import { AbsoluteFill, Composition, registerRoot, staticFile } from "remotion";
import { Collage } from "./Collage";
import { ALLOWED_COMBOS } from "./allowedCombos";
import { COLLAGE_LAYOUTS, type CollageSpec } from "./schema";
import { TRIP_PHOTO_FILES } from "../../gallery/src/tripPhotos";
import { createCollageSpec, PLACEHOLDER_PHOTOS } from "./fixtures";

const WIDTH = 720;
const HEIGHT = 1280;
const FPS = 30;
const FRAMES = 150;
const STILL_MOTION_BY_LAYOUT: Record<CollageSpec["layoutId"], CollageSpec["motionId"]> = {
  "photo-table": "stack-deal",
  "torn-paper": "print-drop",
  "polaroid-garland": "focus-relay",
  "film-negative": "page-turn",
  "postcard-stack": "stack-deal",
  "route-map": "stack-deal",
};
const sampleSources = process.env.MOSAE_COLLAGE_STILL_PLACEHOLDERS === "1"
  ? PLACEHOLDER_PHOTOS.map((file) => staticFile(file.replace(/^\//, "")))
  : TRIP_PHOTO_FILES.map((file) => staticFile(file));

export function specForLayout(
  layoutId: CollageSpec["layoutId"],
  motionId: CollageSpec["motionId"] = STILL_MOTION_BY_LAYOUT[layoutId],
  effectId: CollageSpec["effectId"] = null,
): CollageSpec {
  const base = createCollageSpec(layoutId);
  return createCollageSpec(layoutId, {
    motionId,
    effectId,
    seed: `library-${layoutId}`,
    durationSec: 5,
    caption: { place: "Kyoto · Japan", date: "AUTUMN 2026", headline: "Postcards from Kyoto", subline: "A small collection of places" },
    slots: base.slots.map((slot, index) => ({ slotId: slot.slotId, src: sampleSources[index % sampleSources.length] })),
  });
}

const StillCard: React.FC<{ layoutId: CollageSpec["layoutId"]; index: number }> = ({ layoutId, index }) => {
  const left = 30 + (index % 3) * 375;
  const top = 68 + Math.floor(index / 3) * 625;
  return <>
    <div style={{ position: "absolute", left, top: top - 23, width: 340, height: 18, color: "#14283a", font: "600 14px Figtree, sans-serif", letterSpacing: ".08em" }}>
      {COLLAGE_LAYOUTS.find((layout) => layout.id === layoutId)?.label.toUpperCase()}
    </div>
    <div style={{ position: "absolute", left, top, width: 340, height: 605, overflow: "hidden", backgroundColor: "#14283a" }}>
      <Collage spec={specForLayout(layoutId)} />
    </div>
  </>;
};

const ContactSheet: React.FC = () => <AbsoluteFill style={{ background: "#eee9df" }}>
  <div style={{ position: "absolute", left: 30, top: 15, color: "#14283a", font: "600 21px Literata, serif" }}>Mosaé · Reviewed collage forms / 9:16</div>
  {COLLAGE_LAYOUTS.map((layout, index) => <StillCard key={layout.id} layoutId={layout.id} index={index} />)}
</AbsoluteFill>;

const Sample: React.FC<{ layoutId: CollageSpec["layoutId"]; motionId: CollageSpec["motionId"] }> = ({ layoutId, motionId }) => (
  <Collage spec={specForLayout(layoutId, motionId, "warm-grade")} />
);

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
  {ALLOWED_COMBOS.filter((combo) => combo.motionId === STILL_MOTION_BY_LAYOUT[combo.layoutId]).map(({ layoutId, motionId }) => (
    <Composition
      key={layoutId}
      id={`Sample-${layoutId}`}
      component={Sample}
      defaultProps={{ layoutId, motionId }}
      durationInFrames={FRAMES}
      fps={FPS}
      width={WIDTH}
      height={HEIGHT}
    />
  ))}
  <Composition id="CollageContactSheet" component={ContactSheet} defaultProps={{}} durationInFrames={FRAMES} fps={FPS} width={1140} height={1320} />
</>;

registerRoot(Root);
