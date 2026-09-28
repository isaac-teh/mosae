import React from "react";
import { AbsoluteFill, Img, interpolate, random, useCurrentFrame, useVideoConfig } from "remotion";
import type { CollageSpec, CollageSlot } from "./schema";

export type CollageProps = { spec: CollageSpec; sources?: Record<string, string> };
const photoTableBG = "radial-gradient(80% 50% at 35% 20%, #9a7048 0%, #765333 52%, #4f3928 100%)";

function placement(layout: CollageSpec["layoutId"], i: number, count: number, seed: string): React.CSSProperties {
  if (layout === "triptych") return { left: `${(i * 100) / 3}%`, top: 0, width: `${100 / 3}%`, height: "100%" };
  if (layout === "hero-plus-two") return i === 0 ? { left: 0, top: 0, width: "66.67%", height: "100%" } : { left: "66.67%", top: i === 1 ? 0 : "50%", width: "33.33%", height: "50%" };
  if (layout === "grid-4") return { left: `${(i % 2) * 50}%`, top: `${Math.floor(i / 2) * 50}%`, width: "50%", height: "50%" };
  if (layout === "filmstrip") return { left: `${(i * 100) / count}%`, top: "20%", width: `${100 / count}%`, height: "60%" };
  if (layout === "split-screen") return { left: 0, top: `${i * 50}%`, width: "100%", height: "50%" };
  if (layout === "single-framed") return { left: "8%", top: "8%", width: "84%", height: "84%" };
  if (layout === "photo-table") {
    const columns = count === 4 ? [31, 69] : [32, 68];
    const rows = count === 4 ? [34, 66] : [25, 50, 75];
    const jitterX = (random(`${seed}:${i}:x`) - 0.5) * 9;
    const jitterY = (random(`${seed}:${i}:y`) - 0.5) * 5.6;
    return { left: `${columns[i % 2] + jitterX}%`, top: `${rows[Math.floor(i / 2)] + jitterY}%`, width: count === 4 ? "46%" : "41.5%", height: "29%", marginLeft: count === 4 ? "-23%" : "-20.75%", marginTop: "-14.5%", transform: `rotate(${(random(`${seed}:${i}:r`) - 0.5) * 15}deg)` };
  }
  if (layout === "polaroid-stack") {
    return { left: `${50 + (random(`${seed}:${i}:x`) - 0.5) * 26}%`, top: `${50 + (random(`${seed}:${i}:y`) - 0.5) * 38}%`, width: "58%", height: "58%", marginLeft: "-29%", marginTop: "-29%", transform: `rotate(${(random(`${seed}:${i}:r`) - 0.5) * 20}deg)` };
  }
  return { left: `${18 + (i % 2) * 37}%`, top: `${12 + Math.floor(i / 2) * (68 / Math.ceil(count / 2))}%`, width: "48%", height: `${75 / Math.ceil(count / 2)}%` };
}

function sourceFor(slot: CollageSlot, sources?: Record<string, string>): string | undefined {
  return slot.src ?? (slot.shotId ? sources?.[slot.shotId] : undefined);
}

function seededPosition(seed: string, i: number) {
  return { x: (random(`${seed}:${i}:x`) - 0.5) * 9, y: (random(`${seed}:${i}:y`) - 0.5) * 9, rotate: (random(`${seed}:${i}:r`) - 0.5) * 14 };
}

