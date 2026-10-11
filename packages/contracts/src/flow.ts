import { z } from "zod";

export const FlowPersonSchema = z.strictObject({
  personId: z.string().min(1),
  name: z.string().nullable(),
  role: z.string().nullable(),
  confirmed: z.boolean(),
  skipped: z.boolean(),
  manualShotAdds: z.array(z.string()),
  manualShotRemoves: z.array(z.string()),
  faceIds: z.array(z.string()),
  mergedInto: z.string().nullable(),
});

export const DirectorFlowSchema = z.strictObject({
  revision: z.number().int().nonnegative(),
  story: z.object({ answer: z.string().nullable(), storySummary: z.string().nullable(), mentionedPeople: z.array(z.string()) }),
  people: z.array(FlowPersonSchema),
});

export const FlowActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("story-answer"), answer: z.string().min(1).max(2000), storySummary: z.string().nullable().optional(), mentionedPeople: z.array(z.string()).optional() }),
  z.object({ type: z.literal("person"), personId: z.string().min(1), name: z.string().nullable().optional(), role: z.string().nullable().optional(), confirmed: z.boolean().optional(), skipped: z.boolean().optional() }),
  z.object({ type: z.literal("manual-shot"), personId: z.string().min(1), shotId: z.string().min(1), included: z.boolean() }),
  z.object({ type: z.literal("move-photo"), faceId: z.string().min(1), personId: z.string().nullable() }),
  z.object({ type: z.literal("merge"), personId: z.string().min(1), targetPersonId: z.string().min(1) }),
  z.object({ type: z.literal("undo") }),
]);

export const FlowMutationRequestSchema = z.strictObject({ actionId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/), action: FlowActionSchema });
export type DirectorFlow = z.infer<typeof DirectorFlowSchema>;
export type FlowAction = z.infer<typeof FlowActionSchema>;
