import { reflow, safeParseTimeline, type ClipPlan } from "@mosae/contracts";
import { DURATION_SECONDS } from "@mosae/contracts";
import { buildCandidates } from "./buildCandidates.js";
import { composeCall, validateComposeResponse } from "./composeCall.js";
import { assemble, isEmptyResult } from "./assemble.js";
import { fitDuration } from "./fitDuration.js";
import { craftBrief, holdsFor } from "./brief.js";
import { buildAudioClips, gainToDb } from "./audio.js";
import { TRANSITION_SECONDS } from "./transitions.js";
import { validateTimeline, repairOnce } from "./validateTimeline.js";
import type { Timeline, StoryProposal, CadenceId } from "@mosae/contracts";
import type { Candidate, Asset } from "./buildCandidates.js";

/** Result of a compose run. */
export type ComposeResult = {
  ok: true;
  timeline: Timeline;
  /** Picks the drop rules rejected. Not failures — kept on the generation for debugging. */
  droppedPicks: string[];
  /** What duration fitting had to do. Empty when the film landed on target. */
  notes: string[];
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
}

/** Input to runCompose — the job parameters and data needed for composition. */
export interface ComposeJob {
  proposal: StoryProposal;
  projectId: string;
  mode: "creator" | "memory";
  aspect: "16:9" | "9:16";
  durationId: keyof typeof DURATION_SECONDS;
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
  const targetSec = DURATION_SECONDS[job.durationId] ?? 60;

  // `buildCandidates` keys its catalog by moment id, because that is what the
  // proposal's chapters name. A Timeline names shots, so the two are joined
  // here rather than letting a moment id reach `source.shotId`, where
  // `resolveSources` would try to resolve it to a file and fail.
  const shotIdByMoment = new Map(job.proposal.moments.map((moment) => [moment.id, moment.shotId]));

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

  // Stage 2: composeCall — build the brief and prompt for Gemini
  const brief = craftBrief(job.cadenceId, targetSec);
  const { prompt, schema } = composeCall({
    candidates,
    proposal: job.proposal,
    brief,
    holds: holdsFor(job.cadenceId),
    note: job.note,
    targetSec,
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

  // Stage 4: fitDuration — adjust photo holds to target duration
  const { clips: fittedClips, notes: fitNotes, targetSec: fittedTargetSec } = fitDuration(
    assembledClips,
    targetSec,
    holdsFor(job.cadenceId),
    job.proposal.constraints.mustIncludeMomentIds,
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
        return {
          id: fitted.candidateId,
          source: { kind: "photo" as const, shotId },
          startSec: reflowClip.startSec,
          durationSec: reflowClip.durationSec,
          transitionIn: transitionFor(fitted.transition),
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
        fadeOutSec: ac.kind === "music" ? Math.min(1.0, result.durationSec * 0.05) : 0,
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

  const droppedPicks = dropped.map((drop) => drop.reason);
  const issues = validateTimeline(timeline, validationCtx);

  let final = timeline;
  if (issues.length > 0) {
    // One repair pass, deterministic only. A second pass is a loop in disguise.
    const repaired = repairOnce(timeline, issues, validationCtx);
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

  return { ok: true, timeline: parsedResult.timeline, droppedPicks, notes: fitNotes };
}
