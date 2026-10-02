import React from "react";
import { Img, OffthreadVideo } from "remotion";
import type { CollageSlot } from "./schema";
import { redactImageSource } from "../imageDiagnostic";

export const SampleMedia: React.FC<{ slot: CollageSlot; sources?: Record<string, string>; scale?: number }> = ({ slot, sources, scale = 1 }) => {
  const src = slot.src ?? (slot.shotId ? sources?.[slot.shotId] : undefined);
  const style: React.CSSProperties = { width: "100%", height: "100%", objectFit: "cover", objectPosition: slot.crop ? `${slot.crop.x * 100}% ${slot.crop.y * 100}%` : "center", display: "block", transform: `scale(${scale * (slot.crop?.scale ?? 1)}) rotate(${slot.crop?.rotationDeg ?? 0}deg)` };
  if (!src) return <div data-collage-media="true" style={{ ...style, background: slot.empty ? "#344651" : "#17232b", display: "grid", placeItems: "center", color: "#d8e1e7", font: "600 3cqw Figtree,sans-serif" }}>{slot.empty ? "Add photo" : null}</div>;
  return slot.kind === "video" ? <OffthreadVideo src={src} muted data-collage-media="true" style={style} /> : <Img src={src} data-collage-media="true" style={style} onImageError={(error) => console.error("render_image_decode_failed", { source: redactImageSource(src), error: error.name })} />;
};
