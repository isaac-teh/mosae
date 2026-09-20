import { z } from "zod";

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
  mustIncludeMomentIds: z.array(z.string().min(1)),
  feedback: z.array(z.string().min(1)),
});

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
