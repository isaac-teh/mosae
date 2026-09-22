import { describe, expect, it } from "vitest";
import { adminDb } from "../firebase/admin.js";
import { recordUsageToLog } from "../gemini/wire.js";

describe("Gemini usage log (emulator)", () => {
  it("writes server-side usage with its bound project id", async () => {
    const subjectId = crypto.randomUUID();
    await recordUsageToLog(adminDb, { projectId: "p1" })({ stage: "understand.analyze", model: "gemini-3.1-flash-lite", subjectId, promptTokens: 10, candidatesTokens: 5, thoughtsTokens: 0, totalTokens: 15, latencyMs: 20, estimatedUsd: 0.001, attempt: 1 });
    const result = await adminDb.collection("geminiUsage").where("subjectId", "==", subjectId).get();
    expect(result.docs[0].data()).toMatchObject({ projectId: "p1", subjectId, stage: "understand.analyze" });
  });
});
