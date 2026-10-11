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
    const named = await mutateFlow(adminDb, { userId: "owner", projectId, actionId: "a2", action: { type: "person", personId: "p1", name: "Mia", role: "child", confirmed: true } });
    const replay = await mutateFlow(adminDb, { userId: "owner", projectId, actionId: "a2", action: { type: "person", personId: "p1", name: "Wrong", role: "other" } });
    expect(named.revision).toBe(2);
    expect(replay).toEqual(named);
    const moved = await mutateFlow(adminDb, { userId: "owner", projectId, actionId: "a3", action: { type: "manual-shot", personId: "p1", shotId: "s1", included: true } });
    expect(moved.revision).toBe(3);
    expect(moved.people[0]?.manualShotAdds).toEqual(["s1"]);
  });

  it("undoes the latest action while advancing the revision", async () => {
    const projectId = crypto.randomUUID();
    await adminDb.doc(`projects/${projectId}`).set({ userId: "owner" });
    await mutateFlow(adminDb, { userId: "owner", projectId, actionId: "a1", action: { type: "person", personId: "p1", name: "Mia" } });
    const undone = await mutateFlow(adminDb, { userId: "owner", projectId, actionId: "a2", action: { type: "undo" } });
    expect(undone.revision).toBe(2);
    expect(undone.people).toEqual([]);
  });
});
