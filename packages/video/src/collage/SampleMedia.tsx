import React from "react";
import { Img, OffthreadVideo } from "remotion";
import type { CollageSlot } from "./schema";
import { redactImageSource } from "../imageDiagnostic";

export const SampleMedia: React.FC<{ slot: CollageSlot; sources?: Record<string, string>; scale?: number }> = ({ slot, sources, scale = 1 }) => {
  const src = slot.src ?? (slot.shotId ? sources?.[slot.shotId] : undefined);
  const style: React.CSSProperties = { width: "100%", height: "100%", objectFit: "cover", objectPosition: slot.crop ? `${slot.crop.x * 100}% ${slot.crop.y * 100}%` : "center", display: "block", transform: `scale(${scale * (slot.crop?.scale ?? 1)})` };
  if (!src) return <div data-collage-media="true" style={{ ...style, background: "linear-gradient(145deg,#a5b8b1,#c97756 52%,#304858)" }} />;
  return slot.kind === "video" ? <OffthreadVideo src={src} muted data-collage-media="true" style={style} /> : <Img src={src} data-collage-media="true" style={style} onImageError={(error) => console.error("render_image_decode_failed", { source: redactImageSource(src), error: error.name })} />;
};
