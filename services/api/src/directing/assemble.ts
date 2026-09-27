import { StoryProposalSchema, type CadenceId, type ProposalConstraints, type StoryProposal } from "@mosae/contracts";

export type SubmittedMoment = {
  shotId: string;
  kind: "photo" | "video";
  title: string;
  description: string;
  rationale: string;
  previewInSec?: number;
  previewOutSec?: number;
};

export type ProposalSubmission = {
  title: string;
  moments: SubmittedMoment[];
  /** References are shot ids. The model does not mint application ids. */
  chapters: Array<{ title: string; summary: string; momentIds: string[] }>;
  openQuestions: string[];
  recommendedCadence?: CadenceId;
  cadenceReason?: string;
};

export type ProposalAssemblyContext = {
  proposalId: string;
  projectId: string;
  storyIntentId: string;
  version: number;
  parentProposalId: string | null;
  constraints: ProposalConstraints;
  /** Persisted parent moments used to translate carried constraint ids. */
  parentProposal?: Pick<StoryProposal, "moments"> | null;
};

function momentId(proposalId: string, index: number): string {
  return `${proposalId}-moment-${index}`;
}

function chapterId(proposalId: string, index: number): string {
  return `${proposalId}-chapter-${index}`;
}

/**
 * Turns the model's judgment-only submission into the persisted proposal.
 * Repeated shot references are one moment: records and ids belong to the
 * runner, not to the model.
 */
export function assembleProposal(body: ProposalSubmission, context: ProposalAssemblyContext): StoryProposal {
  const uniqueMoments: SubmittedMoment[] = [];
  const byShotId = new Map<string, number>();
  for (const moment of body.moments) {
    if (byShotId.has(moment.shotId)) continue;
    byShotId.set(moment.shotId, uniqueMoments.length);
    uniqueMoments.push(moment);
  }

  const moments = uniqueMoments.map((moment, index) => ({
    id: momentId(context.proposalId, index),
    shotId: moment.shotId,
    kind: moment.kind,
    title: moment.title,
    description: moment.description,
    rationale: moment.rationale,
    ...(moment.kind === "video"
      ? { previewInSec: moment.previewInSec, previewOutSec: moment.previewOutSec }
      : {}),
  }));

  const chapters = body.chapters.map((chapter, index) => ({
    id: chapterId(context.proposalId, index),
    title: chapter.title,
    summary: chapter.summary,
    momentIds: [...new Set(chapter.momentIds)].map((shotId) => {
      const momentIndex = byShotId.get(shotId);
      if (momentIndex === undefined) throw new Error(`chapter references unknown shot ${shotId}`);
      return momentId(context.proposalId, momentIndex);
    }),
  }));

  // Constraint inputs may arrive as catalog shot references on a first run;
  // persisted revisions already use minted moment ids. Accept both forms while
  // ensuring the contract only receives moment ids.
  const currentMomentIds = new Set(moments.map((moment) => moment.id));
  const parentShotByMomentId = new Map(
    (context.parentProposal?.moments ?? []).map((moment) => [moment.id, moment.shotId]),
  );
  const constraintMomentId = (reference: string): string | undefined => {
    const index = byShotId.get(reference);
    if (index !== undefined) return momentId(context.proposalId, index);
    if (currentMomentIds.has(reference)) return reference;
    const parentShotId = parentShotByMomentId.get(reference);
    if (parentShotId === undefined) return undefined;
    const currentIndex = byShotId.get(parentShotId);
    return currentIndex === undefined ? undefined : momentId(context.proposalId, currentIndex);
  };
  const constraints = {
    ...context.constraints,
    deselectedMomentIds: context.constraints.deselectedMomentIds.map(constraintMomentId).filter((id): id is string => id !== undefined),
    mustIncludeMomentIds: context.constraints.mustIncludeMomentIds.map(constraintMomentId).filter((id): id is string => id !== undefined),
  };

  const candidate = {
    schemaVersion: 1 as const,
    id: context.proposalId,
    projectId: context.projectId,
    storyIntentId: context.storyIntentId,
    parentProposalId: context.parentProposalId,
    state: "draft" as const,
    version: context.version,
    title: body.title,
    moments,
    chapters,
    constraints,
    openQuestions: body.openQuestions,
    ...(body.recommendedCadence !== undefined ? { recommendedCadence: body.recommendedCadence } : {}),
    ...(body.cadenceReason !== undefined ? { cadenceReason: body.cadenceReason } : {}),
  };
  const parsed = StoryProposalSchema.safeParse(candidate);
  if (!parsed.success) {
    throw new Error(`invalid assembled proposal: ${parsed.error.issues.map((issue) => issue.message).join("; ")}`);
  }
  return parsed.data;
}
