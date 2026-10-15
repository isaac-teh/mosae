import { z } from "zod";

export const FlowPersonSchema = z.strictObject({
  personId: z.string().min(1),
  name: z.string().nullable(),
  role: z.string().nullable(),
  confirmed: z.boolean(),
  skipped: z.boolean(),
  answerText: z.string().optional(),
  manualShotAdds: z.array(z.string()),
  manualShotRemoves: z.array(z.string()),
  samplePhotoUris: z.array(z.string()).optional(),
  faceIds: z.array(z.string()),
  mergedInto: z.string().nullable(),
});

export const DirectorFlowSchema = z.strictObject({
  revision: z.number().int().nonnegative(),
  story: z.object({ answer: z.string().nullable(), storySummary: z.string().nullable(), mentionedPeople: z.array(z.string()) }),
  people: z.array(FlowPersonSchema),
  missedAnswer: z.string().optional(),
  peopleSummaryAnswer: z.string().optional(),
  peopleSummaryCount: z.number().int().nonnegative().optional(),
  missedReply: z.string().optional(),
  missedClarifications: z.array(z.object({ question: z.string(), reply: z.string(), stage: z.enum(["missed", "summary", "post-confirmation"]).optional() })).optional(),
  peopleSummaryHistory: z.array(z.array(z.object({ personId: z.string(), name: z.string(), momentCount: z.number().nonnegative(), sampleUri: z.string().optional() }))).optional(),
  peopleSummaryFollowups: z.array(z.object({ question: z.string(), reply: z.string().optional() })).optional(),
  peopleSummaryFollowupActive: z.boolean().optional(),
  peopleSummaryConfirmed: z.boolean().optional(),
  peopleProgress: z.object({ askedPersonIds: z.array(z.string().min(1)).max(100).optional(), completedPersonIds: z.array(z.string().min(1)) }).optional(),
  missedPeopleConfirmed: z.boolean().optional(),
  missedPeople: z.array(z.object({ personId: z.string().min(1), name: z.string().min(1), samplePhotoUris: z.array(z.string()).optional(), skipped: z.boolean().optional() })).optional(),
});

const AtomicFlowActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("story-answer"), answer: z.string().min(1).max(2000), storySummary: z.string().nullable().optional(), mentionedPeople: z.array(z.string()).optional() }),
  z.object({ type: z.literal("person"), personId: z.string().min(1), name: z.string().nullable().optional(), role: z.string().nullable().optional(), answerText: z.string().optional(), confirmed: z.boolean().optional(), skipped: z.boolean().optional() }),
  z.object({ type: z.literal("manual-shot"), personId: z.string().min(1), shotId: z.string().min(1), included: z.boolean() }),
  z.object({ type: z.literal("sample-photos"), personId: z.string().min(1), uris: z.array(z.string()).max(4) }),
  z.object({ type: z.literal("move-photo"), faceId: z.string().min(1), personId: z.string().nullable() }),
  z.object({ type: z.literal("merge"), personId: z.string().min(1), targetPersonId: z.string().min(1) }),
  z.object({ type: z.literal("people-summary-confirmed"), confirmed: z.boolean(), answer: z.string().optional(), peopleCount: z.number().int().nonnegative().optional() }),
  z.object({ type: z.literal("people-progress"), askedPersonIds: z.array(z.string().min(1)).max(100).optional(), completedPersonIds: z.array(z.string().min(1)).max(100) }),
  z.object({ type: z.literal("missed-people-confirmed"), confirmed: z.boolean(), answer: z.string().optional() }),
  z.object({ type: z.literal("missed-person-added"), personId: z.string().min(1), name: z.string().min(1), answer: z.string().optional(), reply: z.string().nullable().optional() }),
  z.object({ type: z.literal("missed-person-skipped"), personId: z.string().min(1) }),
  z.object({ type: z.literal("missed-people"), people: z.array(z.object({ personId: z.string().min(1), name: z.string().min(1), samplePhotoUris: z.array(z.string()).optional(), skipped: z.boolean().optional() })).max(100), answer: z.string().optional(), reply: z.string().nullable().optional() }),
  z.object({ type: z.literal("missed-person-completed"), personId: z.string().min(1) }),
  z.object({ type: z.literal("missed-clarification-turn"), question: z.string(), reply: z.string(), stage: z.enum(["missed", "summary", "post-confirmation"]).optional() }),
  z.object({ type: z.literal("people-summary-snapshot"), people: z.array(z.object({ personId: z.string(), name: z.string(), momentCount: z.number().nonnegative(), sampleUri: z.string().optional() })) }),
  z.object({ type: z.literal("people-summary-followup"), question: z.string(), reply: z.string().optional() }),
  z.object({ type: z.literal("undo") }),
]);

export const FlowActionSchema = z.discriminatedUnion("type", [
  ...AtomicFlowActionSchema.options,
  z.object({ type: z.literal("batch"), actions: z.array(AtomicFlowActionSchema).min(1).max(200).refine((actions) => actions.every((action) => action.type !== "undo"), "Undo cannot be included in a batch") }),
]);

export const FlowMutationRequestSchema = z.strictObject({ actionId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/), action: FlowActionSchema });
export type DirectorFlow = z.infer<typeof DirectorFlowSchema>;
export type FlowAction = z.infer<typeof AtomicFlowActionSchema> | { type: "batch"; actions: z.infer<typeof AtomicFlowActionSchema>[] };
