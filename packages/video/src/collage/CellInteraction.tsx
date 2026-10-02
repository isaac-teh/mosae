import React, { useRef } from "react";
import type { CollageSlot } from "./schema";

type Crop = NonNullable<CollageSlot["crop"]>;
type Point = { x: number; y: number };

export function CellInteraction({ clipId, slotId, crop, selected, onSelect, onCommit }: {
  clipId: string;
  slotId: string;
  crop?: Crop;
  selected?: boolean;
  onSelect?: (clipId: string, slotId: string) => void;
  onCommit?: (clipId: string, slotId: string, crop: Crop) => void;
}) {
  const points = useRef(new Map<number, Point>());
  const origin = useRef<Crop>(crop ?? { x: 0.5, y: 0.5, scale: 1 });
  const start = useRef<Point | null>(null);
  const initialDistance = useRef(0);
  const preview = useRef<Crop>(origin.current);
  const changed = useRef(false);
  const readPoints = () => [...points.current.values()];
  const update = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!points.current.has(event.pointerId)) return;
    event.preventDefault();
    points.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    changed.current = true;
    const current = readPoints();
    const bounds = event.currentTarget.getBoundingClientRect();
    let next = { ...origin.current };
    if (current.length > 1) {
      const distance = Math.hypot(current[0]!.x - current[1]!.x, current[0]!.y - current[1]!.y);
      next.scale = Math.max(1, Math.min(4, origin.current.scale * distance / Math.max(1, initialDistance.current)));
    } else if (start.current) {
      next.x = Math.max(0, Math.min(1, origin.current.x - (current[0]!.x - start.current.x) / Math.max(1, bounds.width * origin.current.scale)));
      next.y = Math.max(0, Math.min(1, origin.current.y - (current[0]!.y - start.current.y) / Math.max(1, bounds.height * origin.current.scale)));
    }
    preview.current = next;
    const media = event.currentTarget.parentElement?.querySelector<HTMLElement>("[data-collage-media]");
    if (media) { media.style.objectPosition = `${next.x * 100}% ${next.y * 100}%`; media.style.transform = `scale(${next.scale})`; }
  };
  const finish = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!points.current.has(event.pointerId)) return;
    points.current.delete(event.pointerId);
    if (points.current.size === 0) {
      origin.current = preview.current;
      if (changed.current) onCommit?.(clipId, slotId, preview.current);
      changed.current = false;
      start.current = null;
    }
  };
  return <div role="button" aria-label={`Select collage cell ${slotId}`} aria-pressed={Boolean(selected)} data-collage-cell={`${clipId}:${slotId}`} onClick={(event) => event.stopPropagation()}
    onPointerDown={(event) => {
      event.preventDefault(); event.stopPropagation();
      event.currentTarget.setPointerCapture?.(event.pointerId);
      const current = { x: event.clientX, y: event.clientY };
      if (!points.current.size) { origin.current = crop ?? { x: 0.5, y: 0.5, scale: 1 }; preview.current = origin.current; start.current = current; changed.current = false; }
      else { const first = readPoints()[0]!; initialDistance.current = Math.hypot(first.x - current.x, first.y - current.y); }
      points.current.set(event.pointerId, current);
      onSelect?.(clipId, slotId);
    }}
    onPointerMove={update}
    onPointerUp={(event) => { event.stopPropagation(); finish(event); }}
    onPointerCancel={finish}
    onDoubleClick={(event) => { event.preventDefault(); event.stopPropagation(); const reset = { x: 0.5, y: 0.5, scale: 1 }; origin.current = reset; preview.current = reset; const media = event.currentTarget.parentElement?.querySelector<HTMLElement>("[data-collage-media]"); if (media) { media.style.objectPosition = "50% 50%"; media.style.transform = "scale(1)"; } onCommit?.(clipId, slotId, reset); }}
    style={{ position: "absolute", inset: 0, zIndex: 100, border: selected ? "2px solid #F5C842" : "2px solid transparent", touchAction: "none", cursor: "grab", boxSizing: "border-box" }} />;
}
