import type { Firestore } from "firebase-admin/firestore";
import { applyEdits, type EditOp, type Timeline } from "@mosae/contracts";
import type { Cast } from "../cast/types.js";
import type { ShotAnalysis } from "../domain/understanding.js";
import { loadLibrary, libraryPath } from "../music/library.js";
import { buildWorkingSet, type WorkingShot } from "./workingSet.js";
import type { EditScope } from "./editContext.js";
import { getEditConversation, type EditConversationTurn } from "./editStore.js";

export type EditSourceCandidate = {
  shotId: string; assetId: string; kind: "photo" | "video"; caption: string;
  personIds: string[]; sourceStartSec: number | null; sourceEndSec: number | null;
  width?: number; height?: number; localTime?: string | null; eventId?: string | null;
  quality?: number; blurry?: boolean;
};
export type EditContext = {
  scope: EditScope;
  storyIntent: { text: string; focus: string[] } | null;
  constraints: Record<string, unknown>;
  people: { personId: string; name: string | null; role: string; focused: boolean }[];
  selected: { clipId: string; slotId?: string; shotIds: string[]; captions: string[] } | null;
  candidates: EditSourceCandidate[];
  /** Full bounded owned-media catalog for deterministic "all library" edits. */
  libraryCandidates?: EditSourceCandidate[];
  soundtracks: { id: string; name: string; description: string; cadence: string; durationSec: number; storagePath: string }[];
  conversation: EditConversationTurn[];
};

