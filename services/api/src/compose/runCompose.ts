import { reflow, refitSoundtrackToDuration, safeParseTimeline, syncCollageDurations, type ClipPlan } from "@mosae/contracts";
import { DURATION_SECONDS } from "@mosae/contracts";
import { buildCandidates } from "./buildCandidates.js";
import { allocateBudget } from "./budget.js";
import { composeCall, validateComposeResponse } from "./composeCall.js";
import { assemble, isEmptyResult } from "./assemble.js";
import { fitDuration } from "./fitDuration.js";
import { craftBrief, holdsFor } from "./brief.js";
import { buildAudioClips, gainToDb } from "./audio.js";
import { TRANSITION_SECONDS, overlapSec } from "./transitions.js";
import { validateTimeline, repairOnce } from "./validateTimeline.js";
import { applyCastGuards } from "./castGuards.js";
import type { AssembledClip } from "./assemble.js";
import type { Timeline, StoryProposal, CadenceId } from "@mosae/contracts";
import type { Candidate, Asset } from "./buildCandidates.js";
import { applyArc, orderByChronology, type ClipTime } from "./chronology.js";
import { loadCollageReview, placeCollages, type CollageReview, type CollageSource } from "./placeCollages.js";
import { collageCountRange, DIRECTING_RULES, budgetSlotCount, fadeOutSec, momentScore, requestedCollageCount } from "./directingRules.js";
import { MODELS } from "../gemini/pricing.js";
import { findSpeechBoundaryViolations, repairSpeechBoundaries } from "./speechBoundaries.js";
import { styleRecipeForCadence } from "./styleRecipe.js";
import { snapPhotoBoundaries, type CutMusic } from "./musicCuts.js";
import { buildAlbumProfile, loadLibrary, recommendSoundtrack, selectModelSoundtrack, soundtrackShortlist, type AlbumEvidence, type SoundtrackShortlistItem } from "../music/library.js";
import { reviewTimeline } from "./reviewTimeline.js";

export function applyUserOrder<T extends { itemId: string }>(clips: T[], momentOrder: string[] | undefined, chapterOf: Map<string, number>): T[] {
  if (!momentOrder?.length) return clips;
  const rank = new Map(momentOrder.map((id, i) => [id, i]));
  const out = [...clips];
  const chapters = [...new Set(clips.map((c) => chapterOf.get(c.itemId) ?? 0))];
  for (const chapter of chapters) {
    const slots = out.map((c, i) => ({ c, i })).filter(({ c }) => (chapterOf.get(c.itemId) ?? 0) === chapter);
    const sorted = [...slots].sort((a, b) => (rank.get(a.c.itemId) ?? Infinity) - (rank.get(b.c.itemId) ?? Infinity) || a.i - b.i);
    slots.forEach(({ i }, k) => { out[i] = sorted[k]!.c; });
  }
  return out;
}

export function isAutomaticDayLabel(text: string): boolean {
  return /^(?:day|chapter)\s+\d+\b/i.test(text.trim());
}

/** Rebuild chapter markers from surviving clips after any duration/review reflow. */
function syncTimelineChapters(timeline: Timeline, candidates: ReadonlyMap<string, Candidate>, proposal: StoryProposal): void {
  const starts = new Map<number, number[]>();
  for (const clip of timeline.videoClips) {
    const chapterIndex = "kind" in clip
      ? proposal.chapters.findIndex((chapter) => chapter.id === clip.chapterId)
      : candidates.get(clip.id)?.chapterIndex;
    if (chapterIndex === undefined || chapterIndex < 0) continue;
    starts.set(chapterIndex, [...(starts.get(chapterIndex) ?? []), clip.startSec]);
  }
  timeline.chapters = proposal.chapters.flatMap((chapter, index) => {
    const chapterStarts = starts.get(index);
    if (!chapterStarts?.length) return [];
    const startSec = Math.min(...chapterStarts);
    return startSec < timeline.durationSec ? [{ title: chapter.title, startSec }] : [];
  });
}

/** Result of a compose run. */
export type ComposeResult = {
  ok: true;
  timeline: Timeline;
  styleId: "memory";
  /** Picks the drop rules rejected. Not failures — kept on the generation for debugging. */
  droppedPicks: string[];
  /** What duration fitting had to do. Empty when the film landed on target. */
  notes: string[];
  /** Deterministic repairs applied by the final polish pass. */
  reviewNotes: string[];
  reasons: string[];
  usedSoundtrackId: string | null;
  soundtrackReason: string;
  leftOut: { shotId: string; reason: string }[];
  /** Automatically selected Short tier when a tierless film cannot reach 20s. */
  durationSelection?: { id: "short"; durationSec: number };
} | {
  ok: false;
  reasons: string[];
};

/** Dependencies needed by the compose pipeline. */
export interface ComposeDeps {
  /**
   * Run one structured model call. The caller supplies the transport — the real
   * Gemini client in `compose/wire.ts`, a recorded response in tests — so this
   * pipeline never constructs an SDK and never needs an API key to be loaded.
   */
  generateStructured: (options: unknown) => Promise<unknown>;
  /** Soundtrack IDs available for this project. */
  soundtrackIds: Set<string>;
  /** Assets map keyed by itemId. */
  assets: Map<string, Asset>;
  collageReview?: CollageReview;
}

/** Input to runCompose — the job parameters and data needed for composition. */
export interface ComposeJob {
  proposal: StoryProposal;
  projectId: string;
  generationId: string;
  mode: "creator" | "memory";
  aspect: "16:9" | "9:16";
  durationId: keyof typeof DURATION_SECONDS | "short" | null;
  durationSec?: number;
  cadenceId: CadenceId;
  seed: string;
  soundtrackId: string | null;
  soundtrackExplicit?: boolean;
  recentSoundtrackIds?: string[];
  projectSoundtrackId?: string | null;
  storyIntent?: string;
  /**
   * The user's free text from the Review screen. The spec's whole revision
   * mechanism is this string reaching the model, so it is part of the job, not
   * an afterthought the settings quietly drop.
   */
  note: string;
  /** Whether the model's text overlays are burned into the film. */
  captions: boolean;
  collageAmount?: "few" | "lots" | "none";
  motionFeel?: "calm" | "playful";
  /**
   * Person-anchored Ken Burns hint, keyed by moment id → face bbox center in
   * normalized 0–1 coordinates. When a photo clip's moment names a focus person
   * (a stored face whose characterId is in the proposal's `focusCharacterIds`),
   * composition centers the slow-zoom on that point instead of the frame
   * midpoint. Absent for a moment with no focus face, so it falls back to plain
   * geometry — and absent entirely means no person-anchored motion at all, which
   * keeps a null-focus film byte-identical to the pre-focus output.
   */
  focusCenter?: Map<string, { cx: number; cy: number }>;
  cast?: { summary: string; core: string[]; focus: string[]; peopleByMoment: Map<string, Set<string>>; subjectsByMoment: Map<string, Set<string>>; namesById: Record<string, string> };
  chapterOf?: Map<string, number>;
  timeOf?: Map<string, ClipTime>;
}

function fittedFilmLength(clips: AssembledClip[]): number {
  return Math.max(0, clips.reduce((total, clip, index) => total + (clip.holdSec ?? (clip.sourceOutSec ?? 0) - (clip.sourceInSec ?? 0)) - (index ? overlapSec(clip.transition) : 0), 0));
}

