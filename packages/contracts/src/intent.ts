import { z } from "zod";

export const StoryIntentSchema = z.strictObject({
  schemaVersion: z.literal(1),
  id: z.string().min(1),
  projectId: z.string().min(1),
  version: z.number().int().positive(),
  text: z.string().min(1).max(2000),
  focus: z.array(z.string()),
});

export type StoryIntent = z.infer<typeof StoryIntentSchema>;

function describe(issue: { path: PropertyKey[]; message: string }): string {
  const path = issue.path.map(String).join(".");
  return path ? `${path}: ${issue.message}` : issue.message;
}

export function safeParseStoryIntent(
  value: unknown,
): { ok: true; intent: StoryIntent } | { ok: false; errors: string[] } {
  const result = StoryIntentSchema.safeParse(value);
  if (result.success) return { ok: true, intent: result.data };
  return { ok: false, errors: result.error.issues.map(describe) };
}
