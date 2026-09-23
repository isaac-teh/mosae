import { describe, expect, it } from "vitest";
import type { UsageRecord } from "../gemini/client.js";
import { createPlanningModel } from "./wire.js";
import { planningToolDeclarations } from "./tools.js";

describe("planning model transport", () => {
  it("sends the bounded conversation and records one charged call per turn", async () => {
    const requests: unknown[] = [];
    const usage: UsageRecord[] = [];
    const model = createPlanningModel({
      generateContent: async (input) => {
        requests.push(input);
        return { text: JSON.stringify({ type: "tool_calls", calls: [{ name: "searchShots", input: { query: "family" } }] }), usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, totalTokenCount: 15 } };
      },
      recordUsage: (record) => { usage.push(record); },
    }, "job-1");
    const messages = [{ role: "user" as const, content: "Use only shot-1" }];
    expect(await model.runTurn({ messages, toolDeclarations: planningToolDeclarations })).toEqual({ type: "tool_calls", calls: [{ name: "searchShots", input: { query: "family" } }] });
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ model: "gemini-3.5-flash-lite", config: { responseMimeType: "application/json" } });
    const request = requests[0] as { contents: string };
    expect(request.contents).toContain("Use only shot-1");
    expect(request.contents).toContain("searchShots");
    expect(usage).toMatchObject([{ stage: "plan", subjectId: "job-1", promptTokens: 10, candidatesTokens: 5, totalTokens: 15, attempt: 1 }]);
  });

  it("lets the worker own retries instead of hiding extra model calls", async () => {
    let calls = 0;
    const usage: UsageRecord[] = [];
    const model = createPlanningModel({
      generateContent: async () => { calls += 1; throw new Error("503 unavailable"); },
      recordUsage: (record) => { usage.push(record); },
    }, "job-2");
    await expect(model.runTurn({ messages: [], toolDeclarations: planningToolDeclarations })).rejects.toThrow("503 unavailable");
    expect(calls).toBe(1);
    expect(usage).toMatchObject([{ subjectId: "job-2", error: "503 unavailable" }]);
  });

  it("rejects unsupported actions before any datastore tool can execute", async () => {
    const model = createPlanningModel({
      generateContent: async () => ({ text: JSON.stringify({ type: "tool_calls", calls: [{ name: "deleteProject", input: {} }] }) }),
      recordUsage: () => {},
    }, "job-3");
    await expect(model.runTurn({ messages: [], toolDeclarations: planningToolDeclarations })).rejects.toThrow();
  });
});
