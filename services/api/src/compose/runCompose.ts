import { reflow, safeParseTimeline, type ClipPlan } from "@mosae/contracts";
import { DURATION_SECONDS } from "@mosae/contracts";
import { buildCandidates } from "./buildCandidates.js";
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
import { fadeOutSec } from "./directingRules.js";

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

/** Result of a compose run. */
export type ComposeResult = {
  ok: true;
  timeline: Timeline;
  /** Picks the drop rules rejected. Not failures — kept on the generation for debugging. */
  droppedPicks: string[];
  /** What duration fitting had to do. Empty when the film landed on target. */
  notes: string[];
  reasons: string[];
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

function maximumClipDuration(clip: AssembledClip, maxHoldSec: number): number {
  if (clip.holdSec != null) return maxHoldSec;
  if (clip.sourceInSec != null && clip.sourceOutSec != null) return clip.sourceOutSec - clip.sourceInSec;
  return 0;
}

/** Add proposal media only when the model's edit cannot reach the requested duration. */
function completeDurationMaterial(
  selected: AssembledClip[],
  candidates: Candidate[],
  shotIdByMoment: Map<string, string>,
  hiddenShotIds: Set<string>,
  deselectedMomentIds: Set<string>,
  excludedShotIds: Set<string>,
  mustIncludeMomentIds: string[],
  targetSec: number,
  maxHoldSec: number,
  baseHoldSec: number,
): AssembledClip[] {
  const output = [...selected];
  const usedItems = new Set(output.map((clip) => clip.itemId));
  const usedShots = new Set(output.map((clip) => shotIdByMoment.get(clip.itemId)).filter((id): id is string => Boolean(id)));

  const projectedMaxSec = () => Math.max(0, output.reduce((sum, clip, index) =>
    sum + maximumClipDuration(clip, maxHoldSec) - (index ? overlapSec(clip.transition) : 0), 0));

  const available = candidates.filter((candidate) => {
    const shotId = shotIdByMoment.get(candidate.itemId);
    return Boolean(shotId) && !usedItems.has(candidate.itemId) && !deselectedMomentIds.has(candidate.itemId) && !hiddenShotIds.has(shotId!) && !excludedShotIds.has(shotId!);
  });
  const ordered = [
    ...available.filter((candidate) => mustIncludeMomentIds.includes(candidate.itemId)),
    ...available.filter((candidate) => !mustIncludeMomentIds.includes(candidate.itemId)),
  ];

  for (const candidate of ordered) {
    if (projectedMaxSec() >= targetSec * 0.9) break;
    if (usedItems.has(candidate.itemId)) continue;
    const shotId = shotIdByMoment.get(candidate.itemId)!;
    if (usedShots.has(shotId)) continue;
    usedItems.add(candidate.itemId);
    usedShots.add(shotId);
    const isPhoto = candidate.kind === "photo";
    output.push({
      ...candidate,
      order: output.length + 1,
      transition: "cut",
      audio: isPhoto || !candidate.hasSpeech ? "mute" : "keep",
      ...(isPhoto ? { holdSec: baseHoldSec } : { sourceInSec: candidate.inSec, sourceOutSec: candidate.outSec, hasSpeech: candidate.hasSpeech }),
    });
  }
  return output;
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
  );

  if (candidates.length === 0) {
    return { ok: false, reasons: ["no legal candidates — proposal has no media"] };
  }

  if (job.durationId === "short") {
    const hidden = new Set(job.proposal.constraints.hiddenShotIds ?? []);
    const excluded = new Set(job.proposal.constraints.excludedShotIds ?? []);
    const deselected = new Set(job.proposal.constraints.deselectedMomentIds ?? []);
    const capacityByMoment = new Map<string, number>();
    for (const candidate of candidates) {
      const shotId = shotIdByMoment.get(candidate.itemId);
      if (!shotId || hidden.has(shotId) || excluded.has(shotId) || deselected.has(candidate.itemId)) continue;
      const capacity = candidate.kind === "photo" ? holdsFor(job.cadenceId).max : candidate.lengthSec ?? 0;
      capacityByMoment.set(candidate.itemId, Math.max(capacityByMoment.get(candidate.itemId) ?? 0, capacity));
    }
    const materialCapacitySec = [...capacityByMoment.values()].reduce((total, seconds) => total + seconds, 0);
    // The cadence on the composition job is authoritative. Client estimates
    // can become stale when pace changes, so shorten the target to the capacity
    // calculated from the actual candidates and cadence used for this run.
    targetSec = Math.min(targetSec, materialCapacitySec);
    if (targetSec < 3) return { ok: false, reasons: ["short duration has less than three seconds of available material"] };
  }

  // Stage 2: composeCall — build the brief and prompt for Gemini
  const brief = craftBrief(job.cadenceId, targetSec);
  const { prompt, schema } = composeCall({
    candidates,
    proposal: job.proposal,
    brief,
    holds: holdsFor(job.cadenceId),
    note: job.note,
    targetSec,
    cast: job.cast?.summary,
  });

  // Call Gemini (mocked in tests)
  let rawResponse;
  try {
    rawResponse = await deps.generateStructured({
      model: "gemini-2.5-flash",
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

  // Stage 3: assemble — apply drop rules, build AssembledClip[]
  const candidateMap = new Map(candidates.map(c => [c.candidateId, c]));
  const { clips: assembledClips, dropped } = assemble(parsed.picks, candidateMap, holdsFor(job.cadenceId));

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

  const holds = holdsFor(job.cadenceId);
  const durationCompleteClips = completeDurationMaterial(
    uniqueAssembledClips,
    eligibleCandidates,
    shotIdByMoment,
    hiddenShotIds,
    new Set(job.proposal.constraints.deselectedMomentIds ?? []),
    new Set(job.proposal.constraints.excludedShotIds ?? []),
    job.proposal.constraints.mustIncludeMomentIds,
    targetSec,
    holds.max,
    holds.base,
  );

  // Stage 4: assemble → orderByChronology → applyArc → applyCastGuards
  // (coverage, focus, closing-in-last-chapter, opening-from-first-chapter)
  // → restore the arc after guard swaps, then re-pin only guard-selected
  // boundaries → fitDuration.
  const timeOf = job.timeOf ?? new Map<string, ClipTime>();
  const chapterOf = job.chapterOf ?? new Map<string, number>();
  const chronological = orderByChronology(durationCompleteClips, timeOf);
  const arc = applyArc(chronological, timeOf);
  let selectedClips = arc.clips;
  let castReasons: string[] = arc.reasons;
  const guardPinned = new Set<string>();
  if (job.cast) {
    const pickedItems = new Set(durationCompleteClips.map((clip) => clip.itemId));
    const unused: AssembledClip[] = eligibleCandidates.filter((candidate) => candidate.kind === "photo" && !pickedItems.has(candidate.itemId)).map((candidate) => ({
      ...candidate, order: -1, transition: "crossfade", audio: "mute", holdSec: holds.base,
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

  // Stage 5: fitDuration — adjust photo holds to target duration
  const { clips: fittedClips, notes: fitNotes, targetSec: fittedTargetSec } = fitDuration(
    selectedClips,
    targetSec,
    holdsFor(job.cadenceId),
    job.proposal.constraints.mustIncludeMomentIds,
    job.durationId === null ? { minimumFilmSec: 20, maximumStretchedPhotoSec: 4 } : {},
  );

  if (fittedClips.length === 0) {
    return { ok: false, reasons: ["no clips after duration fitting"] };
  }

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

  // Stage 5: reflow — compute startSec, quantize to 30fps, resolve overlaps
  const transitionFor = (kind: "cut" | "crossfade" | "dip") => ({ kind, durationSec: TRANSITION_SECONDS[kind] });

  const clipPlans: ClipPlan[] = fittedClips.map((clip, index) => ({
    id: `clip-${index + 1}`,
    source: { shotId: shotIdByMoment.get(clip.itemId) },
    momentId: clip.itemId,
    durationSec: clip.holdSec ?? (clip.sourceOutSec! - (clip.sourceInSec ?? 0)),
    transitionIn: transitionFor(clip.transition),
    strength: 0, // deferred: fitDuration does not yet rank by strength (I7)
    minHoldSec: clip.minHoldSec ?? 0,
    maxHoldSec: clip.maxHoldSec ?? Infinity,
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
  const audioPlanClips = buildAudioClips(fittedClips, job.soundtrackId, result.durationSec);

  // Stage 7: Assemble the Timeline and validate
  const timeline: Timeline = {
    schemaVersion: 1,
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
          ...(focus ? { motion: { kind: "slow-zoom" as const, from: 1.0, to: 1.15, center: focus } } : {}),
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
        source: ac.kind === "music" && job.soundtrackId
          ? { kind: "soundtrack" as const, soundtrackId: job.soundtrackId, sourceInSec: 0, sourceOutSec: result.durationSec }
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
        fadeInSec: ac.kind === "music" ? Math.min(1.0, result.durationSec * 0.05) : 0,
        fadeOutSec: ac.kind === "music" ? fadeOutSec(result.durationSec) : 0,
      };
    }),
    // Text overlays the model chose, burned in when the user asked for captions.
    // Collecting them and emitting an empty array made DirectionSettings.captions
    // do nothing and Rule 6 unable to fire.
    captions: job.captions
      ? result.clips.flatMap((reflowClip, index) => {
          const text = fittedClips[index].textOverlay?.trim();
          if (!text) return [];
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
    withCollages = placeCollages(timeline, collageSources, `${job.projectId}:${job.generationId}`, deps.collageReview ?? loadCollageReview(), { collageAmount: job.collageAmount ?? "few", motionFeel: job.motionFeel ?? "calm" }, usableMediaCount);
  } catch (error) {
    return { ok: false, reasons: [`collage placement failed: ${error instanceof Error ? error.message : String(error)}`] };
  }

  // Validate the assembled timeline
  const validationCtx: import("./validateTimeline.js").ValidationContext = {
    chapters: job.proposal.chapters.map((ch, i) => ({ index: i, itemIds: ch.momentIds })),
    shotIds: new Set(job.proposal.moments.map((moment) => moment.shotId)),
    candidates: candidateMap,
    soundtrackIds: deps.soundtrackIds,
    // The length the film is committed to after fitting — the requested target,
    // or the shortened one when the media could not reach it.
    targetSec: fittedTargetSec,
    fps: 30,
  };

  const droppedPicks = [...dropped.map((drop) => drop.reason), ...duplicateDropReasons];
  const issues = validateTimeline(withCollages, validationCtx);

  let final = withCollages;
  if (issues.length > 0) {
    // One repair pass, deterministic only. A second pass is a loop in disguise.
    const repaired = repairOnce(withCollages, issues, validationCtx);
    if (!repaired.ok) {
      return { ok: false, reasons: [`validation failed: ${repaired.reasons.join("; ")}`] };
    }

    const secondIssues = validateTimeline(repaired.timeline, validationCtx);
    if (secondIssues.length > 0) {
      return { ok: false, reasons: [`repair did not fix all issues: ${secondIssues.map(i => i.message).join("; ")}`] };
    }

    final = repaired.timeline;
  }

  // Structural parse is the last gate on both paths. A repair that drops a clip
  // can leave the timeline structurally invalid, so it is not exempt from this.
  const parsedResult = safeParseTimeline(final);
  if (!parsedResult.ok) {
    return { ok: false, reasons: [`structural validation failed: ${parsedResult.errors.join("; ")}`] };
  }

  return { ok: true, timeline: parsedResult.timeline, droppedPicks, notes: fitNotes, reasons: castReasons };
}
