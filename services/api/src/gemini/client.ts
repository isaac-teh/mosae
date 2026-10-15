import { MODELS, PRICES } from "./pricing.js";

export { MODELS };

export type UsageRecord = {
  stage: string;
  model: string;
  subjectId?: string;
  promptTokens: number;
  candidatesTokens: number;
  thoughtsTokens: number;
  totalTokens: number;
  latencyMs: number;
  estimatedUsd: number;
  attempt: number;
  error?: string;
};

export type GenerateOptions<T> = {
  model: string;
  contents: unknown;
  responseSchema: unknown;
  validate: (value: unknown) => T;
  stage: string;
  subjectId?: string;
  thinking?: "MINIMAL" | "LOW";
  signal?: AbortSignal;
  maxSchemaRepairs?: number;
};

export type GenerateDeps = {
  generateContent: (request: unknown) => Promise<unknown>;
  recordUsage: (usage: UsageRecord) => void | Promise<void>;
  sleep?: (ms: number) => Promise<void>;
};

const MAX_ATTEMPTS = 6;
const MAX_REPAIRS = 1;
const RETRYABLE = /\b(429|5\d\d)\b|RESOURCE_EXHAUSTED|UNAVAILABLE|INTERNAL|DEADLINE_EXCEEDED/i;

/**
 * A quota or outage is worth waiting out; a malformed request never becomes
 * valid by asking again, and retrying it only burns the budget.
 */
export function isRetryable(error: unknown): boolean {
  const status = (error as { status?: number } | null)?.status;
  if (typeof status === "number") return status === 429 || status >= 500;
  return RETRYABLE.test(String((error as Error | null)?.message ?? error));
}

export function estimateUsd(
  model: string,
  tokens: { promptTokens: number; candidatesTokens: number; thoughtsTokens: number },
): number {
  const price = PRICES[model];
  if (!price) return 0;
  return (tokens.promptTokens * price.input + (tokens.candidatesTokens + tokens.thoughtsTokens) * price.output) / 1_000_000;
}

function usageFrom(response: unknown): { promptTokens: number; candidatesTokens: number; thoughtsTokens: number; totalTokens: number } {
  const meta = (response as { usageMetadata?: Record<string, number> } | null)?.usageMetadata ?? {};
  const promptTokens = meta.promptTokenCount ?? 0;
  const candidatesTokens = meta.candidatesTokenCount ?? 0;
  const thoughtsTokens = meta.thoughtsTokenCount ?? 0;
  return { promptTokens, candidatesTokens, thoughtsTokens, totalTokens: meta.totalTokenCount ?? promptTokens + candidatesTokens + thoughtsTokens };
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Two independent failure budgets. Transient service failures get MAX_ATTEMPTS
 * with backoff, because they clear on their own. A response that parses but does
 * not match the schema gets MAX_REPAIRS, because a model that cannot produce the
 * shape will not produce it on the sixth ask either.
 */
export async function generateStructured<T>(options: GenerateOptions<T>, deps: GenerateDeps): Promise<T> {
  const sleep = deps.sleep ?? defaultSleep;
  const maxSchemaRepairs = options.maxSchemaRepairs ?? MAX_REPAIRS;
  let repairs = 0;
  let diagnostics = "";
  let lastError: unknown;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const started = Date.now();
    let schemaFailure = false;
    const repair = `Your previous response did not match the required schema: ${diagnostics}. Return only JSON matching the schema.`;
    const contents = diagnostics
      ? Array.isArray(options.contents)
        ? [...options.contents, { text: repair }]
        : `${String(options.contents)}\n\n${repair}`
      : options.contents;

    try {
      const response = await deps.generateContent({
        model: options.model,
        contents,
        config: {
          responseMimeType: "application/json",
          responseJsonSchema: options.responseSchema,
          mediaResolution: "MEDIA_RESOLUTION_LOW",
          ...(options.thinking ? { thinkingConfig: { thinkingLevel: options.thinking } } : {}),
          ...(options.signal ? { abortSignal: options.signal } : {}),
        },
      });

      const tokens = usageFrom(response);
      const text = (response as { text?: string } | null)?.text;
      if (options.stage === "editor.interpret" && process.env.EDIT_INTERPRET_TRACE === "1") {
        console.info("EDIT_INTERPRET_TRACE_RAW_MODEL_TEXT", JSON.stringify(text));
      }

      try {
        if (typeof text !== "string" || text.length === 0) throw new Error("empty response text");
        const parsed = options.validate(JSON.parse(text));
        await deps.recordUsage({ stage: options.stage, model: options.model, subjectId: options.subjectId, ...tokens, latencyMs: Date.now() - started, estimatedUsd: estimateUsd(options.model, tokens), attempt });
        return parsed;
      } catch (invalid) {
        console.error(`[gemini:${options.stage}] RAW RESPONSE:\n${text}\n---\nVALIDATION ERROR:`, invalid);
        diagnostics = invalid instanceof Error ? invalid.message : String(invalid);
        lastError = new Error(`response failed schema validation: ${diagnostics}`);
        await deps.recordUsage({ stage: options.stage, model: options.model, subjectId: options.subjectId, ...tokens, latencyMs: Date.now() - started, estimatedUsd: estimateUsd(options.model, tokens), attempt, error: `schema: ${diagnostics}` });
        repairs += 1;
        if (repairs > maxSchemaRepairs) {
          schemaFailure = true;
          throw lastError;
        }
        continue;
      }
    } catch (error) {
      if (schemaFailure) throw error;
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      await deps.recordUsage({ stage: options.stage, model: options.model, subjectId: options.subjectId, promptTokens: 0, candidatesTokens: 0, thoughtsTokens: 0, totalTokens: 0, latencyMs: Date.now() - started, estimatedUsd: 0, attempt, error: message });
      if (!isRetryable(error) || attempt === MAX_ATTEMPTS) throw error;
      const baseMs = /\b5\d\d\b|UNAVAILABLE|INTERNAL/i.test(message) ? 10_000 : 1_000;
      await sleep(Math.min(120_000, baseMs * 2 ** (attempt - 1)));
    }
  }

  throw lastError ?? new Error("generateStructured exhausted its attempts");
}
