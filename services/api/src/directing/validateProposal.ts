import type { ProposalSubmission } from "./assemble.js";
import type { WorkingSet, WorkingShot } from "./workingSet.js";

export type ProposalValidationOptions = {
  targetSec: number;
  excludedShotIds?: string[];
  mustIncludeShotIds?: string[];
};

export type ProposalValidationResult =
  | { ok: true }
  | { ok: false; diagnostics: string[] };

type ValidationShot = WorkingShot & {
  sourceStartSec?: number | null;
  sourceEndSec?: number | null;
};

type RuleContext = {
  proposal: ProposalSubmission;
  shotsById: Map<string, ValidationShot>;
  options: ProposalValidationOptions;
};

type ValidationRule = (context: RuleContext) => string[];

function listed(values: Iterable<string>): string {
  return [...values].join(", ");
}

function selectedShotIds(proposal: ProposalSubmission): Set<string> {
  return new Set(proposal.moments.map((moment) => moment.shotId));
}

function chapterShotIds(proposal: ProposalSubmission): Set<string> {
  return new Set(proposal.chapters.flatMap((chapter) => chapter.momentIds));
}

function validateWorkingSetMembership({ proposal, shotsById }: RuleContext): string[] {
  const unknown = [...selectedShotIds(proposal)].filter((shotId) => !shotsById.has(shotId));
  if (unknown.length === 0) return [];
  return [`working_set_membership: shot ids ${listed(unknown)} are outside the working set; use only shot ids present in the working set.`];
}

function validateExcludedShots({ proposal, options }: RuleContext): string[] {
  const excluded = new Set(options.excludedShotIds ?? []);
  const offences = [...selectedShotIds(proposal)].filter((shotId) => excluded.has(shotId));
  if (offences.length === 0) return [];
  return [`excluded_shots: moments reference excluded shot ids ${listed(offences)}; remove those moments and their chapter references.`];
}

function validateMustIncludeShots({ proposal, options }: RuleContext): string[] {
  const selected = selectedShotIds(proposal);
  const missing = [...new Set(options.mustIncludeShotIds ?? [])].filter((shotId) => !selected.has(shotId));
  if (missing.length === 0) return [];
  return [`must_include_shots: required shot ids ${listed(missing)} are missing; add a moment for every named shot and place each in a chapter.`];
}

function validateChapterMinimumDistinct({ proposal }: RuleContext): string[] {
  return proposal.chapters.flatMap((chapter, index) => {
    const distinct = new Set(chapter.momentIds);
    if (distinct.size >= 2) return [];
    return [`chapter_minimum_distinct: chapter ${index + 1} (${chapter.title}) has only ${distinct.size} distinct moment (${listed(distinct) || "none"}); give it at least 2 distinct moments.`];
  });
}

function validateProposalMinimumDistinct({ proposal }: RuleContext): string[] {
  const distinct = chapterShotIds(proposal);
  const required = proposal.chapters.length + 2;
  if (distinct.size >= required) return [];
  return [`proposal_minimum_distinct: chapter selections ${listed(distinct) || "none"} provide ${distinct.size} distinct moments; use at least ${required} distinct moments across ${proposal.chapters.length} chapters.`];
}

function shotDurationSec(shot: ValidationShot): number {
  if (shot.sourceStartSec != null && shot.sourceEndSec != null) {
    return Math.max(0, shot.sourceEndSec - shot.sourceStartSec);
  }
  return Math.max(0, shot.durationSec ?? 0);
}

function validateDurationCoverage({ proposal, shotsById, options }: RuleContext): string[] {
  let equivalents = 0;
  const selected = chapterShotIds(proposal);
  const momentsByShotId = new Map(proposal.moments.map((moment) => [moment.shotId, moment]));
  for (const shotId of selected) {
    const moment = momentsByShotId.get(shotId);
    if (!moment) continue;
    equivalents += moment.kind === "photo" ? 1 : shotDurationSec(shotsById.get(shotId) ?? { id: shotId, analysis: null }) / 5;
  }

  const required = options.targetSec / 5;
  if (equivalents >= required) return [];
  return [`duration_coverage: selected moments provide ${equivalents} photo-equivalents from shot ids ${listed(selected) || "none"}, but need at least ${required} for a ${options.targetSec} seconds target; add photos or usable video duration.`];
}

function shotInterval(shot: ValidationShot): readonly [number, number] | null {
  if (shot.sourceStartSec != null && shot.sourceEndSec != null) {
    return [shot.sourceStartSec, shot.sourceEndSec];
  }
  if (shot.durationSec != null) return [0, shot.durationSec];
  return null;
}

function validateVideoPreviewBounds({ proposal, shotsById }: RuleContext): string[] {
  return proposal.moments.flatMap((moment) => {
    if (moment.kind !== "video") return [];
    const interval = shotsById.get(moment.shotId) ? shotInterval(shotsById.get(moment.shotId)!) : null;
    const previewIn = moment.previewInSec;
    const previewOut = moment.previewOutSec;
    if (interval
      && previewIn !== undefined
      && previewOut !== undefined
      && Number.isFinite(previewIn)
      && Number.isFinite(previewOut)
      && previewIn >= interval[0]
      && previewOut <= interval[1]
      && previewIn < previewOut) return [];

    const allowed = interval ? `${interval[0]}-${interval[1]}` : "the shot's available interval";
    return [`video_preview_bounds: shot ${moment.shotId} has preview ${String(previewIn)}-${String(previewOut)} outside its own interval ${allowed}; set previewInSec and previewOutSec inside that interval with previewInSec < previewOutSec.`];
  });
}

const RULES: ValidationRule[] = [
  validateWorkingSetMembership,
  validateExcludedShots,
  validateMustIncludeShots,
  validateChapterMinimumDistinct,
  validateProposalMinimumDistinct,
  validateDurationCoverage,
  validateVideoPreviewBounds,
];

export function validateProposal(
  proposal: ProposalSubmission,
  workingSet: WorkingSet,
  options: ProposalValidationOptions,
): ProposalValidationResult {
  const context: RuleContext = {
    proposal,
    shotsById: new Map(workingSet.shots.map((shot) => [shot.id, shot])),
    options,
  };
  const diagnostics = RULES.flatMap((rule) => rule(context));
  return diagnostics.length === 0 ? { ok: true } : { ok: false, diagnostics };
}
