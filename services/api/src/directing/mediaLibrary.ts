import { applyEdits, planCollageMerges, type EditOp, type Timeline } from "@mosae/contracts";
import type { InterpretEditRequest, InterpretEditResult } from "./interpretEdit.js";
import { describeApplied } from "./editReply.js";

const requestKind = (text: string): "more" | "all" | null => {
  if (/\b(?:all|everything|every(?:thing)?)\b.{0,30}\b(?:photos?|videos?|media|library)\b|\b(?:photos?|videos?|media)\b.{0,30}\b(?:all|everything)\b|\buse\s+everything\b/i.test(text)) return "all";
  if (/\b(?:use\s+more|add\s+more|more\s+of\s+my)\b.{0,35}\b(?:photos?|videos?|media|library)\b|\bmore\s+(?:photos?|videos?)\b/i.test(text)) return "more";
  return null;
};

function idOf(clip: Timeline["videoClips"][number]): string { return "kind" in clip ? clip.clipId : clip.id; }
function usedIds(timeline: Timeline): Set<string> {
  return new Set(timeline.videoClips.flatMap(clip => "kind" in clip ? clip.spec.slots.flatMap(slot => slot.shotId ? [slot.shotId] : []) : [clip.source.shotId]));
}

/** Deterministic library additions for broad photo/video requests. */
export function mediaLibraryEdit(req: InterpretEditRequest): InterpretEditResult | null {
  const mode = requestKind(req.text);
  const personMatch = /\badd\s+(?:more\s+)?photos?\s+of\s+([^,.;]+?)(?=\s+and\s+make\s+it\b|[,.;]|$)/i.exec(req.text);
  if (!mode && !personMatch) return null;
  const context = req.groundedContext;
  const catalog = context?.libraryCandidates ?? context?.candidates ?? [];
  const used = usedIds(req.timeline);
  const allMeansBlurry = /\b(?:including|even)\s+blurry\b/i.test(req.text);
  const requestedPerson = personMatch?.[1]?.trim();
  const matchingPeople = requestedPerson ? (context?.people ?? []).filter(person => person.name?.toLocaleLowerCase() === requestedPerson.toLocaleLowerCase()) : [];
  if (requestedPerson && matchingPeople.length !== 1) return { kind: "clarify", reply: `I couldn't find a confirmed person named ${requestedPerson} in this project.`, ops: [] };
  const personId = matchingPeople[0]?.personId;
  const available = catalog.filter(candidate => !used.has(candidate.shotId)
    && (allMeansBlurry || !candidate.blurry)
    && (!personId || candidate.personIds.includes(personId))
    && (candidate.kind !== "video" || candidate.sourceStartSec !== null && candidate.sourceEndSec !== null));
  if (!available.length) {
    if (personId) return { kind: "clarify", reply: `I couldn't find unused photos of ${requestedPerson} in this project.`, ops: [] };
    return { kind: "clarify", reply: "You're already using every photo and video.", ops: [] };
  }
  const explicitAll = mode === "all";
  const requested = explicitAll ? [...available] : [];
  if (!explicitAll) {
    const count = Math.min(6, Math.max(3, available.length));
    const remaining = [...available];
    const chosenPeople = new Set<string>();
    const chosenEvents = new Set<string>();
    while (requested.length < count && remaining.length) {
      remaining.sort((a, b) => {
        const diversity = (candidate: typeof a) => candidate.personIds.filter(id => !chosenPeople.has(id)).length * 100
          + (candidate.eventId && !chosenEvents.has(candidate.eventId) ? 10 : 0) + (candidate.quality ?? 0);
        return diversity(b) - diversity(a) || a.shotId.localeCompare(b.shotId);
      });
      const next = remaining.shift()!;
      requested.push(next);
      next.personIds.forEach(id => chosenPeople.add(id));
      if (next.eventId) chosenEvents.add(next.eventId);
    }
  }
  // Stable shot id ties make selection reproducible; final ordering below is chronological.
  const existingByShot = new Map(catalog.map(candidate => [candidate.shotId, candidate]));
  const currentClips = req.timeline.videoClips;
  const anchorFor = (candidate: typeof requested[number]) => {
    const when = candidate.localTime ? Date.parse(candidate.localTime) : NaN;
    if (!Number.isFinite(when)) return currentClips.at(-1) ? idOf(currentClips.at(-1)!) : null;
    let best: { id: string; distance: number } | undefined;
    for (const clip of currentClips) {
      const shotIds = "kind" in clip ? clip.spec.slots.flatMap(slot => slot.shotId ? [slot.shotId] : []) : [clip.source.shotId];
      for (const shotId of shotIds) {
        const time = existingByShot.get(shotId)?.localTime;
        const parsed = time ? Date.parse(time) : NaN;
        if (!Number.isFinite(parsed)) continue;
        const distance = Math.abs(parsed - when);
        if (!best || distance < best.distance) best = { id: idOf(clip), distance };
      }
    }
    return best?.id ?? (currentClips.at(-1) ? idOf(currentClips.at(-1)!) : null);
  };
  requested.sort((a, b) => (a.localTime ?? "").localeCompare(b.localTime ?? "") || a.shotId.localeCompare(b.shotId));
  const ops: EditOp[] = [];
  const previousAtAnchor = new Map<string | null, string>();
  for (const candidate of requested) {
    const anchor = anchorFor(candidate);
    const afterClipId = previousAtAnchor.get(anchor) ?? anchor;
    const durationSec = candidate.kind === "photo" ? 3 : Math.min(3, candidate.sourceEndSec! - candidate.sourceStartSec!);
    const op: EditOp = candidate.kind === "photo"
      ? { op: "add", shotId: candidate.shotId, kind: "photo", afterClipId, durationSec }
      : { op: "add", shotId: candidate.shotId, kind: "video", afterClipId, durationSec, sourceInSec: candidate.sourceStartSec!, sourceOutSec: candidate.sourceStartSec! + durationSec };
    ops.push(op);
    previousAtAnchor.set(anchor, `add:${candidate.shotId}:1`);
  }
  const added = applyEdits(req.timeline, ops);
  if (!added.ok) return { kind: "unsupported", reply: "I couldn't add those library moments to this film.", ops: [] };
  if (explicitAll) {
    const merges = planCollageMerges({ timeline: added.timeline, peopleByShot: new Map(catalog.map(candidate => [candidate.shotId, candidate.personIds])) }, "most");
    ops.push(...merges);
  }
  const applied = applyEdits(req.timeline, ops);
  if (!applied.ok) return { kind: "unsupported", reply: "I couldn't add those library moments to this film.", ops: [] };
  let reply = describeApplied(req.text, ops, applied.timeline, context?.soundtracks, req.timeline);
  if (explicitAll && applied.timeline.durationSec > 90) reply += " The film is now over 90 seconds.";
  return { kind: "edit", reply, ops };
}