function overflowCollageGroups(candidates: Candidate[], assets: Map<string, Asset>, chapterOf: Map<string, number>, maxGroups: number, mediaCount: number): Candidate[][] {
  const range = collageCountRange(mediaCount);
  const minimum = range.minPhotos;
  const maximum = range.maxPhotos;
  const buckets = new Map<string, Candidate[]>();
  for (const candidate of candidates.filter((entry) => entry.kind === "photo")) {
    const asset = assets.get(candidate.itemId);
    const day = asset?.localTime?.slice(0, 10) ?? "";
    const bucketKey = asset?.eventId ? `event:${asset.eventId}` : day ? `day:${day}` : "";
    if (!bucketKey) continue;
    const key = `${chapterOf.get(candidate.itemId) ?? candidate.chapterIndex}:${bucketKey}`;
    const bucket = buckets.get(key) ?? [];
    bucket.push(candidate);
    buckets.set(key, bucket);
  }
  const groups: Candidate[][] = [];
  for (const bucket of buckets.values()) {
    bucket.sort((a, b) => (assets.get(a.itemId)?.localTime ?? "").localeCompare(assets.get(b.itemId)?.localTime ?? "") || a.itemId.localeCompare(b.itemId));
    for (let index = 0; index + minimum <= bucket.length && groups.length < maxGroups;) {
      const group = bucket.slice(index, Math.min(bucket.length, index + maximum));
      if (group.length < minimum) break;
      groups.push(group);
      index += group.length;
    }
    if (groups.length >= maxGroups) break;
  }
  return groups;
}

/**
 * Run the full compose pipeline: buildCandidates → composeCall → assemble
 * → fitDuration → reflow → buildAudioClips → validateTimeline → repairOnce.
 *
 * Returns a ComposeResult with either a valid Timeline or failure reasons.
 */
