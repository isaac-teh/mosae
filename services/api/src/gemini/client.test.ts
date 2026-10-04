import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import { estimateUsd, generateStructured, isRetryable, type UsageRecord } from "./client.js";

const Schema = z.strictObject({ ok: z.boolean() });
const validate = (value: unknown) => Schema.parse(value);
const base = { model: "gemini-3.1-flash-lite", contents: "prompt", responseSchema: {}, validate, stage: "analyze" as const };

function reply(text: string, usage: Record<string, number> = {}) {
  return { text, usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 20, thoughtsTokenCount: 0, totalTokenCount: 120, ...usage } };
}

function deps(generateContent: ReturnType<typeof vi.fn>) {
  const usage: UsageRecord[] = [];
  return { deps: { generateContent, recordUsage: (record: UsageRecord) => { usage.push(record); }, sleep: async () => {} }, usage };
}

describe("generateStructured", () => {
  it("parses a valid structured response and records usage with a cost estimate", async () => {
    const call = vi.fn().mockResolvedValue(reply('{"ok":true}'));
    const { deps: d, usage } = deps(call);
    await expect(generateStructured(base, d)).resolves.toEqual({ ok: true });
    expect(usage).toHaveLength(1);
    expect(usage[0]).toMatchObject({ stage: "analyze", model: "gemini-3.1-flash-lite", promptTokens: 100, attempt: 1 });
    expect(usage[0].estimatedUsd).toBeCloseTo((100 * 0.25 + 20 * 1.5) / 1_000_000, 12);
  });

  it("requests JSON output with the caller's response schema", async () => {
    const call = vi.fn().mockResolvedValue(reply('{"ok":true}'));
    const { deps: d } = deps(call);
    await generateStructured({ ...base, responseSchema: { type: "object" } }, d);
    const request = call.mock.calls[0][0] as { config: Record<string, unknown> };
    expect(request.config).toMatchObject({ responseMimeType: "application/json", responseJsonSchema: { type: "object" } });
  });

  it("repairs a schema-invalid response exactly once, then succeeds", async () => {
    const call = vi.fn()
      .mockResolvedValueOnce(reply('{"ok":"yes"}'))
      .mockResolvedValueOnce(reply('{"ok":true}'));
    const { deps: d, usage } = deps(call);
    await expect(generateStructured(base, d)).resolves.toEqual({ ok: true });
    expect(call).toHaveBeenCalledTimes(2);
    expect(usage[0].error).toContain("schema");
  });

  it("can disable schema repair for a one-call interpreter", async () => {
    const call = vi.fn().mockResolvedValue(reply('{"ok":"yes"}'));
    const { deps: d } = deps(call);
    await expect(generateStructured({ ...base, maxSchemaRepairs: 0 }, d)).rejects.toThrow(/schema/i);
    expect(call).toHaveBeenCalledTimes(1);
  });

  it("keeps file data in an array prompt during schema repair", async () => {
    const call = vi.fn().mockResolvedValueOnce(reply('{"ok":"yes"}')).mockResolvedValueOnce(reply('{"ok":true}'));
    const { deps: d } = deps(call);
    const contents = [{ text: "describe" }, { fileData: { fileUri: "gs://video", mimeType: "video/mp4" } }];
    await generateStructured({ ...base, contents }, d);
    expect(call.mock.calls[1][0].contents).toEqual(expect.arrayContaining([{ fileData: { fileUri: "gs://video", mimeType: "video/mp4" } }]));
  });

  it("gives up after one repair rather than looping on a model that cannot comply", async () => {
    const call = vi.fn().mockResolvedValue(reply('{"ok":"yes"}'));
    const { deps: d } = deps(call);
    await expect(generateStructured(base, d)).rejects.toThrow(/schema/i);
    expect(call).toHaveBeenCalledTimes(2);
  });

  it("treats unparseable text as a schema failure rather than a crash", async () => {
    const call = vi.fn().mockResolvedValue(reply("not json"));
    const { deps: d } = deps(call);
    await expect(generateStructured(base, d)).rejects.toThrow(/schema|json/i);
    expect(call).toHaveBeenCalledTimes(2);
  });

  it("retries a rate limit with backoff and succeeds", async () => {
    const call = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error("429 RESOURCE_EXHAUSTED"), { status: 429 }))
      .mockResolvedValueOnce(reply('{"ok":true}'));
    const waits: number[] = [];
    const { deps: d } = deps(call);
    await expect(generateStructured(base, { ...d, sleep: async (ms: number) => { waits.push(ms); } })).resolves.toEqual({ ok: true });
    expect(call).toHaveBeenCalledTimes(2);
    expect(waits[0]).toBeGreaterThan(0);
  });

  it("does not retry a non-retryable request error", async () => {
    const call = vi.fn().mockRejectedValue(Object.assign(new Error("400 INVALID_ARGUMENT"), { status: 400 }));
    const { deps: d, usage } = deps(call);
    await expect(generateStructured(base, d)).rejects.toThrow(/400/);
    expect(call).toHaveBeenCalledTimes(1);
    expect(usage[0].error).toContain("400");
  });

  it("stops retrying transient failures at the attempt ceiling", async () => {
    const call = vi.fn().mockRejectedValue(Object.assign(new Error("503 UNAVAILABLE"), { status: 503 }));
    const { deps: d } = deps(call);
    await expect(generateStructured(base, d)).rejects.toThrow(/503/);
    expect(call).toHaveBeenCalledTimes(6);
  });

  it("records a usage line for every attempt, including failures", async () => {
    const call = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error("503 UNAVAILABLE"), { status: 503 }))
      .mockResolvedValueOnce(reply('{"ok":true}'));
    const { deps: d, usage } = deps(call);
    await generateStructured(base, d);
    expect(usage).toHaveLength(2);
    expect(usage.map((record) => record.attempt)).toEqual([1, 2]);
  });
});

describe("isRetryable", () => {
  it("retries rate limits and server errors only", () => {
    expect(isRetryable(Object.assign(new Error("429"), { status: 429 }))).toBe(true);
    expect(isRetryable(new Error("RESOURCE_EXHAUSTED"))).toBe(true);
    expect(isRetryable(new Error("503 UNAVAILABLE"))).toBe(true);
    expect(isRetryable(Object.assign(new Error("400 bad request"), { status: 400 }))).toBe(false);
    expect(isRetryable(new Error("INVALID_ARGUMENT"))).toBe(false);
  });
});

describe("estimateUsd", () => {
  it("bills thinking tokens at the output rate", () => {
    const withThoughts = estimateUsd("gemini-3.1-flash-lite", { promptTokens: 0, candidatesTokens: 0, thoughtsTokens: 1_000_000 });
    expect(withThoughts).toBeCloseTo(1.5, 6);
  });

  it("returns zero for a model with no published price rather than throwing", () => {
    expect(estimateUsd("gemini-unknown", { promptTokens: 1000, candidatesTokens: 1000, thoughtsTokens: 0 })).toBe(0);
  });
});
