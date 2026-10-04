import { randomUUID } from "node:crypto";
import type { Timeline } from "@mosae/contracts";

export type EditScope = { kind: "film" } | { kind: "clip"; clipId: string } | { kind: "slot"; clipId: string; slotId: string };
export type EditContext = { scope: EditScope; requestId: string };

/** Resolve selection only against the owned, persisted current timeline. */
export function validateEditContext(timeline: Timeline, value: unknown): EditContext | null {
  if (value === undefined) return { scope: { kind: "film" }, requestId: randomUUID() };
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const { scope, requestId } = value as Record<string, unknown>;
  if (typeof requestId !== "string" || !requestId.trim() || requestId.length > 200 || !scope || typeof scope !== "object" || Array.isArray(scope)) return null;
  const selected = scope as Record<string, unknown>;
  if (selected.kind === "film") return { scope: { kind: "film" }, requestId };
  if (typeof selected.clipId !== "string") return null;
  const clip = timeline.videoClips.find((item) => ("kind" in item ? item.clipId : item.id) === selected.clipId);
  if (!clip) return null;
  if (selected.kind === "clip") return { scope: { kind: "clip", clipId: selected.clipId }, requestId };
  if (selected.kind !== "slot" || typeof selected.slotId !== "string" || !("kind" in clip)) return null;
  if (!clip.spec.slots.some((slot) => slot.slotId === selected.slotId && slot.shotId && !slot.empty)) return null;
  return { scope: { kind: "slot", clipId: selected.clipId, slotId: selected.slotId }, requestId };
}
