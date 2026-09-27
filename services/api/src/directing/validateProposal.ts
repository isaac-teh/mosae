import type { ProposalSubmission } from "./assemble.js";
import type { WorkingSet, WorkingShot } from "./workingSet.js";

export type ProposalValidationOptions = {
  excludedShotIds?: string[];
  mustIncludeShotIds?: string[];
};

export type ProposalValidationResult =
  | { ok: true }
  | { ok: false; diagnostics: string[] };

type RuleContext = {
  proposal: ProposalSubmission;
  shotsById: Map<string, WorkingShot>;
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

function referencedShotIds(proposal: ProposalSubmission): Set<string> {
  return new Set([...selectedShotIds(proposal), ...chapterShotIds(proposal)]);
}

function validateWorkingSetMembership({ proposal, shotsById }: RuleContext): string[] {
  const unknown = [...referencedShotIds(proposal)].filter((shotId) => !shotsById.has(shotId));
  if (unknown.length === 0) return [];
  return [`working_set_membership: shot ids ${listed(unknown)} are outside the working set; use only shot ids present in the working set.`];
}

function validateCatalogMediaKind({ proposal, shotsById }: RuleContext): string[] {
  return proposal.moments.flatMap((moment) => {
    const catalogKind = shotsById.get(moment.shotId)?.analysis?.kind;
    if (catalogKind === undefined || catalogKind === moment.kind) return [];
    const videoAction = catalogKind === "video" ? " and provide a legal preview range" : "";
    return [`catalog_media_kind: shot ${moment.shotId} is ${catalogKind} in the working set but the proposal says ${moment.kind}; set kind to ${catalogKind}${videoAction}.`];
  });
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

function shotInterval(shot: WorkingShot): readonly [number, number] | null {
  const start = shot.sourceStartSec;
  const end = shot.sourceEndSec;
  if (start == null || end == null) return null;
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start) return null;
  return [start, end];
}

function validateVideoPreviewBounds({ proposal, shotsById }: RuleContext): string[] {
  return proposal.moments.flatMap((moment) => {
    const shot = shotsById.get(moment.shotId);
    if (shot?.analysis?.kind !== "video") return [];
    const interval = shotInterval(shot);
    const previewIn = moment.kind === "video" ? moment.previewInSec : undefined;
    const previewOut = moment.kind === "video" ? moment.previewOutSec : undefined;
    if (interval
      && previewIn !== undefined
      && previewOut !== undefined
      && Number.isFinite(previewIn)
      && Number.isFinite(previewOut)
      && previewIn >= interval[0]
      && previewOut <= interval[1]
      && previewIn < previewOut) return [];

    if (!interval) {
      return [`video_preview_bounds: working-set video shot ${moment.shotId} has no legal source interval; choose a catalog video with finite sourceStartSec/sourceEndSec and set a preview inside it.`];
    }
    return [`video_preview_bounds: shot ${moment.shotId} has preview ${String(previewIn)}-${String(previewOut)} outside its own interval ${interval[0]}-${interval[1]}; set previewInSec and previewOutSec inside that interval with previewInSec < previewOutSec.`];
  });
}

const RULES: ValidationRule[] = [
  validateWorkingSetMembership,
  validateCatalogMediaKind,
  validateExcludedShots,
  validateMustIncludeShots,
  validateChapterMinimumDistinct,
  validateProposalMinimumDistinct,
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
