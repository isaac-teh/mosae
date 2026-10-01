import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import type { CollageSpec } from "./schema";
import { SampleMedia } from "./SampleMedia";
import { gridTileAt, referenceTime } from "./referenceMotion";

export const NinePhotoGrid: React.FC<{ spec: CollageSpec; sources?: Record<string, string> }> = ({ spec, sources }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const seconds = frame / fps;
  const count = spec.slots.length;
  const columns = count === 9 ? 3 : width > height ? Math.min(4, Math.ceil(count / 2)) : Math.ceil(Math.sqrt(count));
  const rows = Math.ceil(count / columns);
  const margin = 5.1, gap = 2.3;
  const cellH = (100 - margin * 2 - gap * (rows - 1)) / rows;
  const text = spec.caption?.headline ?? spec.caption?.place ?? "";
  const time = referenceTime(seconds, spec.durationSec);
  const caption = text.slice(0, Math.floor(text.length * Math.max(0, Math.min(1, (time - .75) / 1.75))));
  return <AbsoluteFill style={{ containerType: "inline-size", background: "#fff", overflow: "hidden" }}>
    {spec.slots.map((slot, index) => {
      const row = Math.floor(index / columns);
      const rowCount = Math.min(columns, count - row * columns);
      const cellW = (100 - margin * 2 - gap * (rowCount - 1)) / rowCount;
      const motion = gridTileAt(seconds, index, spec.durationSec);
      return <div key={slot.slotId} style={{ position: "absolute", left: `${margin + index % columns * (cellW + gap)}%`, top: `${margin + row * (cellH + gap)}%`, width: `${cellW}%`, height: `${cellH}%`, zIndex: count - index, opacity: motion.opacity, transform: `translateX(${motion.translateX / cellW * 100}%) rotate(${motion.rotation}deg)`, overflow: "hidden", background: "#eee8dd" }}>
        <SampleMedia slot={slot} sources={sources} />
        {index === Math.floor(count / 2) && caption && <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", padding: "7%", background: "rgba(255,253,247,.26)", color: "#3d3936", fontFamily: "Figtree,sans-serif", fontSize: width > height ? "1.9cqw" : "3.05cqw", fontWeight: 400, lineHeight: 1.5, letterSpacing: ".16em", textAlign: "center", textTransform: "uppercase", overflowWrap: "anywhere" }}>{caption}</div>}
      </div>;
    })}
  </AbsoluteFill>;
};
