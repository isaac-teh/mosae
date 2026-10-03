import { z } from "zod";
import { CADENCES, type CadenceId } from "./direction.js";

/**
 * The review contract. Moments are narrative selections with stable ids;
 * chapters group them. Neither is a frame-accurate edit instruction: that is
 * the Timeline's job, produced later from an accepted proposal.
 */

const seconds = z.number().finite().nonnegative();

const VideoMomentSchema = z.strictObject({
  id: z.string().min(1),
  shotId: z.string().min(1),
  kind: z.literal("video"),
  previewInSec: seconds,
  previewOutSec: z.number().finite().positive(),
  title: z.string().min(1),
  description: z.string(),
  rationale: z.string(),
});

const PhotoMomentSchema = z.strictObject({
  id: z.string().min(1),
  shotId: z.string().min(1),
  kind: z.literal("photo"),
  title: z.string().min(1),
  description: z.string(),
  rationale: z.string(),
});

export const MomentSchema = z.discriminatedUnion("kind", [VideoMomentSchema, PhotoMomentSchema]);

export const ProposalChapterSchema = z.strictObject({
  id: z.string().min(1),
  title: z.string().min(1),
  summary: z.string(),
  momentIds: z.array(z.string().min(1)).min(1),
});

export const ProposalConstraintsSchema = z.strictObject({
  excludedShotIds: z.array(z.string().min(1)),
  deselectedMomentIds: z.array(z.string().min(1)),
  mustIncludeMomentIds: z.array(z.string().min(1)),
  feedback: z.array(z.string().min(1)),
  /**
   * Person ids (from the picker) whose faces should be kept in the film. They
   * are resolved to shot ids at plan time and folded into `mustInclude` — see
   * `directing/workingSet.ts`. Optional so existing proposals validate, and not
   * referentially checked here: a focus id names a stored face characterId that
   * only exists in Firestore, so validation happens against the working set at
   * plan time rather than at proposal-parse time.
   */
  focusCharacterIds: z.array(z.string().min(1)).optional(),
  /** Person ids to prefer but never force; surfaced to the planner as a hint. */
  secondaryCharacterIds: z.array(z.string().min(1)).optional(),
  /** Shot ids hidden from the composed film. */
  hiddenShotIds: z.array(z.string().min(1)).optional(),
  /** Moment ids in the user's preferred within-chapter order. */
  momentOrder: z.array(z.string().min(1)).optional(),
  /** Moment id to replacement shot id. */
  photoSwaps: z.record(z.string().min(1), z.string().min(1)).optional(),
});

/** Optional editorial copy must never invalidate an otherwise usable plan. */
export function normalizeDirectionRecommendation(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length >= 1 && trimmed.length <= 300 ? trimmed : undefined;
}

export const DirectionRecommendationSchema = z.preprocess(
  normalizeDirectionRecommendation,
  z.string().min(1).max(300).optional(),
);

const BaseProposalSchema = z.strictObject({
  schemaVersion: z.literal(1),
  id: z.string().min(1),
  projectId: z.string().min(1),
  storyIntentId: z.string().min(1),
  parentProposalId: z.string().min(1).nullable(),
  state: z.enum(["draft", "accepted"]),
  version: z.number().int().positive(),
  title: z.string().min(1),
  moments: z.array(MomentSchema).min(1),
  chapters: z.array(ProposalChapterSchema).min(1),
  constraints: ProposalConstraintsSchema,
  openQuestions: z.array(z.string().min(1)),
  recommendedCadence: z.enum(CADENCES.map((c) => c.id) as [CadenceId, ...CadenceId[]]).optional(),
  cadenceReason: z.string().min(1).max(200).optional(),
  directionRecommendation: DirectionRecommendationSchema,
  leftOut: z.array(z.strictObject({ shotId: z.string().min(1), reason: z.string().min(1) })).optional(),
});

/**
 * Referential checks live here rather than in the caller, so every consumer of a
 * parsed proposal can rely on its chapters and must-includes naming real moments.
 */
export const StoryProposalSchema = BaseProposalSchema.superRefine((proposal, ctx) => {
  const ids = new Set<string>();
  proposal.moments.forEach((moment, index) => {
    if (ids.has(moment.id)) {
      ctx.addIssue({ code: "custom", path: ["moments", index, "id"], message: `duplicate moment id ${moment.id}` });
    }
    ids.add(moment.id);
  });
  proposal.chapters.forEach((chapter, chapterIndex) => {
    chapter.momentIds.forEach((momentId, momentIndex) => {
      if (!ids.has(momentId)) {
        ctx.addIssue({ code: "custom", path: ["chapters", chapterIndex, "momentIds", momentIndex], message: `unknown moment id ${momentId}` });
      }
    });
  });
  proposal.constraints.mustIncludeMomentIds.forEach((momentId, index) => {
    if (!ids.has(momentId)) {
      ctx.addIssue({ code: "custom", path: ["constraints", "mustIncludeMomentIds", index], message: `unknown moment id ${momentId}` });
    }
  });
  const mustIncludeIds = new Set(proposal.constraints.mustIncludeMomentIds);
  proposal.constraints.deselectedMomentIds.forEach((momentId, index) => {
    if (!ids.has(momentId)) {
      ctx.addIssue({ code: "custom", path: ["constraints", "deselectedMomentIds", index], message: `unknown moment id ${momentId}` });
    }
    if (mustIncludeIds.has(momentId)) {
      ctx.addIssue({ code: "custom", path: ["constraints", "deselectedMomentIds", index], message: `moment ${momentId} cannot be both deselected and must-include` });
    }
  });
});

export type Moment = z.infer<typeof MomentSchema>;
export type ProposalChapter = z.infer<typeof ProposalChapterSchema>;
export type ProposalConstraints = z.infer<typeof ProposalConstraintsSchema>;
export type StoryProposal = z.infer<typeof StoryProposalSchema>;

function describe(issue: { path: PropertyKey[]; message: string }): string {
  const path = issue.path.map(String).join(".");
  return path ? `${path}: ${issue.message}` : issue.message;
}

export function safeParseStoryProposal(
  value: unknown,
): { ok: true; proposal: StoryProposal } | { ok: false; errors: string[] } {
  const result = StoryProposalSchema.safeParse(value);
  if (result.success) return { ok: true, proposal: result.data };
  return { ok: false, errors: result.error.issues.map(describe) };
}
