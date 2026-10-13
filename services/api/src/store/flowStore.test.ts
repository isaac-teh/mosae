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
  it("persists proceeded identities and preserves old flows without progress state", () => {
    const old: DirectorFlow = { revision: 0, story: { answer: null, storySummary: null, mentionedPeople: [] }, people: [] };
    expect(applyFlowAction(old, { type: "people-progress", completedPersonIds: ["p1"] })).toEqual({ ...old, peopleProgress: { completedPersonIds: ["p1"] } });
  });
  it("persists the typed transcript alongside normalized person and missed-person names", () => {
    const flow: DirectorFlow = { revision: 0, story: { answer: "A trip", storySummary: null, mentionedPeople: [] }, people: [] };
    const named = applyFlowAction(flow, { type: "person", personId: "p1", name: "Daughter", role: "child", answerText: "My daughter" });
    expect(named.people[0]).toMatchObject({ name: "Daughter", answerText: "My daughter" });
    const missed = applyFlowAction(named, { type: "missed-people", answer: "Grandpa and Grandma", people: [{ personId: "g1", name: "Grandpa" }, { personId: "g2", name: "Grandma" }] });
    expect(missed.missedAnswer).toBe("Grandpa and Grandma");
    expect(missed.missedPeople?.map(({ name }) => name)).toEqual(["Grandpa", "Grandma"]);
  });
  it("persists missed-name clarifications, duplicate replies, and explicit skips", () => {
    const flow: DirectorFlow = { revision: 0, story: { answer: "A trip", storySummary: null, mentionedPeople: [] }, people: [] };
    const clarified = applyFlowAction(flow, { type: "missed-clarification-turn", question: "my two cousins", reply: "What are their names?" });
    expect(clarified.missedClarifications).toEqual([{ question: "my two cousins", reply: "What are their names?" }]);
    const reply = applyFlowAction(clarified, { type: "missed-people", people: [{ personId: "g1", name: "Grandma" }], answer: "Grandpa and Grandma", reply: "Grandpa is already tagged." });
    expect(reply.missedReply).toBe("Grandpa is already tagged.");
    const skipped = applyFlowAction(reply, { type: "missed-people", people: [{ personId: "g1", name: "Grandma", skipped: true }], reply: null });
    expect(skipped.missedPeople?.[0]?.skipped).toBe(true);
    expect(skipped.missedReply).toBeUndefined();
  });
});
