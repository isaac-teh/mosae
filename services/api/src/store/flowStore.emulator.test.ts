import { describe, expect, it } from "vitest";
import { adminDb } from "../firebase/admin.js";
import { mutateFlow, readFlow } from "./flowStore.js";

describe("project flow record (emulator)", () => {
  it("migrates legacy intent and cast into a revisioned flow snapshot", async () => {
    const projectId = crypto.randomUUID();
    const project = adminDb.doc(`projects/${projectId}`);
    await project.set({ userId: "owner", currentProposalId: null });
    await project.collection("storyIntents").doc("intent").set({ id: "intent", projectId, version: 1, text: "A trip", focus: [], schemaVersion: 1 });
    await project.collection("cast").doc("current").set({ confirmed: true, people: [{ personId: "p1", name: "Mia", role: "child" }] });
    await expect(readFlow(adminDb, "owner", projectId)).resolves.toMatchObject({ revision: 0, story: { answer: "A trip" }, people: [{ personId: "p1", name: "Mia", confirmed: true }] });
    expect((await project.get()).get("flow")).toMatchObject({ revision: 0 });
  });

  it("applies idempotent person/story edits and monotonically increments revisions", async () => {
    const projectId = crypto.randomUUID();
    await adminDb.doc(`projects/${projectId}`).set({ userId: "owner" });
    await mutateFlow(adminDb, { userId: "owner", projectId, actionId: "a1", action: { type: "story-answer", answer: "Our trip", storySummary: "Japan", mentionedPeople: ["Mia"] } });
    const unansweredSummary = await mutateFlow(adminDb, { userId: "owner", projectId, actionId: "a1-optional", action: { type: "story-answer", answer: "Our trip", storySummary: undefined, mentionedPeople: ["Mia"] } });
    expect(await mutateFlow(adminDb, { userId: "owner", projectId, actionId: "a1-optional", action: { mentionedPeople: ["Mia"], answer: "Our trip", type: "story-answer" } })).toEqual(unansweredSummary);
    const named = await mutateFlow(adminDb, { userId: "owner", projectId, actionId: "a2", action: { type: "person", personId: "p1", name: "Mia", role: "child", confirmed: true } });
    const replay = await mutateFlow(adminDb, { userId: "owner", projectId, actionId: "a2", action: { confirmed: true, role: "child", name: "Mia", personId: "p1", type: "person" } });
    expect(named.revision).toBe(3);
    expect(replay).toEqual(named);
    const moved = await mutateFlow(adminDb, { userId: "owner", projectId, actionId: "a3", action: { type: "manual-shot", personId: "p1", shotId: "s1", included: true } });
    expect(moved.revision).toBe(4);
    expect(moved.people[0]?.manualShotAdds).toEqual(["s1"]);
  });

  it("persists summary confirmation as an idempotent flow action", async () => {
    const projectId = crypto.randomUUID();
    await adminDb.doc(`projects/${projectId}`).set({ userId: "owner" });
    const action = { type: "people-summary-confirmed" as const, confirmed: true };
    const confirmed = await mutateFlow(adminDb, { userId: "owner", projectId, actionId: "summary-confirm", action });
    expect(confirmed.peopleSummaryConfirmed).toBe(true);
    expect(await mutateFlow(adminDb, { userId: "owner", projectId, actionId: "summary-confirm", action })).toEqual(confirmed);
    expect((await readFlow(adminDb, "owner", projectId)).peopleSummaryConfirmed).toBe(true);
  });

  it("applies a batch in one revision and replays it idempotently", async () => {
    const projectId = crypto.randomUUID();
    await adminDb.doc(`projects/${projectId}`).set({ userId: "owner" });
    const action = { type: "batch" as const, actions: [
      { type: "person" as const, personId: "a", name: "Alex", role: "parent", confirmed: true },
      { type: "person" as const, personId: "b", name: "Emma", role: "child", confirmed: true },
      { type: "move-photo" as const, faceId: "f1", personId: "b" },
    ] };
    const batch = await mutateFlow(adminDb, { userId: "owner", projectId, actionId: "batch1", action });
    expect(batch.revision).toBe(1);
    expect(batch.people.find((person) => person.personId === "b")?.faceIds).toEqual(["f1"]);
    const replay = await mutateFlow(adminDb, { userId: "owner", projectId, actionId: "batch1", action: { actions: [
      { confirmed: true, role: "parent", name: "Alex", personId: "a", type: "person" },
      { confirmed: true, role: "child", name: "Emma", personId: "b", type: "person" },
      { personId: "b", faceId: "f1", type: "move-photo" },
    ], type: "batch" } });
    expect(replay).toEqual(batch);
  });

  it("atomically completes two concurrently tagged missed people", async () => {
    const projectId = crypto.randomUUID();
    await adminDb.doc(`projects/${projectId}`).set({ userId: "owner" });
    await mutateFlow(adminDb, { userId: "owner", projectId, actionId: "missed-list", action: { type: "missed-people", answer: "Grandpa and Grandma", people: [
      { personId: "grandpa", name: "Grandpa" }, { personId: "grandma", name: "Grandma" },
    ] } });
    const complete = (personId: string, shotId: string) => mutateFlow(adminDb, { userId: "owner", projectId, actionId: `complete-${personId}`, action: { type: "batch", actions: [
      { type: "manual-shot", personId, shotId, included: true },
      { type: "missed-person-completed", personId },
    ] } });
    await Promise.all([complete("grandpa", "shot-grandpa"), complete("grandma", "shot-grandma")]);
    const flow = await readFlow(adminDb, "owner", projectId);
    expect(flow.missedPeopleConfirmed).toBe(true);
    expect(flow.missedPeople?.map(({ personId }) => personId)).toEqual(["grandpa", "grandma"]);
    expect(flow.people.map(({ personId, manualShotAdds }) => [personId, manualShotAdds])).toEqual([
      ["grandpa", ["shot-grandpa"]], ["grandma", ["shot-grandma"]],
    ]);
  });

  it("undoes the latest action while advancing the revision", async () => {
    const projectId = crypto.randomUUID();
    await adminDb.doc(`projects/${projectId}`).set({ userId: "owner" });
    await mutateFlow(adminDb, { userId: "owner", projectId, actionId: "a1", action: { type: "person", personId: "p1", name: "Mia" } });
    const undone = await mutateFlow(adminDb, { userId: "owner", projectId, actionId: "a2", action: { type: "undo" } });
    expect(undone.revision).toBe(2);
    expect(undone.people).toEqual([]);
  });

  it("records face moves and person merges", async () => {
    const projectId = crypto.randomUUID();
    await adminDb.doc(`projects/${projectId}`).set({ userId: "owner" });
    await mutateFlow(adminDb, { userId: "owner", projectId, actionId: "p1", action: { type: "person", personId: "a", name: "Alex" } });
    await mutateFlow(adminDb, { userId: "owner", projectId, actionId: "p2", action: { type: "person", personId: "b", name: "Emma" } });
    const moved = await mutateFlow(adminDb, { userId: "owner", projectId, actionId: "p3", action: { type: "move-photo", faceId: "f1", personId: "a" } });
    expect(moved.people.find((person) => person.personId === "a")?.faceIds).toEqual(["f1"]);
    const merged = await mutateFlow(adminDb, { userId: "owner", projectId, actionId: "p4", action: { type: "merge", personId: "a", targetPersonId: "b" } });
    expect(merged.people.find((person) => person.personId === "a")?.mergedInto).toBe("b");
  });
});
