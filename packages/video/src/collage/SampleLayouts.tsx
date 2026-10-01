import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import type { CollageSpec } from "./schema";
import { SampleMedia } from "./SampleMedia";
import { BotanicalScrapbook } from "./BotanicalScrapbook";
import { NinePhotoGrid } from "./NinePhotoGrid";
import { mosaicEntranceAt, mosaicTime } from "./sampleMotion";

export const SAMPLE_LAYOUT_IDS = new Set<string>(["travel-mosaic", "travel-story", "botanical-scrapbook", "nine-photo-grid"]);
type Rect = { x: number; y: number; w: number; h: number };
const rect = (x: number, y: number, w: number, h: number): Rect => ({ x, y, w, h });
const box = ({ x, y, w, h }: Rect): React.CSSProperties => ({ position: "absolute", left: `${x}%`, top: `${y}%`, width: `${w}%`, height: `${h}%`, boxSizing: "border-box" });

// Keep the reference geometries at their preferred counts; smaller existing
// collages get a complete grid without duplicating or dropping their photos.
function geometry(spec: CollageSpec, wide: boolean): { cells: Rect[]; title?: Rect; titleOrder?: number } {
  const count = spec.slots.length;
  if (spec.layoutId === "travel-mosaic" && count === 8) return {
    cells: [rect(0,0,24,32),rect(25.5,0,24,32),rect(51,0,49,32),rect(0,33.5,49.5,32),rect(82,33.5,18,32),rect(0,67,24,33),rect(25.5,67,24,33),rect(51,67,49,33)],
    title: rect(51,33.5,29.5,32), titleOrder: 4,
  };
  if (spec.layoutId === "travel-story" && count === 5) return {
    cells: wide
      ? [rect(0,0,49,32),rect(50.5,0,49.5,65.5),rect(0,33.5,24,66.5),rect(25.5,33.5,23.5,32),rect(25.5,67,74.5,33)]
      : [rect(0,0,65.5,32),rect(67,0,33,65.5),rect(0,33.5,32,66.5),rect(33.5,33.5,32,32),rect(33.5,67,66.5,33)],
  };
  const hasTitle = spec.layoutId === "travel-mosaic";
  const total = count + Number(hasTitle);
  const columns = total === 9 ? 3 : wide ? Math.min(4, Math.ceil(total / 2)) : Math.min(3, Math.ceil(Math.sqrt(total)));
  const rows = Math.ceil(total / columns);
  const cells: Rect[] = [];
  const titleOrder = hasTitle ? Math.floor(total / 2) : undefined;
  let title: Rect | undefined;
  let next = 0;
  const gap = 2;
  const rowH = (100 - gap * (rows - 1)) / rows;
  for (let row = 0; row < rows; row++) {
    const rowCount = Math.min(columns, total - row * columns);
    const cellW = (100 - gap * (rowCount - 1)) / rowCount;
    for (let col = 0; col < rowCount; col++, next++) {
      const cell = rect(col * (cellW + gap), row * (rowH + gap), cellW, rowH);
      if (next === titleOrder) title = cell;
      else cells.push(cell);
    }
  }
  return { cells, title, titleOrder };
}

export const SampleLayouts: React.FC<{ spec: CollageSpec; sources?: Record<string, string> }> = ({ spec, sources }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const wide = width > height;
  const mosaic = spec.layoutId === "travel-mosaic";
  const seconds = frame / fps;
  const { cells, title, titleOrder } = geometry(spec, wide);
  if (spec.layoutId === "botanical-scrapbook") return <BotanicalScrapbook spec={spec} sources={sources} />;
  if (spec.layoutId === "nine-photo-grid") return <NinePhotoGrid spec={spec} sources={sources} />;
  const entranceStyle = (cell: Rect, order: number): React.CSSProperties => {
    const motion = mosaicEntranceAt(seconds, order, cell, spec.durationSec);
    return { opacity: motion.opacity, transform: `translate(${motion.translateX}%, ${motion.translateY}%) rotate(${motion.rotation}deg)` };
  };
  // The mosaic title reveals after its tile lands, as in the reference.
  const time = mosaicTime(seconds, spec.durationSec);
  const reveal = (value: string | undefined, start: number, span: number) => value?.slice(0, Math.floor(value.length * Math.max(0, Math.min(1, (time - start) / span))));
  const headline = reveal(spec.caption?.headline ?? spec.caption?.place, .9, 1);
  const subline = reveal(spec.caption?.subline ?? spec.caption?.date, 1.1, .9);
  return <AbsoluteFill style={{ containerType: "inline-size", background: "#fff", overflow: "hidden" }}>
    {spec.slots.map((slot,index) => {
      const entry = interpolate(seconds - index * .09, [0,.65], [0,1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
      const settled = 1 - Math.pow(1-entry,3);
      const relay = Math.sin(Math.PI * interpolate(seconds, [index * .35,index * .35 + 1.4], [0,1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })) * .035;
      const order = titleOrder !== undefined && index >= titleOrder ? index + 1 : index;
      return <div key={slot.slotId} style={{ ...box(cells[index]), zIndex: index + 1, ...(mosaic ? entranceStyle(cells[index], order) : { opacity: settled }), background: "#fffdf7" }}>
        <div style={{ height: "100%", overflow: "hidden", position: "relative" }}><SampleMedia slot={slot} sources={sources} scale={mosaic ? 1 : 1 + relay} /></div>
      </div>;
    })}
    {title && <div style={{ ...box(title), ...entranceStyle(title, titleOrder!), background: "#201d20", zIndex: 10, display: "grid", placeItems: "center" }}>
      <div style={{ padding: "8%", textAlign: "center", color: "#fffdf7", fontFamily: "Figtree,sans-serif", fontSize: wide ? "2cqw" : "4cqw", lineHeight: 1.35, letterSpacing: ".02em", overflowWrap: "anywhere" }}>{headline}{subline && <div style={{ marginTop: "1em", fontSize: ".5em", letterSpacing: ".08em" }}>{subline}</div>}</div>
    </div>}
  </AbsoluteFill>;
};