/** Bounded deterministic retrieval: no embeddings, identity inference or model calls. */
export async function loadEditContext(db: Firestore, userId: string, projectId: string, generationId: string, scope: EditScope): Promise<EditContext> {
  const project = db.doc(`projects/${projectId}`);
  const owner = await project.get();
  if (!owner.exists || owner.get("userId") !== userId) throw new Error("not_found");
  const generation = await project.collection("generations").doc(generationId).get();
  if (!generation.exists) throw new Error("not_found");
  const proposalId = generation.get("proposalId");
  const [castSnap, shots, proposalSnap, edits, conversation] = await Promise.all([
    project.collection("cast").doc("current").get(),
    project.collection("shots").limit(200).get(),
    typeof proposalId === "string" ? project.collection("storyProposals").doc(proposalId).get() : Promise.resolve(null),
    project.collection("generations").doc(generationId).collection("edits").doc("current").get(),
    getEditConversation(db, userId, projectId, generationId),
  ]);
  const proposal = proposalSnap?.data();
  const intentId = proposal?.storyIntentId;
  const intent = typeof intentId === "string" ? (await project.collection("storyIntents").doc(intentId).get()).data() : undefined;
  const cast = castSnap.data() as Cast | undefined;
  const confirmed = cast?.confirmed ? cast.people.filter(person => !person.excluded) : [];
  const focus = generation.get("settings")?.focus;
  const focusIds: string[] = typeof focus === "string" ? focus === "family" ? [] : focus.split(",").filter(Boolean) : (proposal?.constraints?.focusCharacterIds ?? cast?.focus ?? []);
  const people = confirmed.map(person => ({ personId: person.personId, name: person.name?.trim() || null, role: person.role ?? "other", focused: focusIds.includes(person.personId) }));
  const personIds = new Set(people.map(person => person.personId));
  const assetIds = [...new Set(shots.docs.map(shot => shot.get("assetId")).filter((id): id is string => typeof id === "string" && !id.includes("/")))];
  const assets = assetIds.length ? await db.getAll(...assetIds.map(id => project.collection("assets").doc(id))) : [];
  const assetMap = new Map(assets.filter(asset => asset.exists).map(asset => [asset.id, asset.data()!]));
  const working: (WorkingShot & { assetId: string })[] = [];
  for (const shot of shots.docs) {
    if (shot.get("projectId") && shot.get("projectId") !== projectId) continue;
    const assetId = shot.get("assetId") as string;
    const asset = assetMap.get(assetId);
    const analysis = shot.get("analysis") as ShotAnalysis | undefined;
    if (!asset || (asset.projectId && asset.projectId !== projectId) || asset.generation !== shot.get("assetGeneration") || !analysis) continue;
    const start = shot.get("sourceStartSec"), end = shot.get("sourceEndSec");
    if (analysis.kind === "video" && (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start || (Number.isFinite(asset.media?.durationSec) && end > asset.media.durationSec))) continue;
    working.push({ id: shot.id, assetId, assetStatus: asset.status, dupOf: asset.dupOf ?? null, analysis, eventId: asset.eventId ?? null, localTime: asset.media?.localTime ?? null, sourceStartSec: start ?? null, sourceEndSec: end ?? null });
  }
  const constraints = proposal?.constraints ?? {};
  const excludedShotIds = [...(constraints.excludedShotIds ?? []), ...(constraints.hiddenShotIds ?? [])];
  const rankedCandidates = buildWorkingSet(working, { cap: 40, excludedShotIds }).shots;
  const candidateIds = new Set(rankedCandidates.map(shot => shot.id));
  // Keep one grounded project photo for each confirmed person even when the
  // general relevance ranking would otherwise leave that person out.
  const allEligibleShots = buildWorkingSet(working, { cap: Math.max(40, working.length), excludedShotIds }).shots;
  for (const person of people) {
    if (rankedCandidates.some(shot => shot.analysis?.kind === "photo" && shot.analysis.faces?.some(face => face.characterId === person.personId))) continue;
    const representative = allEligibleShots.find(shot => shot.analysis?.kind === "photo" && shot.analysis.faces?.some(face => face.characterId === person.personId));
    if (representative && !candidateIds.has(representative.id)) {
      candidateIds.add(representative.id);
      rankedCandidates.push(representative);
    }
  }
  const candidateFor = (shot: typeof allEligibleShots[number]) => ({
    shotId: shot.id, assetId: (shot as typeof working[number]).assetId, kind: shot.analysis!.kind,
    caption: (shot.analysis!.kind === "photo" ? shot.analysis!.caption : shot.analysis!.description).slice(0, 2000),
    personIds: shot.analysis!.kind === "photo" ? [...new Set((shot.analysis!.faces ?? []).flatMap(face => face.characterId && personIds.has(face.characterId) ? [face.characterId] : []))] : [],
    ...(assetMap.get((shot as typeof working[number]).assetId)?.media?.width ? { width: assetMap.get((shot as typeof working[number]).assetId)!.media!.width } : {}),
    ...(assetMap.get((shot as typeof working[number]).assetId)?.media?.height ? { height: assetMap.get((shot as typeof working[number]).assetId)!.media!.height } : {}),
    sourceStartSec: shot.sourceStartSec ?? null, sourceEndSec: shot.sourceEndSec ?? null,
    localTime: shot.localTime, eventId: shot.eventId,
    quality: shot.analysis!.kind === "photo" ? shot.analysis!.keyMomentScore : shot.analysis!.quality,
    blurry: assetMap.get((shot as typeof working[number]).assetId)?.quality?.blurry === true,
  });
  const candidates = rankedCandidates.map(candidateFor);
  const libraryCandidates = allEligibleShots.map(candidateFor);
  const timeline = generation.get("timeline") as Timeline | undefined;
  const applied = timeline ? applyEdits(timeline, (edits.get("ops") ?? []) as EditOp[]) : null;
  const current = applied?.ok ? applied.timeline : timeline;
  const clip = scope.kind !== "film" ? current?.videoClips.find(clip => ("kind" in clip ? clip.clipId : clip.id) === scope.clipId) : undefined;
  const selected = clip && scope.kind !== "film" ? {
    clipId: scope.clipId, ...(scope.kind === "slot" ? { slotId: scope.slotId } : {}),
    shotIds: "kind" in clip ? clip.spec.slots.filter(slot => scope.kind !== "slot" || slot.slotId === scope.slotId).flatMap(slot => slot.shotId ? [slot.shotId] : []) : [clip.source.shotId],
    captions: current!.captions.filter(caption => caption.startSec < clip.startSec + clip.durationSec && caption.endSec > clip.startSec).map(caption => caption.text),
  } : null;
  return { scope, storyIntent: intent && (intent.projectId === undefined || intent.projectId === projectId) && typeof intent.text === "string" ? { text: intent.text.slice(0, 2000), focus: intent.focus ?? [] } : null, constraints, people, selected, candidates, libraryCandidates, soundtracks: loadLibrary().filter(track => Number.isFinite(track.durationSec) && track.durationSec > 0).map(track => ({ id: track.id, name: track.name, description: track.description, cadence: track.cadence, durationSec: track.durationSec, storagePath: libraryPath(track) })), conversation: conversation ?? [] };
}
