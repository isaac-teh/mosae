import React, { useRef } from "react";

export type PhotoTransform = { x: number; y: number; scale: number; rotationDeg?: number };
type Point = { x: number; y: number };

/** Pointer based crop/rotation controls for a selected still in the editor preview. */
export function PhotoInteraction({ clipId, selected, transform = { x: 0.5, y: 0.5, scale: 1, rotationDeg: 0 }, onSelect, onCommit }: {
  clipId: string;
  selected?: boolean;
  transform?: PhotoTransform;
  onSelect?: (clipId: string) => void;
  onCommit?: (clipId: string, transform: PhotoTransform) => void;
}) {
  const points = useRef(new Map<number, Point>());
  const currentTransform = () => ({ x: transform.x, y: transform.y, scale: transform.scale, rotationDeg: transform.rotationDeg ?? 0 });
  const origin = useRef(currentTransform());
  const start = useRef<Point | null>(null);
  const gesture = useRef<{ distance: number; angle: number } | null>(null);
  const preview = useRef(currentTransform());
  const changed = useRef(false);
  const apply = (element: HTMLDivElement, next: PhotoTransform) => {
    preview.current = { ...next, rotationDeg: next.rotationDeg ?? 0 };
    const media = element.parentElement?.querySelector<HTMLElement>("[data-photo-media]");
    if (media) {
      media.style.objectPosition = `${next.x * 100}% ${next.y * 100}%`;
      media.style.transform = `scale(${next.scale}) rotate(${next.rotationDeg ?? 0}deg)`;
    }
  };
  if (!onSelect && !onCommit) return null;
  const update = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!points.current.has(event.pointerId)) return;
    event.preventDefault();
    points.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    changed.current = true;
    const current = [...points.current.values()];
    const bounds = event.currentTarget.getBoundingClientRect();
    const next = { ...origin.current };
    if (current.length > 1 && gesture.current) {
      const dx = current[1]!.x - current[0]!.x;
      const dy = current[1]!.y - current[0]!.y;
      next.scale = Math.max(1, Math.min(4, origin.current.scale * Math.hypot(dx, dy) / Math.max(1, gesture.current.distance)));
      const angle = Math.atan2(dy, dx) - gesture.current.angle;
      next.rotationDeg = ((origin.current.rotationDeg! + angle * 180 / Math.PI + 540) % 360) - 180;
    } else if (start.current) {
      next.x = Math.max(0, Math.min(1, origin.current.x - (current[0]!.x - start.current.x) / Math.max(1, bounds.width * origin.current.scale)));
      next.y = Math.max(0, Math.min(1, origin.current.y - (current[0]!.y - start.current.y) / Math.max(1, bounds.height * origin.current.scale)));
    }
    apply(event.currentTarget, next);
  };
  const finish = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!points.current.has(event.pointerId)) return;
    points.current.delete(event.pointerId);
    if (!points.current.size) {
      origin.current = preview.current;
      if (changed.current) onCommit?.(clipId, preview.current);
      changed.current = false;
      start.current = null;
      gesture.current = null;
    }
  };
  return <div role="button" aria-label={selected ? "Selected photo clip" : "Select photo clip"} aria-pressed={Boolean(selected)} data-photo-clip={clipId}
    onClick={(event) => event.stopPropagation()}
    onPointerDown={(event) => {
      event.preventDefault(); event.stopPropagation();
      event.currentTarget.setPointerCapture?.(event.pointerId);
      const point = { x: event.clientX, y: event.clientY };
      if (!points.current.size) { origin.current = currentTransform(); preview.current = currentTransform(); start.current = point; changed.current = false; }
      else { const first = [...points.current.values()][0]!; const dx = point.x - first.x; const dy = point.y - first.y; gesture.current = { distance: Math.hypot(dx, dy), angle: Math.atan2(dy, dx) }; }
      points.current.set(event.pointerId, point);
      onSelect?.(clipId);
    }}
    onPointerMove={update}
    onPointerUp={(event) => { event.stopPropagation(); finish(event); }}
    onPointerCancel={finish}
    onDoubleClick={(event) => { event.preventDefault(); event.stopPropagation(); const reset = { x: .5, y: .5, scale: 1, rotationDeg: 0 }; origin.current = reset; preview.current = reset; apply(event.currentTarget, reset); onCommit?.(clipId, reset); }}
    style={{ position: "absolute", inset: 0, zIndex: 100, border: selected ? "12px solid #f38a5b" : "3px solid transparent", boxSizing: "border-box", touchAction: "none", cursor: selected ? "grab" : "pointer" }} />;
}