const Cell: React.FC<{ spec: CollageSpec; slot: CollageSlot; index: number; sources?: Record<string, string> }> = ({ spec, slot, index, sources }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const start = index * Math.round(fps * 0.1);
  const progress = interpolate(frame - start, [0, Math.max(1, spec.durationSec * fps - start)], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const position = seededPosition(spec.seed, index);
  let transform = `scale(${1 + progress * 0.11})`;
  if (spec.motionId === "slide-in") transform = `translateX(${(index % 2 ? 1 : -1) * (1 - progress) * 18}%) scale(1.04)`;
  if (spec.motionId === "zoom-in") transform = `scale(${0.78 + progress * 0.28})`;
  if (spec.motionId === "ken-burns") transform = `scale(${1 + progress * 0.14}) translate(${(progress - 0.5) * position.x}%, ${(progress - 0.5) * position.y}%)`;
  if (spec.motionId === "parallax-drift") transform = `scale(1.12) translate(${(progress - 0.5) * position.x * 1.5}%, ${(progress - 0.5) * position.y * 1.5}%)`;
  if (spec.motionId === "pop-in") transform = `scale(${interpolate(progress, [0, 0.75, 1], [0.72, 1.04, 1])}) rotate(${(1 - progress) * position.rotate}deg)`;
  if (spec.motionId === "drift") transform = `scale(1.1) translate(${(progress - 0.5) * position.x}%, ${(progress - 0.5) * position.y}%)`;
  if (spec.layoutId === "photo-table" || spec.layoutId === "polaroid-stack") transform += ` rotate(${position.rotate}deg)`;
  const src = sourceFor(slot, sources);
  const crop = slot.crop;
  const print = spec.layoutId === "photo-table" || spec.layoutId === "polaroid-stack";
  return <div key={slot.slotId} style={{ position: "absolute", boxSizing: "border-box", padding: spec.layoutId === "single-framed" ? "2.5%" : print ? "2% 2% 8%" : "0.7%", overflow: "hidden", ...placement(spec.layoutId, index, spec.slots.length, spec.seed), zIndex: Math.floor(random(`${spec.seed}:${index}:z`) * 20) }}>
    <div style={{ height: "100%", overflow: "hidden", background: print ? "#fdfbf7" : "#304354", border: spec.layoutId === "single-framed" ? "12px solid #fafaf7" : "1px solid rgba(255,255,255,.42)", boxShadow: print ? "3px 12px 24px rgba(20,12,5,.4)" : "0 4px 18px rgba(0,0,0,.18)" }}>
      {src ? <Img src={src} style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: crop ? `${crop.x * 100}% ${crop.y * 100}%` : "center", transform }} /> : <div style={{ width: "100%", height: "100%", background: "linear-gradient(135deg,#8299aa,#33495b)" }} />}
    </div>
  </div>;
};

const Effect: React.FC<{ id: NonNullable<CollageSpec["effectId"]>; seed: string }> = ({ id, seed }) => {
  const common: React.CSSProperties = { pointerEvents: "none", mixBlendMode: "screen" };
  if (id === "vignette") return <AbsoluteFill style={{ ...common, background: "radial-gradient(ellipse at center, transparent 48%, rgba(0,0,0,.62) 100%)", mixBlendMode: "multiply" }} />;
  if (id === "warm-grade") return <AbsoluteFill style={{ ...common, background: "rgba(237,153,82,.17)", mixBlendMode: "soft-light" }} />;
  if (id === "film-grain") return <AbsoluteFill style={{ ...common, opacity: 0.15, backgroundImage: `repeating-radial-gradient(circle at ${random(`${seed}:grain-x`) * 100}% ${random(`${seed}:grain-y`) * 100}%, rgba(255,255,255,.24) 0 1px, transparent 1px 3px)`, backgroundSize: "5px 5px", mixBlendMode: "overlay" }} />;
  return <AbsoluteFill style={{ ...common, background: `linear-gradient(${110 + random(`${seed}:leak`) * 35}deg, transparent 15%, rgba(255,176,93,.28) 46%, transparent 72%)` }} />;
};

export const Collage: React.FC<CollageProps> = ({ spec, sources }) => <AbsoluteFill style={{ background: spec.layoutId === "photo-table" ? photoTableBG : "#14283a", overflow: "hidden" }}>
  {spec.slots.map((slot, index) => <Cell key={slot.slotId} spec={spec} slot={slot} index={index} sources={sources} />)}
  {spec.effectId && <Effect id={spec.effectId} seed={spec.seed} />}
</AbsoluteFill>;
