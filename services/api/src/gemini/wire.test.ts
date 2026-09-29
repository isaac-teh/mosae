import { recordUsageToLog } from "./wire.js";

describe("recordUsageToLog", () => {
  it("omits undefined optional fields from Firestore documents", async () => {
    const add = vi.fn(async (value: Record<string, unknown>) => {
      if (Object.hasOwn(value, "subjectId")) throw new Error("Firestore rejects undefined subjectId");
    });
    const db = { collection: vi.fn(() => ({ add })) } as any;
    await recordUsageToLog(db, { projectId: "ask-usage-test" })({
      stage: "editor.interpret", model: "gemini-3.1-flash-lite", subjectId: undefined, promptTokens: 100, candidatesTokens: 20,
      thoughtsTokens: 0, totalTokens: 120, latencyMs: 5, estimatedUsd: 0.001, attempt: 1,
    });
    expect(add).toHaveBeenCalledOnce();
    expect(add.mock.calls[0]![0]).not.toHaveProperty("subjectId");
    expect(add.mock.calls[0]![0]).toMatchObject({ projectId: "ask-usage-test" });
  });
});
