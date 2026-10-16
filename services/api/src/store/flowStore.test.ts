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
    expect(applyFlowAction(flow, { type: "people-summary-confirmed", confirmed: true, answer: "Looks right", peopleCount: 4 })).toEqual({ ...flow, peopleSummaryConfirmed: true, peopleSummaryAnswer: "Looks right", peopleSummaryCount: 4 });
    expect(applyFlowAction(flow, { type: "people-summary-confirmed", confirmed: false })).toEqual(flow);
  });
  it("persists chosen no-missed-people answers in the flow transcript", () => {
    const flow: DirectorFlow = { revision: 0, story: { answer: "A trip", storySummary: null, mentionedPeople: [] }, people: [] };
    expect(applyFlowAction(flow, { type: "missed-people-confirmed", confirmed: true, answer: "That's everyone" })).toEqual({ ...flow, missedPeopleConfirmed: true, missedAnswer: "That's everyone", peopleSummaryFollowupActive: false });
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
  it("persists summary snapshots and chronological follow-up turns", () => {
    const flow: DirectorFlow = { revision: 0, story: { answer: "A trip", storySummary: null, mentionedPeople: [] }, people: [] };
    const snapshot = [{ personId: "p1", name: "Kara", momentCount: 2 }];
    const started = applyFlowAction(flow, { type: "people-summary-snapshot", people: snapshot });
    const clarified = applyFlowAction(started, { type: "batch", actions: [
      { type: "missed-clarification-turn", question: "One more person missing", reply: "Who did I miss? Type their name.", stage: "summary" },
      { type: "people-summary-followup", question: "One more person missing", reply: "Who did I miss? Type their name." },
    ] });
    expect(clarified.peopleSummaryHistory).toEqual([snapshot]);
    expect(clarified.peopleSummaryFollowupActive).toBe(true);
    expect(clarified.missedClarifications?.[0]?.stage).toBe("summary");
    expect(clarified.peopleSummaryFollowups?.[0]).toEqual({ question: "One more person missing", reply: "Who did I miss? Type their name." });
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
    const sampleFace = { shotId: "s2", uri: "https://thumb/s2", bbox: [0.1, 0.2, 0.3, 0.4] as [number, number, number, number] };
    const bothDone = applyFlowAction(grandpaDone, { type: "batch", actions: [
      { type: "manual-shot", personId: "g2", shotId: "s2", included: true },
      { type: "missed-person-completed", personId: "g2", sampleFace },
    ] });
    expect(bothDone.missedPeopleConfirmed).toBe(true);
    expect(bothDone.missedPeople).toEqual([{ personId: "g1", name: "Grandpa" }, { personId: "g2", name: "Grandma", sampleFace }]);
  });
  it("appends and skips missed people by ID without replacing concurrent entries", () => {
    const flow: DirectorFlow = { revision: 0, story: { answer: null, storySummary: null, mentionedPeople: [] }, people: [], missedPeople: [{ personId: "g1", name: "Grandpa" }] };
    const added = applyFlowAction(flow, { type: "missed-person-added", personId: "g2", name: "Grandma" });
    const skipped = applyFlowAction(added, { type: "missed-person-skipped", personId: "g1" });
    expect(skipped.missedPeople).toEqual([{ personId: "g1", name: "Grandpa", skipped: true }, { personId: "g2", name: "Grandma" }]);
  });
});
