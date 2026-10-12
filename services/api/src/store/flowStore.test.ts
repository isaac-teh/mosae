import { describe, expect, it } from "vitest";
import type { DirectorFlow } from "@mosae/contracts";
import { applyFlowAction } from "./flowStore.js";

describe("flow action application", () => {
  it("records people summary confirmation independently of proposal state", () => {
    const flow: DirectorFlow = {
      revision: 3,
      story: { answer: "A trip", storySummary: "Japan", mentionedPeople: [] },
      people: [],
      peopleSummaryConfirmed: false,
    };
    expect(applyFlowAction(flow, { type: "people-summary-confirmed", confirmed: true })).toEqual({ ...flow, peopleSummaryConfirmed: true });
    expect(applyFlowAction(flow, { type: "people-summary-confirmed", confirmed: false })).toEqual(flow);
  });
});
