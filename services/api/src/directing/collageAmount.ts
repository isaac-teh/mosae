import { applyEdits, planCollageMerges, type EditOp, type Timeline } from "@mosae/contracts";
import type { InterpretEditRequest, InterpretEditResult } from "./interpretEdit.js";

/** Deterministic "more / most / fewer / no collages" requests. Returns null when the text is not a collage-amount request. */
export function collageAmountEdit(req: InterpretEditRequest): InterpretEditResult | null {
  const text = req.text;
  if (/^\s*add\s+more\s+collage\b/i.test(text) || !/\b(?:more|most|fewer|less|no)\s+collages?\b|\bmore\s+collage(?:\s+moments)?\b/i.test(text)) return null;
  const collages = req.timeline.videoClips.filter((clip): clip is Extract<Timeline["videoClips"][number], { kind: "collage" }> => "kind" in clip);
  const none = /\bno\s+collages?\b/i.test(text);
  const fewer = /\b(?:fewer|less)\s+collages?\b/i.test(text);
  if (none || fewer) {
    const count = none ? collages.length : Math.max(1, Math.ceil(collages.length / 2));
    const ops: EditOp[] = collages.slice(-count).map(clip => ({ op: "splitCollage", clipId: clip.clipId }));
    if (!ops.length) return { kind: "clarify", reply: "There are no collages to split in this film.", ops: [] };
    const applied = applyEdits(req.timeline, ops);
    if (!applied.ok) return { kind: "unsupported", reply: "I couldn't reduce the collages because one of them has no photos to split.", ops: [] };
    return { kind: "edit", reply: `Split ${ops.length} collage${ops.length === 1 ? "" : "s"} into separate moments.`, ops };
  }
  const most = /\bmost\s+collages?\b/i.test(text);
  const peopleByShot = new Map((req.groundedContext?.candidates ?? []).map(candidate => [candidate.shotId, candidate.personIds] as const));
  const ops = planCollageMerges({ timeline: req.timeline, peopleByShot }, most ? "most" : "more");
  if (!ops.length) return { kind: "clarify", reply: "I couldn't find neighbouring photos from the same part of the story to combine into a collage. Try asking for a layout change instead.", ops: [] };
  const applied = applyEdits(req.timeline, ops);
  if (!applied.ok) return { kind: "unsupported", reply: "I couldn't combine those photos into a collage.", ops: [] };
  return { kind: "edit", reply: `Combined neighbouring photos into ${ops.length} new collage${ops.length === 1 ? "" : "s"}.`, ops };
}
