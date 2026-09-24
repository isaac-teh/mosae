import { reflow, type ClipPlan } from "@mosae/contracts";
import { DURATION_SECONDS } from "@mosae/contracts";
import { buildCandidates } from "./buildCandidates.js";
import { composeCall, validateComposeResponse } from "./composeCall.js";
import { assemble, isEmptyResult } from "./assemble.js";
import { fitDuration } from "./fitDuration.js";
import { craftBrief, holdsFor } from "./brief.js";
import { buildAudioClips } from "./audio.js";
import { validateTimeline, repairOnce } from "./validateTimeline.js";
import type { Timeline, StoryProposal, CadenceId } from "@mosae/contracts";
import type { Candidate, Asset } from "./buildCandidates.js";

/** Result of a compose run. */
export type ComposeResult = {
  ok: true;
  timeline: Timeline;
} | {
  ok: false;
  reasons: string[];
};

/** Dependencies needed by the compose pipeline. */
export interface ComposeDeps {
  /** Generate structured response from Gemini (mocked in tests). */
  generateStructured: (options: unknown, deps: unknown) => Promise<unknown>;
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
  });

  // Call Gemini (mocked in tests)
  let rawResponse;
  try {
    rawResponse = await deps.generateStructured(
      {
        model: "gemini-2.5-flash",
        contents: prompt,
        responseSchema: schema,
        validate: (value: unknown) => value,
        stage: "compose",
        subjectId: job.proposal.id,
      },
      {
        generateContent: async () => { throw new Error("generateStructured called without mock"); },
        recordUsage: async () => {},
      },
    );
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
  const { clips: fittedClips, notes: fitNotes } = fitDuration(
    assembledClips,
    targetSec,
    holdsFor(job.cadenceId),
    job.proposal.constraints.mustIncludeMomentIds,
  );

  if (fittedClips.length === 0) {
    return { ok: false, reasons: ["no clips after duration fitting"] };
  }

  // Stage 5: reflow — compute startSec, quantize to 30fps, resolve overlaps
  const clipPlans: ClipPlan[] = fittedClips.map((clip, index) => ({
    id: `clip-${index + 1}`,
    source: { shotId: clip.itemId },
    durationSec: clip.holdSec ?? (clip.sourceOutSec! - (clip.sourceInSec ?? 0)),
    transitionIn: { kind: clip.transition, durationSec: clip.transition === "crossfade" ? 0.5 : clip.transition === "dip" ? 0.3 : 0 },
    strength: 0, // not available on AssembledClip; use 0 as default
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
      if (fitted.kind === "video") {
        return {
          id: fitted.candidateId,
          source: { kind: "video" as const, shotId: fitted.candidateId, sourceInSec: fitted.sourceInSec ?? 0, sourceOutSec: fitted.sourceOutSec ?? fitted.sourceInSec! + reflowClip.durationSec },
          startSec: reflowClip.startSec,
          durationSec: reflowClip.durationSec,
          transitionIn: { kind: fitted.transition as "cut" | "crossfade" | "dip", durationSec: fitted.transition === "crossfade" ? 0.5 : fitted.transition === "dip" ? 0.3 : 0 },
        };
      } else {
        return {
          id: fitted.candidateId,
          source: { kind: "photo" as const, shotId: fitted.candidateId },
          startSec: reflowClip.startSec,
          durationSec: reflowClip.durationSec,
          transitionIn: { kind: fitted.transition as "cut" | "crossfade" | "dip", durationSec: fitted.transition === "crossfade" ? 0.5 : fitted.transition === "dip" ? 0.3 : 0 },
        };
      }
    }),
    audioClips: audioPlanClips.map((ac, index) => ({
      id: `audio-${index + 1}`,
      source: ac.kind === "music" && job.soundtrackId
        ? { kind: "soundtrack" as const, soundtrackId: job.soundtrackId, sourceInSec: 0, sourceOutSec: result.durationSec }
        : (() => {
            const candidate = candidateMap.get(ac.sourceCandidateId);
            return { kind: "asset" as const, assetId: candidate?.itemId ?? ac.sourceCandidateId, sourceInSec: 0, sourceOutSec: ac.endSec - ac.startSec };
          })(),
      role: ac.kind as "speech" | "ambient" | "music",
      startSec: ac.startSec,
      gainDb: ac.kind === "speech" ? 0 : ac.kind === "ambient" ? -7 : -6,
      fadeInSec: ac.kind === "music" ? Math.min(1.0, result.durationSec * 0.05) : 0,
      fadeOutSec: ac.kind === "music" ? Math.min(1.0, result.durationSec * 0.05) : 0,
    })),
    captions: [],
  };

  // Validate the assembled timeline
  const validationCtx: import("./validateTimeline.js").ValidationContext = {
    chapters: job.proposal.chapters.map((ch, i) => ({ index: i, itemIds: ch.momentIds })),
    assets: deps.assets as unknown as Map<string, { kind: "photo" | "video"; analysis?: { shots?: Array<{ id: string }> } }>,
    candidates: candidateMap,
    soundtrackIds: deps.soundtrackIds,
  };

  const issues = validateTimeline(timeline, validationCtx);

  if (issues.length > 0) {
    // Try one repair pass
    const repaired = repairOnce(timeline, issues, validationCtx);
    if (!repaired.ok) {
      return { ok: false, reasons: [`validation failed: ${repaired.reasons.join("; ")}`] };
    }

    // Validate the repaired timeline
    if (!repaired.ok) throw new Error("repair returned non-ok without setting ok:false");
    const secondIssues = validateTimeline(repaired.timeline, validationCtx);
    if (secondIssues.length > 0) {
      return { ok: false, reasons: [`repair did not fix all issues: ${secondIssues.map(i => i.message).join("; ")}`] };
    }

    return { ok: true, timeline: repaired.timeline };
  }

  // Check if structural parse passes
  const { safeParseTimeline } = await import("@mosae/contracts");
  const parsedResult = safeParseTimeline(timeline);
  if (!parsedResult.ok) {
    return { ok: false, reasons: [`structural validation failed: ${parsedResult.errors.join("; ")}`] };
  }

  return { ok: true, timeline };
}
