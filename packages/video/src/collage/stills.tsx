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
const STILL_MOTION_BY_LAYOUT: Partial<Record<CollageSpec["layoutId"], CollageSpec["motionId"]>> = {
  "single-photo": "print-drop",
  "grid-wide-top": "print-drop",
  "grid-wide-bottom": "print-drop",
  "grid-stacked-rows": "print-drop",
  "grid-tall-left": "print-drop",
  "grid-tall-right": "print-drop",
  "grid-three-columns": "print-drop",
  "two-photo-diptych": "print-drop",
  "travel-mosaic": "print-drop",
  "travel-story": "focus-relay",
  "botanical-scrapbook": "tape-slap",
  "nine-photo-grid": "print-drop",
  "photo-table": "stack-deal",
  "torn-paper": "print-drop",
  "polaroid-garland": "focus-relay",
  "postcard-stack": "stack-deal",
  "route-map": "stack-deal",
};
const sampleSources = process.env.MOSAE_COLLAGE_STILL_PLACEHOLDERS === "1"
  ? PLACEHOLDER_PHOTOS.map((file) => staticFile(file.replace(/^\//, "")))
  : TRIP_PHOTO_FILES.map((file) => staticFile(file));
const mixedOrientationSpec = createCollageSpec("grid-wide-top", {
  seed: "mixed-orientation-fixture",
  slots: ["/photos/photo-a.svg", "/photos/photo-landscape.svg", "/photos/photo-b.svg"].map((src, index) => ({ slotId: `mixed-${index + 1}`, src: staticFile(src.slice(1)), kind: "photo" as const })),
});

export function specForLayout(
  layoutId: CollageSpec["layoutId"],
  motionId: CollageSpec["motionId"] = STILL_MOTION_BY_LAYOUT[layoutId] ?? "print-drop",
  effectId: CollageSpec["effectId"] = null,
): CollageSpec {
  const base = createCollageSpec(layoutId);
  return createCollageSpec(layoutId, {
    motionId,
    effectId,
    seed: `library-${layoutId}`,
    durationSec: layoutId === "botanical-scrapbook" ? 5.2 : 5,
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
    durationInFrames={Math.round(specForLayout(layout.id).durationSec * FPS)}
    fps={FPS}
    width={WIDTH}
    height={HEIGHT}
  />)}
  <Composition id="Collage-mixed-orientation" component={Collage} defaultProps={{ spec: mixedOrientationSpec }} durationInFrames={FRAMES} fps={FPS} width={1280} height={720} />
  {ALLOWED_COMBOS.filter((combo) => combo.motionId === STILL_MOTION_BY_LAYOUT[combo.layoutId]).map(({ layoutId, motionId }) => (
    <Composition
      key={layoutId}
      id={`Sample-${layoutId}`}
      component={Sample}
      defaultProps={{ layoutId, motionId }}
      durationInFrames={Math.round(specForLayout(layoutId).durationSec * FPS)}
      fps={FPS}
      width={WIDTH}
      height={HEIGHT}
    />
  ))}
  {COLLAGE_LAYOUTS.filter((layout) => layout.aspect.some((aspect) => aspect === "16:9")).map((layout) => <Composition key={`wide-${layout.id}`} id={`Wide-${layout.id}`} component={Collage} defaultProps={{ spec: specForLayout(layout.id) }} durationInFrames={FRAMES} fps={FPS} width={1280} height={720} />)}
  {(["botanical-scrapbook", "nine-photo-grid"] as const).map((id) => <Composition key={`review-${id}`} id={`MotionReview-${id}`} component={Collage} defaultProps={{ spec: specForLayout(id) }} durationInFrames={Math.round(specForLayout(id).durationSec * FPS)} fps={FPS} width={800} height={800} />)}
  <Composition id="MotionReview-travel-mosaic" component={Collage} defaultProps={{ spec: specForLayout("travel-mosaic") }} durationInFrames={FRAMES} fps={FPS} width={800} height={800} />
  <Composition id="CollageContactSheet" component={ContactSheet} defaultProps={{}} durationInFrames={FRAMES} fps={FPS} width={1140} height={68 + Math.ceil(COLLAGE_LAYOUTS.length / 3) * 625} />
</>;

registerRoot(Root);
