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
  it("persists the first asking order across later progress updates", () => {
    const old: DirectorFlow = { revision: 0, story: { answer: null, storySummary: null, mentionedPeople: [] }, people: [] };
    const ordered = applyFlowAction(old, { type: "people-progress", askedPersonIds: ["kara", "chloe"], completedPersonIds: [] });
    expect(applyFlowAction(ordered, { type: "people-progress", completedPersonIds: ["kara"] }).peopleProgress).toEqual({ askedPersonIds: ["kara", "chloe"], completedPersonIds: ["kara"] });
  });
  it("persists automatic identity merges on the answered source person", () => {
    const old: DirectorFlow = { revision: 0, story: { answer: null, storySummary: null, mentionedPeople: [] }, people: [
      { personId: "split", name: "Kara", role: "other", confirmed: true, skipped: false, answerText: "that's Kara again", manualShotAdds: [], manualShotRemoves: [], faceIds: [], mergedInto: null },
      { personId: "kara", name: "Kara", role: "other", confirmed: true, skipped: false, manualShotAdds: [], manualShotRemoves: [], faceIds: [], mergedInto: null },
    ] };
    expect(applyFlowAction(old, { type: "merge", personId: "split", targetPersonId: "kara" }).people[0]).toMatchObject({ personId: "split", mergedInto: "kara", skipped: true, answerText: "that's Kara again" });
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
  it("persists missed-person gallery tags and completion in flow state", () => {
    const flow: DirectorFlow = { revision: 0, story: { answer: "A trip", storySummary: null, mentionedPeople: [] }, people: [], missedPeople: [
      { personId: "g1", name: "Grandpa" }, { personId: "g2", name: "Grandma" },
    ], missedPeopleConfirmed: false };
    const completed = applyFlowAction(flow, { type: "batch", actions: [
      { type: "manual-shot", personId: "g1", shotId: "shot-1", included: true },
      { type: "manual-shot", personId: "g2", shotId: "shot-2", included: true },
      { type: "missed-people-confirmed", confirmed: true },
    ] });
    expect(completed.missedPeopleConfirmed).toBe(true);
    expect(completed.missedPeople).toEqual(flow.missedPeople);
    expect(completed.people.map(({ personId, manualShotAdds }) => [personId, manualShotAdds])).toEqual([["g1", ["shot-1"]], ["g2", ["shot-2"]]]);
  });
  it("confirms missed people only after every person has a saved tag", () => {
    const flow: DirectorFlow = { revision: 0, story: { answer: "A trip", storySummary: null, mentionedPeople: [] }, people: [], missedPeople: [
      { personId: "g1", name: "Grandpa" }, { personId: "g2", name: "Grandma" },
    ], missedPeopleConfirmed: false };
    const grandpaDone = applyFlowAction(flow, { type: "batch", actions: [
      { type: "manual-shot", personId: "g1", shotId: "s1", included: true },
      { type: "missed-person-completed", personId: "g1" },
    ] });
    expect(grandpaDone.missedPeopleConfirmed).toBe(false);
    const bothDone = applyFlowAction(grandpaDone, { type: "batch", actions: [
      { type: "manual-shot", personId: "g2", shotId: "s2", included: true },
      { type: "missed-person-completed", personId: "g2" },
    ] });
    expect(bothDone.missedPeopleConfirmed).toBe(true);
    expect(bothDone.missedPeople?.map(({ personId }) => personId)).toEqual(["g1", "g2"]);
  });
});