export async function runCompose(
  job: ComposeJob,
  deps: ComposeDeps,
): Promise<ComposeResult> {
  let targetSec = job.durationId === "short" ? job.durationSec ?? 0 : job.durationId === null ? 60 : DURATION_SECONDS[job.durationId] ?? 60;
  const styleRecipe = styleRecipeForCadence(job.cadenceId);
  const musicLibrary = loadLibrary();
  if (targetSec < 3 || targetSec > 30 && job.durationId === "short") return { ok: false, reasons: ["invalid short duration"] };

  // `buildCandidates` keys its catalog by moment id, because that is what the
  // proposal's chapters name. A Timeline names shots, so the two are joined
  // here rather than letting a moment id reach `source.shotId`, where
  // `resolveSources` would try to resolve it to a file and fail.
  const hiddenShotIds = new Set(job.proposal.constraints.hiddenShotIds ?? []);
  const shotIdByMoment = new Map(job.proposal.moments.map((moment) => {
    const swapped = job.proposal.constraints.photoSwaps?.[moment.id];
    return [moment.id, swapped && !hiddenShotIds.has(swapped) ? swapped : moment.shotId] as const;
  }));

  // Stage 1: buildCandidates — every legal clip per chapter
  const chapterInputs = job.proposal.chapters.map((ch, index) => ({
    index,
    itemIds: ch.momentIds,
  }));

  const candidates = buildCandidates(
    chapterInputs,
    deps.assets,
    holdsFor(job.cadenceId),
    6,
    job.cadenceId,
  );
  const primaryCandidates = candidates.filter((candidate) => !candidate.isExtraMoment);
  const candidateVideoSources = new Set(candidates.filter(candidate => candidate.kind === "video").map(candidate => deps.assets.get(candidate.itemId)?.assetId ?? candidate.itemId));
  const noWindowDrops = job.proposal.moments.flatMap(moment => {
    const asset = deps.assets.get(moment.id);
    const sourceId = asset?.assetId ?? moment.id;
    return asset?.kind === "video" && !candidateVideoSources.has(sourceId) ? [`${shotIdByMoment.get(moment.id) ?? moment.id}: no usable legal video window`] : [];
  });

  if (candidates.length === 0) {
    return { ok: false, reasons: ["no legal candidates — proposal has no media"] };
  }

  let tierlessShort = false;
  if (job.durationId === "short") {
    const hidden = new Set(job.proposal.constraints.hiddenShotIds ?? []);
    const excluded = new Set(job.proposal.constraints.excludedShotIds ?? []);
    const deselected = new Set(job.proposal.constraints.deselectedMomentIds ?? []);
    const capacityByMoment = new Map<string, number>();
    const standardCapacityByMoment = new Map<string, number>();
    for (const candidate of candidates) {
      const shotId = shotIdByMoment.get(candidate.itemId);
      if (!shotId || hidden.has(shotId) || excluded.has(shotId) || deselected.has(candidate.itemId)) continue;
      const capacity = candidate.kind === "photo"
        ? holdsFor(job.cadenceId).base * DIRECTING_RULES.tierlessPhotoStretchMultiplier
        : candidate.lengthSec ?? 0;
      capacityByMoment.set(candidate.itemId, Math.max(capacityByMoment.get(candidate.itemId) ?? 0, capacity));
      const standardCapacity = candidate.kind === "photo" ? DIRECTING_RULES.singlePhotoMaxSec : candidate.lengthSec ?? 0;
      standardCapacityByMoment.set(candidate.itemId, Math.max(standardCapacityByMoment.get(candidate.itemId) ?? 0, standardCapacity));
    }
    const materialCapacitySec = [...capacityByMoment.values()].reduce((total, seconds) => total + seconds, 0);
    const tierlessTargetSec = Math.min(DIRECTING_RULES.minimumFilmSec, Math.round(materialCapacitySec));
    tierlessShort = targetSec >= tierlessTargetSec;
    if (!tierlessShort) {
      // The cadence on the composition job is authoritative. Client estimates
      // can become stale when pace changes, so shorten the target to the capacity
      // calculated from the actual candidates and cadence used for this run.
      targetSec = Math.min(targetSec, [...standardCapacityByMoment.values()].reduce((total, seconds) => total + seconds, 0));
    }
    if (targetSec < 3) return { ok: false, reasons: ["short duration has less than three seconds of available material"] };
  }

  // Stage 2: composeCall — build the brief and prompt for Gemini
  const brief = craftBrief(job.cadenceId, targetSec);
  const albumEvidence: AlbumEvidence[] = job.proposal.moments.flatMap((moment) => {
    const analysis = deps.assets.get(moment.id)?.analysis;
    const candidatesForMoment = candidates.filter((candidate) => candidate.itemId === moment.id);
    const role = candidatesForMoment.find(({ storyRole }) => storyRole)?.storyRole ?? analysis?.storyRole;
    const energy = candidatesForMoment.flatMap((candidate) => [candidate.energy, candidate.highlightScore]
      .filter((value): value is number => typeof value === "number" && Number.isFinite(value)));
    const base: AlbumEvidence = {
      ...(analysis?.mood ? { mood: analysis.mood } : {}),
      ...(analysis?.activities ? { activities: analysis.activities } : {}),
      ...(analysis?.setting ? { place: analysis.setting } : {}),
      ...(typeof analysis?.emotionScore === "number" ? { energy: analysis.emotionScore } : {}),
      ...(typeof analysis?.keyMomentScore === "number" ? { highlightScore: analysis.keyMomentScore } : {}),
      ...(role ? { storyRole: role } : {}),
      ...(energy.length ? { energy: Math.max(...energy) } : {}),
      context: [moment.title, moment.description, ...candidatesForMoment.map(({ description }) => description)].filter(Boolean).join(" "),
    };
    const shotEvidence = (analysis?.shots ?? []).map((shot) => ({
      ...(shot.emotion ? { emotion: shot.emotion } : {}),
      ...(shot.storyRole ? { storyRole: shot.storyRole } : {}),
      ...(shot.description ? { context: shot.description } : {}),
      ...(typeof shot.emotionScore === "number" ? { energy: shot.emotionScore } : {}),
      ...(shot.highlights?.length ? { highlightScore: Math.max(...shot.highlights.map(({ score }) => score)) } : {}),
    }));
    return [base, ...shotEvidence];
  });
  const albumProfile = buildAlbumProfile({
    cadence: job.cadenceId,
    intent: [job.storyIntent, job.note].filter(Boolean).join(" "),
    occasion: [job.proposal.title, ...job.proposal.chapters.map(({ title }) => title)].join(" "),
    evidence: albumEvidence,
  });
  const allowedTracks = [...deps.soundtrackIds].flatMap((id) => {
    const track = musicLibrary.find((item) => item.id === id);
    return track ? [track] : [];
  });
  const explicitSoundtrack = job.soundtrackExplicit ?? job.soundtrackId !== null;
  const fallbackId = explicitSoundtrack
    ? job.soundtrackId
    : job.projectSoundtrackId ?? (job.soundtrackId && allowedTracks.some(({ id }) => id === job.soundtrackId)
      ? job.soundtrackId
      : recommendSoundtrack(allowedTracks, {
        projectId: job.projectId, intent: albumProfile.summary, cadence: job.cadenceId, profile: albumProfile,
        targetDurationSec: targetSec, recentTrackIds: job.recentSoundtrackIds,
      }));
  const recentForShortlist = (job.recentSoundtrackIds ?? []).filter((id) => id !== job.projectSoundtrackId);
  const musicShortlist: SoundtrackShortlistItem[] = soundtrackShortlist(allowedTracks, albumProfile, targetSec, recentForShortlist, fallbackId);
  const preserveProjectTrack = !explicitSoundtrack && !!job.projectSoundtrackId && allowedTracks.some(({ id }) => id === job.projectSoundtrackId);
  const { prompt, schema } = composeCall({
    candidates: primaryCandidates,
    proposal: job.proposal,
    brief,
    holds: holdsFor(job.cadenceId),
    note: job.note,
    targetSec,
    cast: job.cast?.summary,
    albumProfile,
    soundtrackShortlist: musicShortlist,
    soundtrackFallbackId: fallbackId,
  });

  // Call Gemini (mocked in tests)
  let rawResponse;
  try {
    rawResponse = await deps.generateStructured({
      model: MODELS.compose,
      contents: prompt,
      responseSchema: schema,
      validate: (value: unknown) => value,
      stage: "compose",
      subjectId: job.proposal.id,
    });
  } catch (error) {
    return { ok: false, reasons: [`gemini call failed: ${error instanceof Error ? error.message : String(error)}`] };
  }
  // Validate the model's response against our schema
  const parsed = validateComposeResponse(rawResponse);
  if (!parsed.ok) {
    return { ok: false, reasons: [`model response invalid: ${parsed.errors.join("; ")}`] };
  }
  const modelSoundtrack = selectModelSoundtrack(parsed.picks.soundtrackId, parsed.picks.soundtrackReason, musicShortlist, fallbackId);
  const soundtrackChoice = explicitSoundtrack
    ? { soundtrackId: job.soundtrackId, soundtrackReason: "Selected by you." }
    : preserveProjectTrack
      ? { soundtrackId: job.projectSoundtrackId!, soundtrackReason: "Kept this album's existing soundtrack for the remake." }
      : modelSoundtrack;
  const selectedSoundtrackId = soundtrackChoice.soundtrackId;

  // Stage 3: assemble — apply drop rules, build AssembledClip[]
  const candidateMap = new Map(candidates.map(c => [c.candidateId, c]));
  const { clips: assembledClips, dropped } = assemble(parsed.picks, candidateMap, holdsFor(job.cadenceId));
  // The model may choose the story order and emphasis, but it cannot omit usable media.
  // Append every remaining legal candidate in its deterministic catalog order.
  const pickedCandidates = new Set(assembledClips.map((clip) => clip.candidateId));
  const pickedVideoItems = new Set(assembledClips.filter((clip) => clip.kind === "video").map((clip) => clip.itemId));
  const excludedShotIds = new Set(job.proposal.constraints.excludedShotIds ?? []);
  const deselectedMomentIds = new Set(job.proposal.constraints.deselectedMomentIds ?? []);
  for (const candidate of primaryCandidates) {
    const shotId = shotIdByMoment.get(candidate.itemId);
    if (pickedCandidates.has(candidate.candidateId) || deselectedMomentIds.has(candidate.itemId)
      || hiddenShotIds.has(shotId ?? "") || excludedShotIds.has(shotId ?? "")) continue;
    if (candidate.kind === "video" && pickedVideoItems.has(candidate.itemId)) continue;
    assembledClips.push({
      ...candidate,
      order: assembledClips.length + 1,
      transition: styleRecipe.transitions.default,
      audio: candidate.kind === "photo" || !candidate.hasSpeech ? "mute" : "keep",
      ...(candidate.kind === "photo"
        ? { holdSec: holdsFor(job.cadenceId).base }
        : { sourceInSec: candidate.inSec, sourceOutSec: candidate.outSec, hasSpeech: candidate.hasSpeech }),
    });
    pickedCandidates.add(candidate.candidateId);
    if (candidate.kind === "video") pickedVideoItems.add(candidate.itemId);
  }

  if (isEmptyResult(dropped, parsed.picks.clips.length)) {
    return { ok: false, reasons: ["every pick was dropped — no film possible"] };
  }
  if (assembledClips.length === 0) {
    return { ok: false, reasons: ["composition selected no media — no film possible"] };
  }

  // Ingest's duplicate pass points every sibling at its sharpest-photo asset.
  // If the model still picks multiple siblings, retain that canonical photo
  // when present (otherwise one deterministic best available pick) and report
  // the overflow on the Generation instead of rewriting proposal leftOut.
  const duplicateGroups = new Map<string, AssembledClip[]>();
  for (const clip of assembledClips) {
    if (clip.kind !== "photo") continue;
    const asset = deps.assets.get(clip.itemId);
    const groupId = asset?.dupOf ?? asset?.assetId;
    if (!groupId) continue;
    const group = duplicateGroups.get(groupId) ?? [];
    group.push(clip);
    duplicateGroups.set(groupId, group);
  }
  const duplicateDropReasons: string[] = [];
  const duplicateClipIds = new Set<string>();
  for (const [primaryAssetId, siblings] of duplicateGroups) {
    if (siblings.length < 2) continue;
    const ranked = [...siblings].sort((a, b) => {
      const aPrimary = deps.assets.get(a.itemId)?.assetId === primaryAssetId ? 1 : 0;
      const bPrimary = deps.assets.get(b.itemId)?.assetId === primaryAssetId ? 1 : 0;
      return bPrimary - aPrimary || (deps.assets.get(b.itemId)?.keyMomentScore ?? 0) - (deps.assets.get(a.itemId)?.keyMomentScore ?? 0) || a.itemId.localeCompare(b.itemId);
    });
    for (const duplicate of ranked.slice(1)) {
      duplicateClipIds.add(duplicate.candidateId);
      duplicateDropReasons.push("Similar photo — best one kept");
    }
  }
  const uniqueAssembledClips = assembledClips.filter((clip) => !duplicateClipIds.has(clip.candidateId));
  const eligibleCandidates = candidates.filter((candidate) => !duplicateClipIds.has(candidate.candidateId));

  // Choose boundary locks from existing analysis only. Emotion is inferred
  // from key-moment/mood proxies already folded into keyMomentScore; no new AI input.
  const timeOf = job.timeOf ?? new Map<string, ClipTime>();
  const chapterOf = job.chapterOf ?? new Map<string, number>();
  const firstChapter = Math.min(...eligibleCandidates.map((candidate) => candidate.chapterIndex));
  const lastChapter = Math.max(...eligibleCandidates.map((candidate) => candidate.chapterIndex));
  const intentText = [job.note, job.proposal.title, ...job.proposal.chapters.map((chapter) => chapter.summary), ...job.proposal.moments.flatMap((moment) => [moment.title, moment.description])]
    .filter((value): value is string => typeof value === "string").join(" ").toLowerCase();
  const isUsableBoundary = (candidate: Candidate | undefined) => {
    if (!candidate) return false;
    const shotId = shotIdByMoment.get(candidate.itemId);
    return Boolean(shotId) && !hiddenShotIds.has(shotId!) && !excludedShotIds.has(shotId!) && !deselectedMomentIds.has(candidate.itemId);
  };
  const rankMoment = (candidate: Candidate) => {
    const asset = deps.assets.get(candidate.itemId);
    const storyPeople = job.cast?.peopleByMoment.get(candidate.itemId);
    const peopleRelevance = storyPeople && [...storyPeople].some((id) => job.cast?.core.includes(id) || job.cast?.focus.includes(id)) ? 1 : 0;
    const fallbackScore = Math.max(0, Math.min(1, (asset?.keyMomentScore ?? 0) / 5));
    return momentScore({ quality: candidate.quality ?? fallbackScore, emotion: candidate.emotion ?? fallbackScore,
      energy: candidate.energy ?? candidate.highlightScore ?? candidate.windowScore ?? fallbackScore, peopleRelevance,
      intentMatch: candidate.description.toLowerCase().split(/\W+/).filter((word) => word.length > 3 && intentText.includes(word)).length ? 1 : 0 });
  };
  const storyChoiceNotes: string[] = [];
  const sharp = (candidate: Candidate) => candidate.quality == null || (candidate.quality <= 1 ? candidate.quality >= 0.4 : candidate.quality >= 3);
  const modelChoice = (pick: { candidateId: string; reason: string } | undefined, name: string, valid: (candidate: Candidate) => boolean) => {
    const candidate = pick && eligibleCandidates.find((entry) => entry.candidateId === pick.candidateId || entry.itemId === pick.candidateId);
    if (candidate && valid(candidate)) { storyChoiceNotes.push(`Gemini ${name}: ${candidate.itemId} — ${pick.reason}`); return candidate; }
    if (pick) storyChoiceNotes.push(`Gemini ${name} rejected (${pick.candidateId}): ${pick.reason}; deterministic rule used`);
    return undefined;
  };
  const modelOpener = modelChoice(parsed.picks.openerId, "opener", (candidate) => candidate.chapterIndex === firstChapter && isUsableBoundary(candidate) && sharp(candidate));
  const proposedOpener = modelOpener ?? eligibleCandidates.find((candidate) => candidate.itemId === uniqueAssembledClips[0]?.itemId);
  const openerCandidate = modelOpener ?? (proposedOpener && proposedOpener.chapterIndex === firstChapter && isUsableBoundary(proposedOpener)
    ? proposedOpener
    : eligibleCandidates.filter((candidate) => candidate.chapterIndex === firstChapter && isUsableBoundary(candidate))
    .sort((a, b) => {
      const openerPriority = (candidate: Candidate) => (candidate.storyRole === "opener" ? 2 : 0) + (candidate.kind === "video" && (candidate.highlightScore ?? 0) >= DIRECTING_RULES.videoHighlightBoundaryMin
        || /wide|establish|landscape|panorama/i.test(candidate.description) ? 1 : 0);
      return openerPriority(b) - openerPriority(a) || rankMoment(b) - rankMoment(a) || a.itemId.localeCompare(b.itemId);
    })[0]);
  const proposedCloser = eligibleCandidates.find((candidate) => candidate.itemId === uniqueAssembledClips.at(-1)?.itemId);
  const closerPool = eligibleCandidates.filter((candidate) => candidate.chapterIndex === lastChapter && (candidate.itemId !== openerCandidate?.itemId || eligibleCandidates.length === 1) && isUsableBoundary(candidate));
  const modelCloser = modelChoice(parsed.picks.closerId, "closer", (candidate) => candidate.chapterIndex === lastChapter && closerPool.some((entry) => entry.candidateId === candidate.candidateId) && sharp(candidate));
  const closerCandidate = modelCloser ?? (proposedCloser && closerPool.some((candidate) => candidate.itemId === proposedCloser.itemId)
    ? proposedCloser
    : closerPool
    .sort((a, b) => Number(b.storyRole === "closer") - Number(a.storyRole === "closer") || rankMoment(b) - rankMoment(a)
      || String(timeOf.get(b.itemId)?.localTime ?? "").localeCompare(String(timeOf.get(a.itemId)?.localTime ?? ""))
      || a.itemId.localeCompare(b.itemId))[0]);
  const peakScore = (candidate: Candidate) => {
    const asset = deps.assets.get(candidate.itemId);
    const fallbackEmotion = Math.max(0, Math.min(1, (asset?.keyMomentScore ?? 0) / 5));
    const emotion = candidate.emotion ?? fallbackEmotion;
    const energy = candidate.energy ?? candidate.highlightScore ?? candidate.windowScore ?? fallbackEmotion;
    const intentMatch = candidate.description.toLowerCase().split(/\W+/).some((word) => word.length > 3 && intentText.includes(word)) ? 1 : 0;
    return { score: emotion + energy + intentMatch + (candidate.storyRole === "peak" ? 0.2 : 0), energy };
  };
  const scored = eligibleCandidates.map((candidate) => ({ candidate, ...peakScore(candidate) }));
  const median = [...scored].sort((a, b) => a.score - b.score)[Math.floor(scored.length / 2)]?.score ?? 0;
  const modelPeak = modelChoice(parsed.picks.peakId, "peak", (candidate) => candidate !== openerCandidate && candidate !== closerCandidate && peakScore(candidate).energy >= 0.5 && scored.some((entry) => entry.candidate.candidateId === candidate.candidateId && entry.score >= median + DIRECTING_RULES.peakMedianMargin));
  const peakCandidate = modelPeak ?? scored.filter(({ candidate, score, energy }) => candidate !== openerCandidate && candidate !== closerCandidate && energy >= 0.5 && score >= median + DIRECTING_RULES.peakMedianMargin)
    .sort((a, b) => b.score - a.score || a.candidate.itemId.localeCompare(b.candidate.itemId))[0]?.candidate;
  const lockedIds = new Set([openerCandidate?.itemId, peakCandidate?.itemId, closerCandidate?.itemId].filter((id): id is string => !!id));
  for (const candidate of [openerCandidate, peakCandidate, closerCandidate]) {
    if (!candidate || uniqueAssembledClips.some((clip) => clip.itemId === candidate.itemId)) continue;
    uniqueAssembledClips.push({ ...candidate, order: uniqueAssembledClips.length + 1, transition: styleRecipe.transitions.default, audio: "mute",
      ...(candidate.kind === "photo" ? { holdSec: holdsFor(job.cadenceId).base } : { sourceInSec: candidate.inSec, sourceOutSec: candidate.outSec, hasSpeech: candidate.hasSpeech }) });
  }

  const holds = holdsFor(job.cadenceId);
  const storyLockIds = new Set(lockedIds);
  const requiredMomentIds = new Set(job.proposal.constraints.mustIncludeMomentIds);
  const scoreByMoment = new Map(eligibleCandidates.map((candidate) => [candidate.itemId, rankMoment(candidate)]));
  const allowedCandidates = eligibleCandidates.filter((candidate) => {
    const shotId = shotIdByMoment.get(candidate.itemId);
    return Boolean(shotId) && !hiddenShotIds.has(shotId!) && !excludedShotIds.has(shotId!) && !deselectedMomentIds.has(candidate.itemId);
  });
  const budgetCandidates = allowedCandidates.filter((candidate) => !candidate.isExtraMoment);
  const usableMediaCount = new Set(budgetCandidates.map((candidate) => candidate.itemId)).size;
  const collageLimit = requestedCollageCount(usableMediaCount, job.collageAmount ?? "few");
  const initialAllocation = allocateBudget(budgetCandidates, scoreByMoment, targetSec, holds.base, new Set([...storyLockIds, ...requiredMomentIds]));
  const overflowGroups = overflowCollageGroups(
    initialAllocation.leftOut.filter((candidate) => !storyLockIds.has(candidate.itemId) && !requiredMomentIds.has(candidate.itemId)),
    deps.assets, chapterOf, collageLimit, usableMediaCount,
  );
  const collageOverflowIds = new Set(overflowGroups.flatMap((group) => group.map((candidate) => candidate.itemId)));
  const budgetAllocation = overflowGroups.length
    ? allocateBudget(budgetCandidates, scoreByMoment, Math.max(0, targetSec - overflowGroups.length * holds.base), holds.base, new Set([...storyLockIds, ...requiredMomentIds]))
    : initialAllocation;
  const selectedBudgetCandidates = [...budgetAllocation.selected, ...overflowGroups.flat()];
  const assembledByCandidateId = new Map(uniqueAssembledClips.map((clip) => [clip.candidateId, clip]));
  const durationCompleteClips: AssembledClip[] = selectedBudgetCandidates.map((candidate, index) => {
    const picked = assembledByCandidateId.get(candidate.candidateId);
    if (picked) return { ...picked, sourceOutSec: candidate.outSec ?? picked.sourceOutSec };
    return {
      ...candidate,
      order: index + 1,
      transition: styleRecipe.transitions.default,
      audio: candidate.kind === "photo" || !candidate.hasSpeech ? "mute" : "keep",
      ...(candidate.kind === "photo"
        ? { holdSec: holds.base }
        : { sourceInSec: candidate.inSec, sourceOutSec: candidate.outSec, hasSpeech: candidate.hasSpeech }),
    };
  });
  const selectedPhotoCount = durationCompleteClips.filter((clip) => clip.kind === "photo").length;
  const selectedVideoDuration = durationCompleteClips.filter((clip) => clip.kind === "video").reduce((sum, clip) => sum + (clip.lengthSec ?? 0), 0);
  const shortageStretch = selectedPhotoCount > 0
    && targetSec > selectedVideoDuration + selectedPhotoCount * holds.max
    && targetSec <= selectedVideoDuration + selectedPhotoCount * DIRECTING_RULES.singlePhotoMaxSec;
  const storyPhotoMax = shortageStretch ? DIRECTING_RULES.singlePhotoMaxSec : holds.max;
  const lengthLeftOut = budgetAllocation.leftOut.filter((candidate) => !collageOverflowIds.has(candidate.itemId)).map((candidate) => ({ shotId: shotIdByMoment.get(candidate.itemId)!, reason: "didn't fit the length" }));

  const videoShareDrops: string[] = [];

  // Stage 4: assemble → orderByChronology → applyArc → applyCastGuards
  // (coverage, focus, closing-in-last-chapter, opening-from-first-chapter)
  // → restore the arc after guard swaps, then re-pin only guard-selected
  // boundaries → fitDuration.
  const chronological = orderByChronology(durationCompleteClips, timeOf);
  for (const group of overflowGroups) {
    const ids = new Set(group.map((candidate) => candidate.itemId));
    const members = chronological.filter((clip) => ids.has(clip.itemId));
    if (members.length < 2) continue;
    const indices = chronological.flatMap((clip, index) => ids.has(clip.itemId) ? [index] : []);
    const start = Math.min(...indices), end = Math.max(...indices);
    if (chronological.slice(start, end + 1).some((clip) => storyLockIds.has(clip.itemId))) continue;
    const moved = chronological.filter((clip) => !ids.has(clip.itemId));
    moved.splice(Math.min(start, moved.length), 0, ...members);
    chronological.splice(0, chronological.length, ...moved);
  }
  const openerClip = chronological.find((clip) => clip.itemId === openerCandidate?.itemId);
  const closerClip = chronological.find((clip) => clip.itemId === closerCandidate?.itemId);
  let storyOrdered = openerClip ? [openerClip, ...chronological.filter((clip) => clip !== openerClip)] : chronological;
  if (closerClip && closerClip !== openerClip) storyOrdered = [...storyOrdered.filter((clip) => clip !== closerClip), closerClip];
  chronological.splice(0, chronological.length, ...storyOrdered);
  const peakIndex = peakCandidate ? chronological.findIndex((clip) => clip.itemId === peakCandidate.itemId) : -1;
  if (openerCandidate?.kind === "photo") {
    const opener = chronological.find((clip) => clip.itemId === openerCandidate.itemId);
    if (opener?.holdSec != null) opener.holdSec = storyPhotoMax;
  }
  if (peakCandidate?.kind === "photo") {
    const peak = chronological.find((clip) => clip.itemId === peakCandidate.itemId);
    if (peak?.holdSec != null) peak.holdSec = storyPhotoMax;
  }
  if (peakIndex >= 0) {
    chronological.forEach((clip, index) => {
      if (clip.kind !== "photo" || lockedIds.has(clip.itemId)) return;
      const progress = Math.min(1, index / Math.max(1, peakIndex));
      clip.holdSec = Number((holdsFor(job.cadenceId).base * (1 - styleRecipe.buildTightening * progress)).toFixed(2));
    });
  }
  if (closerCandidate?.kind === "photo") {
    const closerClip = chronological.find((clip) => clip.itemId === closerCandidate.itemId);
    if (closerClip?.holdSec != null) closerClip.holdSec = Math.min(DIRECTING_RULES.singlePhotoMaxSec, Number((storyPhotoMax * (1 + styleRecipe.closerHoldBoost)).toFixed(2)));
  }
  if (peakCandidate) {
    const peak = chronological.find((clip) => clip.itemId === peakCandidate.itemId);
    if (peak) peak.transition = styleRecipe.transitions.peak;
  }
  const arc = applyArc(chronological, timeOf);
  let selectedClips = arc.clips;
  let castReasons: string[] = arc.reasons;
  const guardPinned = new Set<string>();
  if (job.cast) {
    const lockedBaseline = selectedClips.filter((clip) => storyLockIds.has(clip.itemId));
    const pickedItems = new Set(durationCompleteClips.map((clip) => clip.itemId));
    const unused: AssembledClip[] = eligibleCandidates.filter((candidate) => candidate.kind === "photo" && !pickedItems.has(candidate.itemId)).map((candidate) => ({
      ...candidate, order: -1, transition: styleRecipe.transitions.default, audio: "mute", holdSec: holds.base,
    }));
    const guarded = applyCastGuards({
      clips: selectedClips, unused, core: job.cast.core, focus: job.cast.focus,
      peopleByMoment: job.cast.peopleByMoment,
      subjectsByMoment: job.cast.subjectsByMoment,
      chapterOf,
      label: (personId) => job.cast!.namesById[personId] ?? "a family member",
    });
    const guardedClips = guarded.clips;
    const opener = guarded.opened ? guardedClips[0] : undefined;
    const closer = guarded.closed ? guardedClips.at(-1) : undefined;
    if (opener) guardPinned.add(opener.itemId);
    if (closer) guardPinned.add(closer.itemId);
    // Keep the guarded boundary clips in the arc input so a pinned last
    // chapter still gives applyArc the chapter context needed for the earlier
    // chapter peaks; re-pin them after the arc is restored.
    const restoredArc = applyArc(orderByChronology(guardedClips, timeOf), timeOf).clips;
    selectedClips = restoredArc.filter((clip) => clip !== opener && clip !== closer);
    if (opener) selectedClips.unshift(opener);
    if (closer && closer !== opener) selectedClips.push(closer);
    for (const itemId of storyLockIds) guardPinned.add(itemId);
    for (const locked of lockedBaseline) {
      const currentIndex = selectedClips.findIndex((entry) => entry.itemId === locked.itemId);
      if (currentIndex >= 0) selectedClips[currentIndex] = locked;
      else selectedClips.push(locked);
    }
    selectedClips = orderByChronology(selectedClips, timeOf);
    const lockedOpener = selectedClips.find((clip) => clip.itemId === openerCandidate?.itemId);
    const lockedCloser = selectedClips.find((clip) => clip.itemId === closerCandidate?.itemId);
    if (lockedOpener) selectedClips = [lockedOpener, ...selectedClips.filter((clip) => clip !== lockedOpener)];
    if (lockedCloser && lockedCloser !== lockedOpener) selectedClips = [...selectedClips.filter((clip) => clip !== lockedCloser), lockedCloser];
    castReasons = [...arc.reasons, ...guarded.reasons];
  }

  // User ordering is final within each chapter, while guarded opener and
  // closer clips stay pinned at the boundaries they established.
  if (job.proposal.constraints.momentOrder?.length) {
    const pinned = guardPinned;
    const movable = selectedClips.filter((clip) => !pinned.has(clip.itemId));
    const ordered = applyUserOrder(movable, job.proposal.constraints.momentOrder, chapterOf);
    let cursor = 0;
    selectedClips = selectedClips.map((clip) => pinned.has(clip.itemId) ? clip : ordered[cursor++]!);
  }

  // Keep the selected story beats at their capture positions. Video sharing is
  // handled below without reordering this chronology.

  // Stage 5: fitDuration — adjust photo holds to target duration
  const fitHolds = job.durationId === "short" && !tierlessShort
    ? { ...holdsFor(job.cadenceId), min: Math.min(holdsFor(job.cadenceId).min, DIRECTING_RULES.shortTierMinSec), max: shortageStretch ? DIRECTING_RULES.singlePhotoMaxSec : Math.min(DIRECTING_RULES.singlePhotoMaxSec, holdsFor(job.cadenceId).base * DIRECTING_RULES.tierlessPhotoStretchMultiplier) }
    : job.durationId !== null
      ? { ...holdsFor(job.cadenceId), min: DIRECTING_RULES.shortTierMinSec, max: shortageStretch ? DIRECTING_RULES.singlePhotoMaxSec : Math.min(DIRECTING_RULES.singlePhotoMaxSec, holdsFor(job.cadenceId).base * DIRECTING_RULES.tierlessPhotoStretchMultiplier) }
      : { ...holdsFor(job.cadenceId), ...(shortageStretch ? { max: DIRECTING_RULES.singlePhotoMaxSec } : {}) };
  const { clips: initiallyFittedClips, notes: fitNotes, targetSec: fittedTargetSec } = fitDuration(
    selectedClips,
    targetSec,
    fitHolds,
    [...requiredMomentIds],
    { ...(job.durationId === null || tierlessShort ? { minimumFilmSec: DIRECTING_RULES.minimumFilmSec, maximumStretchedPhotoMultiplier: DIRECTING_RULES.tierlessPhotoStretchMultiplier } : {}), lockedMomentIds: [...storyLockIds] },
  );

  // Enforce the cap against actual fitted run time, including crossfade overlaps.
  let fittedClips = initiallyFittedClips;
  const videoSeconds = () => fittedClips.filter(c => c.kind === "video").reduce((sum, c) => sum + Math.max(0, (c.sourceOutSec ?? 0) - (c.sourceInSec ?? 0)), 0);
  const paceMinimum = ({ tender: 4, reflective: 4, playful: 2, energetic: 2, celebratory: 3 } as const)[job.cadenceId];
  const candidateById = new Map(candidates.map((candidate) => [candidate.candidateId, candidate]));
  const minimumPrimaryVideoSeconds = () => fittedClips.filter((clip) => clip.kind === "video" && !candidateById.get(clip.candidateId)?.isExtraMoment)
    .reduce((sum, clip) => {
      const current = Math.max(0, (clip.sourceOutSec ?? 0) - (clip.sourceInSec ?? 0));
      return sum + (storyLockIds.has(clip.itemId) || clip.hasSpeech ? current : Math.min(paceMinimum, current));
    }, 0);
  const coverageExceedsCap = () => minimumPrimaryVideoSeconds() > fittedFilmLength(fittedClips) * 0.5 + 1e-6;
  const trimmedFilmLength = () => fittedFilmLength(fittedClips) - fittedClips
    .filter((clip) => clip.kind === "video" && !clip.hasSpeech && !storyLockIds.has(clip.itemId) && !candidateById.get(clip.candidateId)?.isExtraMoment)
    .reduce((sum, clip) => sum + Math.max(0, (clip.sourceOutSec ?? 0) - (clip.sourceInSec ?? 0) - paceMinimum), 0);
  const minimumCoverageAfterTrimExceedsCap = () => minimumPrimaryVideoSeconds() > trimmedFilmLength() * 0.5 + 1e-6;
  if (videoSeconds() > fittedFilmLength(fittedClips) * 0.5 + 1e-6 && !minimumCoverageAfterTrimExceedsCap()) {
    fittedClips = fittedClips.map((clip) => {
      if (clip.kind !== "video" || clip.hasSpeech || storyLockIds.has(clip.itemId)) return clip;
      const inSec = clip.sourceInSec ?? 0;
      const currentLength = (clip.sourceOutSec ?? inSec) - inSec;
      const minimum = Math.min(currentLength, paceMinimum);
      return currentLength > minimum ? { ...clip, sourceOutSec: inSec + minimum } : clip;
    });
  }
  // If even one minimum-length primary clip per usable source exceeds half
  // the film, coverage takes priority. Extras never qualify for this exception.
  const usablePrimarySources = new Set(primaryCandidates.filter((candidate) => candidate.kind === "video")
    .map((candidate) => deps.assets.get(candidate.itemId)?.assetId ?? candidate.itemId));
  const representedPrimarySources = new Set(fittedClips.filter((clip) => clip.kind === "video" && !candidateById.get(clip.candidateId)?.isExtraMoment)
    .map((clip) => deps.assets.get(clip.itemId)?.assetId ?? clip.itemId));
  const coverageOverageRequired = usablePrimarySources.size > 0 && [...usablePrimarySources].every((source) => representedPrimarySources.has(source)) && coverageExceedsCap();
  if (coverageOverageRequired) videoShareDrops.push("video share cap exceeded to preserve complete speech and primary source coverage");
  // Optional multi-moment clips are the first to go under cap pressure.
  if (videoSeconds() > fittedFilmLength(fittedClips) * 0.5 + 1e-6) {
    fittedClips = fittedClips.filter((clip) => {
      const drop = clip.kind === "video" && !storyLockIds.has(clip.itemId) && candidateById.get(clip.candidateId)?.isExtraMoment;
      if (drop) videoShareDrops.push(`${clip.itemId}: optional extra dropped to preserve complete speech`);
      return !drop;
    });
  }
  if (coverageOverageRequired) fittedClips = fittedClips.filter((clip) => clip.kind !== "video" || !candidateById.get(clip.candidateId)?.isExtraMoment);
  while (fittedClips.some(c => c.kind === "video") && videoSeconds() > fittedFilmLength(fittedClips) * 0.5 + 1e-6) {
    if (coverageOverageRequired) break;
    // Silent picture can be removed; complete speech is never shortened or
    // discarded solely to satisfy a soft share cap.
    const removable = fittedClips.filter(c => c.kind === "video" && !storyLockIds.has(c.itemId) && !c.hasSpeech && candidateById.get(c.candidateId)?.isExtraMoment);
    if (!removable.length) {
      const overage = videoSeconds() - fittedFilmLength(fittedClips) * 0.5;
      videoShareDrops.push(`video share cap exceeded by ${overage.toFixed(2)}s to preserve complete speech`);
      break;
    }
    const loser = removable.sort((a, b) => (a.windowScore ?? 0) - (b.windowScore ?? 0) || a.candidateId.localeCompare(b.candidateId))[0]!;
    fittedClips = fittedClips.filter(c => c !== loser);
    videoShareDrops.push(`${loser.itemId}: video share limit`);
  }

  if (fittedClips.length === 0) {
    return { ok: false, reasons: ["no clips after duration fitting"] };
  }
  if (job.durationId !== null && !tierlessShort) {
    for (const candidate of candidates) if (candidate.kind === "photo") {
      candidate.minHoldSec = DIRECTING_RULES.shortTierMinSec;
      candidate.maxHoldSec = Math.min(DIRECTING_RULES.singlePhotoMaxSec, holdsFor(job.cadenceId).base * DIRECTING_RULES.tierlessPhotoStretchMultiplier);
    }
  }
  if (job.durationId === null || tierlessShort) {
    // The no-tier stretch is a documented exception to cadence's normal
    // maximum and must be visible to reflow and the semantic validator.
    for (const candidate of candidates) if (candidate.kind === "photo") candidate.maxHoldSec = holdsFor(job.cadenceId).base * DIRECTING_RULES.tierlessPhotoStretchMultiplier;
  }
  if (job.durationId === "short" && !tierlessShort) {
    // Adaptive Short is an explicit tier choice and may compress cadence down
    // to the 1.2-second base when the requested target needs it.
    for (const candidate of candidates) {
      if (candidate.kind === "photo") candidate.minHoldSec = Math.min(candidate.minHoldSec ?? DIRECTING_RULES.shortTierMinSec, DIRECTING_RULES.shortTierMinSec);
    }
  }

  // Keep a crossfade outside speech: an overlap at either edge can hide the
  // picture while the sentence is still being delivered.
  fittedClips = fittedClips.map((clip, index, all) => {
    const touchesSpeech = clip.kind === "video" && clip.hasSpeech
      || all[index - 1]?.kind === "video" && all[index - 1]?.hasSpeech;
    if (clip.kind === "video" && clip.hasSpeech && clip.transition === "crossfade"
      || touchesSpeech && clip.transition === "crossfade") {
      return { ...clip, transition: "cut" };
    }
    return clip;
  });

  // Every clip must name a shot the renderer can resolve to a file. A moment id
  // is not one, so a moment with no shot is a failure here rather than a film
  // whose picture silently does not load.
  const unresolved = fittedClips.filter((clip) => !shotIdByMoment.has(clip.itemId));
  if (unresolved.length > 0) {
    return {
      ok: false,
      reasons: [`no shot for moment ${[...new Set(unresolved.map((clip) => clip.itemId))].join(", ")}`],
    };
  }

  const soundtrack = selectedSoundtrackId ? musicLibrary.find((track) => track.id === selectedSoundtrackId) : undefined;
  const musicAnalysis: CutMusic | undefined = soundtrack?.analysis ?? (soundtrack ? { hasPulse: soundtrack.beatsSec.length >= 12, beatsSec: soundtrack.beatsSec, downbeatsSec: soundtrack.beatsSec.filter((_, index) => index % 4 === 0) } : undefined);
  if (musicAnalysis) {
    const snapped = snapPhotoBoundaries(fittedClips.map((clip) => ({ kind: clip.kind, holdSec: clip.holdSec ?? 0, minHoldSec: clip.minHoldSec ?? fitHolds.min, maxHoldSec: clip.maxHoldSec ?? fitHolds.max, hasSpeech: clip.hasSpeech, locked: storyLockIds.has(clip.itemId), peak: clip.itemId === peakCandidate?.itemId, transitionOverlapSec: clip.transition === "crossfade" ? TRANSITION_SECONDS.crossfade : 0 })), musicAnalysis, styleRecipe.cutOn);
    fittedClips = fittedClips.map((clip, index) => clip.kind === "photo" ? { ...clip, holdSec: snapped[index]!.holdSec } : clip);
  }

  // Stage 5: reflow — compute startSec, quantize to 30fps, resolve overlaps
  const transitionFor = (kind: "cut" | "crossfade" | "dip") => ({ kind, durationSec: TRANSITION_SECONDS[kind] });

  const clipPlans: ClipPlan[] = fittedClips.map((clip, index) => ({
    id: `clip-${index + 1}`,
    source: { shotId: shotIdByMoment.get(clip.itemId) },
    momentId: clip.itemId,
    durationSec: clip.holdSec ?? (clip.sourceOutSec! - (clip.sourceInSec ?? 0)),
    transitionIn: transitionFor(clip.transition),
    strength: 0, // deferred: fitDuration does not yet rank by strength (I7)
    minHoldSec: storyLockIds.has(clip.itemId) ? (clip.holdSec ?? (clip.sourceOutSec! - (clip.sourceInSec ?? 0))) : candidateMap.get(clip.candidateId)?.minHoldSec ?? clip.minHoldSec ?? 0,
    maxHoldSec: storyLockIds.has(clip.itemId) ? (clip.holdSec ?? (clip.sourceOutSec! - (clip.sourceInSec ?? 0))) : candidateMap.get(clip.candidateId)?.maxHoldSec ?? clip.maxHoldSec ?? Infinity,
  }));

  const reflowChapters = job.proposal.chapters.map((ch) => ({
    id: ch.id,
    title: ch.title,
    summary: ch.summary,
    momentIds: ch.momentIds,
  }));

  const result = reflow({
    fps: 30,
    plans: clipPlans,
    chapters: reflowChapters,
  });

  // Where each clip actually sits once reflow has had its say.
  const pictureByCandidate = new Map(
    result.clips.map((clip, index) => [fittedClips[index].candidateId, { startSec: clip.startSec, durationSec: clip.durationSec }]),
  );

  // Stage 6: buildAudioClips — speech/ambient/music tracks
  const audioPlanClips = buildAudioClips(fittedClips, selectedSoundtrackId, result.durationSec);

  // Stage 7: Assemble the Timeline and validate
  const timeline: Timeline = {
    schemaVersion: 1,
    styleId: styleRecipe.id,
    projectId: job.projectId,
    mode: job.mode,
    aspect: job.aspect,
    fps: 30,
    durationSec: result.durationSec,
    chapters: result.chapters.map(ch => ({ title: ch.title, startSec: ch.startSec })),
    videoClips: result.clips.map((reflowClip, index) => {
      const fitted = fittedClips[index];
      const shotId = shotIdByMoment.get(fitted.itemId)!;
      if (fitted.kind === "video") {
        return {
          id: fitted.candidateId,
          source: { kind: "video" as const, shotId, sourceInSec: fitted.sourceInSec ?? 0, sourceOutSec: fitted.sourceOutSec ?? fitted.sourceInSec! + reflowClip.durationSec },
          startSec: reflowClip.startSec,
          durationSec: reflowClip.durationSec,
          transitionIn: transitionFor(fitted.transition),
        };
      } else {
        const focus = job.focusCenter?.get(fitted.itemId);
        return {
          id: fitted.candidateId,
          source: { kind: "photo" as const, shotId },
          startSec: reflowClip.startSec,
          durationSec: reflowClip.durationSec,
          transitionIn: transitionFor(fitted.transition),
          ...(styleRecipe.photoMotion === "gentle-kenburns" ? { motion: { kind: "slow-zoom" as const, from: 1.0, to: 1.15, ...(focus ? { center: focus } : {}) } } : {}),
        };
      }
    }),
    audioClips: audioPlanClips.map((ac, index) => {
      // `buildAudioClips` lays audio out by walking raw clip lengths. Reflow has
      // since quantized those lengths and pulled crossfaded clips back over
      // their predecessors, so a clip's own sound must be placed against the
      // final picture geometry or it drifts out of sync with the shot it
      // belongs to.
      const picture = pictureByCandidate.get(ac.sourceCandidateId);
      const startSec = picture?.startSec ?? ac.startSec;
      const durationSec = picture?.durationSec ?? (ac.endSec - ac.startSec);
      return {
        id: `audio-${index + 1}`,
        source: ac.kind === "music" && selectedSoundtrackId
          ? { kind: "soundtrack" as const, soundtrackId: selectedSoundtrackId, sourceInSec: ac.sourceInSec ?? 0, sourceOutSec: ac.sourceOutSec ?? result.durationSec }
          : (() => {
              const candidate = candidateMap.get(ac.sourceCandidateId);
              // The renderer resolves a source id to a file; a moment id is not
              // one, so audio names the same shot its picture does. The source
              // range is the clip's own range within that shot, not a read from
              // the head of the file.
              const shotId = candidate ? shotIdByMoment.get(candidate.itemId) ?? candidate.itemId : ac.sourceCandidateId;
              const sourceInSec = candidate?.inSec ?? 0;
              return { kind: "asset" as const, assetId: shotId, sourceInSec, sourceOutSec: sourceInSec + durationSec };
            })(),
        role: ac.kind as "speech" | "ambient" | "music",
        startSec,
        // The gain `buildAudioClips` computed, including the music duck under
        // speech. Hardcoding it from the role threw that away and left the
        // music sitting on top of every line of dialogue.
        gainDb: gainToDb(ac.gain),
        fadeInSec: ac.kind === "music" ? ac.fadeInSec ?? Math.min(1.0, result.durationSec * 0.05) : 0,
        fadeOutSec: ac.kind === "music" ? ac.fadeOutSec ?? fadeOutSec(result.durationSec) : 0,
      };
    }),
    // Text overlays the model chose, burned in when the user asked for captions.
    // Collecting them and emitting an empty array made DirectionSettings.captions
    // do nothing and Rule 6 unable to fire.
    captions: job.captions
      ? result.clips.flatMap((reflowClip, index) => {
          const text = fittedClips[index].textOverlay?.trim();
          if (!text || isAutomaticDayLabel(text)) return [];
          return [{ text, startSec: reflowClip.startSec, endSec: reflowClip.startSec + reflowClip.durationSec }];
        })
      : [],
  };

  // Replace short contiguous bursts and event runs with seeded, reviewed collages.
  const collageSources = new Map<string, CollageSource>();
  for (const clip of timeline.videoClips) {
    if (!("source" in clip)) continue;
    const candidate = candidateMap.get(clip.id);
    const asset = candidate && deps.assets.get(candidate.itemId);
    const chapter = candidate && job.proposal.chapters[candidate.chapterIndex];
    if (!asset || !chapter) continue;
    collageSources.set(clip.id, {
      assetId: asset.assetId ?? candidate.itemId,
      width: asset.width,
      height: asset.height,
      chapterId: chapter.id,
      eventId: asset.eventId,
      localTime: asset.localTime,
      dHash: asset.dHash,
      dupOf: asset.dupOf,
      hasSpeech: candidate.hasSpeech,
    });
  }
  let withCollages: Timeline;
  try {
    const usableMediaCount = new Set(candidates.map((candidate) => candidate.itemId)).size;
    withCollages = placeCollages(timeline, collageSources, `${job.projectId}:${job.generationId}`, deps.collageReview ?? loadCollageReview(), { collageAmount: job.collageAmount ?? "few", motionFeel: job.motionFeel ?? "calm", cadenceId: job.cadenceId, tierless: job.durationId === null || tierlessShort, lockedClipIds: fittedClips.filter((clip) => storyLockIds.has(clip.itemId)).map((clip) => clip.candidateId), ...(job.durationId !== null ? { stretchTargetSec: targetSec } : {}) }, usableMediaCount);
  } catch (error) {
    return { ok: false, reasons: [`collage placement failed: ${error instanceof Error ? error.message : String(error)}`] };
  }
  syncTimelineChapters(withCollages, candidateMap, job.proposal);
  // A collage can replace several fitted photo slots with one shorter clip.
  // Keep the collage only when the final film remains inside the chosen band;
  // the already fitted individual stills are the duration-safe fallback.
  if (fittedTargetSec > 0 && (withCollages.durationSec < fittedTargetSec * 0.9 || withCollages.durationSec > fittedTargetSec * 1.1)) {
    withCollages = timeline;
  }

  // Validate the assembled timeline
  const validationCtx: import("./validateTimeline.js").ValidationContext = {
    chapters: job.proposal.chapters.map((ch, i) => ({ index: i, itemIds: ch.momentIds })),
    shotIds: new Set(job.proposal.moments.map((moment) => moment.shotId)),
    candidates: candidateMap,
    soundtrackIds: deps.soundtrackIds,
    // Validate the actual final geometry against the fitted target. Using the
    // resulting duration here would make the ±10% check tautological.
    targetSec: fittedTargetSec,
    fps: 30,
    lockedClipIds: new Set(fittedClips.filter((clip) => storyLockIds.has(clip.itemId)).map((clip) => clip.candidateId)),
  };

  const droppedPicks = [...storyChoiceNotes, ...dropped.map((drop) => drop.reason), ...duplicateDropReasons, ...videoShareDrops, ...noWindowDrops];
  const transcriptByShot = new Map<string, import("./buildCandidates.js").TranscriptSegment[]>();
  for (const [itemId, asset] of deps.assets) {
    if (asset.kind === "video" && asset.analysis?.transcript) transcriptByShot.set(shotIdByMoment.get(itemId) ?? itemId, asset.analysis.transcript);
  }
  syncCollageDurations(withCollages);
  const speechIssues = findSpeechBoundaryViolations(withCollages, transcriptByShot).map(v => ({ path: `videoClips[${v.clipId}].source.${v.edge}`, message: `source ${v.edge} ${v.boundarySec}s splits transcript segment [${v.segment.startSec},${v.segment.endSec}]`, severity: "fixable" as const }));
  const issues = [...validateTimeline(withCollages, validationCtx), ...speechIssues];

  let final = withCollages;
  if (issues.length > 0) {
    // One repair pass, deterministic only. A second pass is a loop in disguise.
    let repaired = repairOnce(withCollages, issues, validationCtx);
    if (!repaired.ok) {
      return { ok: false, reasons: [`validation failed: ${repaired.reasons.join("; ")}`] };
    }

    repaired = { ok: true, timeline: repairSpeechBoundaries(repaired.timeline, transcriptByShot) };

    const secondIssues = [...validateTimeline(repaired.timeline, validationCtx), ...findSpeechBoundaryViolations(repaired.timeline, transcriptByShot).map(v => ({ path: `videoClips[${v.clipId}].source.${v.edge}`, message: `source ${v.edge} still splits transcript segment`, severity: "fixable" as const }))];
    if (secondIssues.length > 0) {
      return { ok: false, reasons: [`repair did not fix all issues: ${secondIssues.map(i => i.message).join("; ")}`] };
    }

    final = repaired.timeline;
  }

  const lockedMoments = timeline.videoClips
    .filter((clip) => (validationCtx.lockedClipIds ?? new Set<string>()).has("kind" in clip ? clip.clipId : clip.id))
    .map((clip) => ({ clipId: "kind" in clip ? clip.clipId : clip.id, startSec: clip.startSec, durationSec: clip.durationSec }));
  const reviewed = reviewTimeline(final, {
    candidates: candidateMap,
    assets: deps.assets,
    shotIdByMoment,
    targetSec: fittedTargetSec,
    recipe: styleRecipe,
    transcriptByShot,
    lockedMoments,
    ...(musicAnalysis ? { music: musicAnalysis } : {}),
  });
  final = reviewed.timeline;
  syncTimelineChapters(final, candidateMap, job.proposal);
  const finalIssues = [...validateTimeline(final, { ...validationCtx, targetSec: final.durationSec }), ...findSpeechBoundaryViolations(final, transcriptByShot).map(v => ({ path: `videoClips[${v.clipId}].source.${v.edge}`, message: `source ${v.edge} still splits transcript segment`, severity: "fixable" as const }))];
  if (finalIssues.length > 0) {
    return { ok: false, reasons: [`final review failed validation: ${finalIssues.map(issue => issue.message).join("; ")}`] };
  }

  // Structural parse is the last gate on both paths. A repair that drops a clip
  // can leave the timeline structurally invalid, so it is not exempt from this.
  syncCollageDurations(final);
  final = refitSoundtrackToDuration(final, new Map(musicLibrary.map((track) => [track.id, track.analysis?.durationSec ?? track.durationSec])));
  const parsedResult = safeParseTimeline(final);
  if (!parsedResult.ok) {
    return { ok: false, reasons: [`structural validation failed: ${parsedResult.errors.join("; ")} AUDIO=${JSON.stringify(final.audioClips.map((clip) => ({ id: clip.id, role: clip.role, startSec: clip.startSec, source: clip.source })))}`] };
  }

  return {
    ok: true,
    timeline: parsedResult.timeline,
    styleId: styleRecipe.id,
    droppedPicks,
    notes: fitNotes,
    reviewNotes: reviewed.reviewNotes,
    reasons: castReasons,
    usedSoundtrackId: selectedSoundtrackId,
    soundtrackReason: soundtrackChoice.soundtrackReason,
    leftOut: [...lengthLeftOut, ...reviewed.leftOut],
    ...(job.durationId === null && parsedResult.timeline.durationSec < 20
      ? { durationSelection: { id: "short" as const, durationSec: parsedResult.timeline.durationSec } }
      : {}),
  };
}
