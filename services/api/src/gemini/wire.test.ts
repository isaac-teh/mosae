import { describe, expect, it, vi } from "vitest";
import type { Firestore } from "firebase-admin/firestore";
import type { UsageRecord } from "./client.js";
import { recordUsageToLog } from "./wire.js";

describe("recordUsageToLog", () => {
  it("omits an absent subjectId for project-level Gemini requests", async () => {
    const add = vi.fn(async () => undefined);
    const db = { collection: vi.fn(() => ({ add })) } as unknown as Firestore;
    const usage: UsageRecord = {
      stage: "chat.interpret", model: "gemini-3.1-flash-lite", subjectId: undefined, promptTokens: 10,
      candidatesTokens: 5, thoughtsTokens: 0, totalTokens: 15, latencyMs: 20,
      estimatedUsd: 0.001, attempt: 1,
    };

    await recordUsageToLog(db, { projectId: "p1" })(usage);

    expect(add).toHaveBeenCalledOnce();
    expect(add.mock.calls[0]?.[0]).toEqual({ ...usage, projectId: "p1", createdAt: expect.any(Number) });
    expect(Object.hasOwn(add.mock.calls[0]?.[0] as object, "subjectId")).toBe(false);
  });
});
