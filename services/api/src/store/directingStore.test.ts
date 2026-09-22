import type { ProposalConstraints, StoryIntent, StoryProposal } from "@mosae/contracts";
import { describe, expect, it } from "vitest";
import { adminDb } from "../firebase/admin.js";
import {
  acceptProposal,
  readProposal,
  reviseConstraints,
  saveIntent,
  saveProposal,
} from "./directingStore.js";

const uniqueId = (prefix: string) => `${prefix}-${crypto.randomUUID()}`;

async function seedProject(userId = uniqueId("owner")) {
  const projectId = uniqueId("project");
  await adminDb.doc(`projects/${projectId}`).set({
    id: projectId,
    userId,
    mode: "memory",
    title: null,
    status: "ready",
    createdAt: 1,
  });
  return { projectId, userId };
}

function proposal(projectId: string, id: string, version: number, parentProposalId: string | null = null): StoryProposal {
  const firstMomentId = `${id}-moment-0`;
  const secondMomentId = `${id}-moment-1`;
  return {
    schemaVersion: 1,
    id,
    projectId,
    storyIntentId: "intent-1",
    parentProposalId,
    state: "draft",
    version,
    title: `Proposal ${version}`,
    moments: [
      { id: firstMomentId, shotId: "shot-1", kind: "photo", title: "Arrival", description: "Family arrives", rationale: "Opens the story" },
      { id: secondMomentId, shotId: "shot-2", kind: "photo", title: "Dinner", description: "Everyone together", rationale: "Shows the reunion" },
    ],
    chapters: [{ id: `${id}-chapter-0`, title: "Together", summary: "The family reunites", momentIds: [firstMomentId, secondMomentId] }],
    constraints: { excludedShotIds: [], deselectedMomentIds: [], mustIncludeMomentIds: [], feedback: [] },
    openQuestions: [],
  };
}

async function seedJob(projectId: string, jobId: string, proposalId: string, version: number) {
  await adminDb.doc(`projects/${projectId}/jobs/${jobId}`).set({ id: jobId, proposalId, version, type: "plan", status: "running" });
}

describe("directing store (emulator)", () => {
  it("saves an owned story intent and initializes proposal pointers", async () => {
    const { projectId, userId } = await seedProject();
    const intent: StoryIntent = {
      schemaVersion: 1,
      id: uniqueId("intent"),
      projectId,
      version: 1,
      text: "Keep the family reunion warm and playful.",
      focus: ["family", "reunion"],
    };

    await expect(saveIntent(adminDb, { userId, intent, createdAt: 20 })).resolves.toEqual(intent);
    await expect(adminDb.doc(`projects/${projectId}/storyIntents/${intent.id}`).get().then((snap) => snap.data())).resolves.toEqual({
      ...intent,
      createdAt: 20,
    });
    await expect(adminDb.doc(`projects/${projectId}`).get().then((snap) => snap.data())).resolves.toMatchObject({
      currentProposalId: null,
      acceptedProposalId: null,
    });
  });

  it("refuses to save an intent for a project owned by someone else", async () => {
    const { projectId } = await seedProject("real-owner");
    const intent: StoryIntent = {
      schemaVersion: 1,
      id: uniqueId("intent"),
      projectId,
      version: 1,
      text: "A family story",
      focus: [],
    };

    await expect(saveIntent(adminDb, { userId: "intruder", intent, createdAt: 20 })).rejects.toMatchObject({ code: "not_found" });
    await expect(adminDb.doc(`projects/${projectId}/storyIntents/${intent.id}`).get().then((snap) => snap.exists)).resolves.toBe(false);
  });

  it("publishes a proposal only when its persisted job version is newer", async () => {
    const { projectId } = await seedProject();
    const oldProposal = proposal(projectId, uniqueId("proposal-old"), 1);
    const newProposal = proposal(projectId, uniqueId("proposal-new"), 2, oldProposal.id);
    await seedJob(projectId, "job-old", oldProposal.id, 1);
    await seedJob(projectId, "job-new", newProposal.id, 2);

    await expect(saveProposal(adminDb, { jobId: "job-new", proposal: newProposal, createdAt: 30 })).resolves.toBe("published");
    await expect(saveProposal(adminDb, { jobId: "job-old", proposal: oldProposal, createdAt: 31 })).resolves.toBe("stale");

    const project = await adminDb.doc(`projects/${projectId}`).get();
    expect(project.get("currentProposalId")).toBe(newProposal.id);
    await expect(adminDb.doc(`projects/${projectId}/storyProposals/${oldProposal.id}`).get().then((snap) => snap.data())).resolves.toMatchObject({
      id: oldProposal.id,
      jobId: "job-old",
      createdAt: 31,
    });
  });

  it("makes a repeated publish from the same job idempotently current", async () => {
    const { projectId } = await seedProject();
    const draft = proposal(projectId, uniqueId("proposal"), 1);
    await seedJob(projectId, "job-1", draft.id, 1);

    await expect(saveProposal(adminDb, { jobId: "job-1", proposal: draft, createdAt: 30 })).resolves.toBe("published");
    await expect(saveProposal(adminDb, { jobId: "job-1", proposal: draft, createdAt: 30 })).resolves.toBe("published");
    expect((await adminDb.doc(`projects/${projectId}`).get()).get("currentProposalId")).toBe(draft.id);
  });

  it("does not demote an accepted proposal when its plan task retries", async () => {
    const { projectId, userId } = await seedProject();
    const draft = proposal(projectId, uniqueId("proposal"), 1);
    await seedJob(projectId, "job-1", draft.id, 1);

    await saveProposal(adminDb, { jobId: "job-1", proposal: draft, createdAt: 30 });
    await acceptProposal(adminDb, { userId, projectId, proposalId: draft.id });
    await expect(saveProposal(adminDb, { jobId: "job-1", proposal: draft, createdAt: 31 })).resolves.toBe("published");

    await expect(readProposal(adminDb, { userId, projectId, proposalId: draft.id })).resolves.toMatchObject({ state: "accepted" });
    const stored = await adminDb.doc(`projects/${projectId}/storyProposals/${draft.id}`).get();
    expect(stored.get("state")).toBe("accepted");
    expect(stored.get("createdAt")).toBe(30);
    const project = await adminDb.doc(`projects/${projectId}`).get();
    expect(project.get("currentProposalId")).toBe(draft.id);
    expect(project.get("acceptedProposalId")).toBe(draft.id);
  });

  it("does not mutate an accepted parent when its stale plan task retries", async () => {
    const { projectId, userId } = await seedProject();
    const parent = proposal(projectId, uniqueId("proposal-parent"), 1);
    const current = proposal(projectId, uniqueId("proposal-current"), 2, parent.id);
    await seedJob(projectId, "job-parent", parent.id, 1);
    await seedJob(projectId, "job-current", current.id, 2);

    await saveProposal(adminDb, { jobId: "job-parent", proposal: parent, createdAt: 30 });
    await acceptProposal(adminDb, { userId, projectId, proposalId: parent.id });
    await saveProposal(adminDb, { jobId: "job-current", proposal: current, createdAt: 40 });
    await expect(saveProposal(adminDb, { jobId: "job-parent", proposal: parent, createdAt: 50 })).resolves.toBe("stale");

    const storedParent = await adminDb.doc(`projects/${projectId}/storyProposals/${parent.id}`).get();
    expect(storedParent.get("state")).toBe("accepted");
    expect(storedParent.get("createdAt")).toBe(30);
    const project = await adminDb.doc(`projects/${projectId}`).get();
    expect(project.get("currentProposalId")).toBe(current.id);
    expect(project.get("acceptedProposalId")).toBe(parent.id);
  });

  it("rejects a proposal whose id or version does not match its job", async () => {
    const { projectId } = await seedProject();
    const draft = proposal(projectId, uniqueId("proposal"), 2);
    await seedJob(projectId, "job-1", "another-proposal", 1);

    await expect(saveProposal(adminDb, { jobId: "job-1", proposal: draft, createdAt: 30 })).rejects.toMatchObject({ code: "invalid_job" });
    await expect(adminDb.doc(`projects/${projectId}/storyProposals/${draft.id}`).get().then((snap) => snap.exists)).resolves.toBe(false);
  });

  it("clones the current proposal with revised constraints in one new draft version", async () => {
    const { projectId, userId } = await seedProject();
    const current = proposal(projectId, uniqueId("proposal"), 3);
    await adminDb.doc(`projects/${projectId}/storyProposals/${current.id}`).set({ ...current, jobId: "job-3", createdAt: 30 });
    await adminDb.doc(`projects/${projectId}`).update({ currentProposalId: current.id, acceptedProposalId: current.id });
    const constraints: ProposalConstraints = {
      ...current.constraints,
      deselectedMomentIds: [current.moments[0].id],
    };

    const revised = await reviseConstraints(adminDb, {
      userId,
      projectId,
      proposalId: current.id,
      constraints,
      createdAt: 40,
    });

    expect(revised).toMatchObject({
      projectId,
      version: 4,
      parentProposalId: current.id,
      state: "draft",
      constraints,
      moments: current.moments,
      chapters: current.chapters,
    });
    expect(revised.id).not.toBe(current.id);
    const project = await adminDb.doc(`projects/${projectId}`).get();
    expect(project.get("currentProposalId")).toBe(revised.id);
    expect(project.get("acceptedProposalId")).toBe(current.id);
    await expect(adminDb.doc(`projects/${projectId}/storyProposals/${revised.id}`).get().then((snap) => snap.data())).resolves.toMatchObject({
      ...revised,
      jobId: null,
      createdAt: 40,
    });
  });

  it("refuses to revise a stale proposal id", async () => {
    const { projectId, userId } = await seedProject();
    const stale = proposal(projectId, uniqueId("proposal-stale"), 1);
    const current = proposal(projectId, uniqueId("proposal-current"), 2, stale.id);
    await adminDb.doc(`projects/${projectId}/storyProposals/${stale.id}`).set(stale);
    await adminDb.doc(`projects/${projectId}/storyProposals/${current.id}`).set(current);
    await adminDb.doc(`projects/${projectId}`).update({ currentProposalId: current.id });

    await expect(reviseConstraints(adminDb, {
      userId,
      projectId,
      proposalId: stale.id,
      constraints: stale.constraints,
      createdAt: 40,
    })).rejects.toMatchObject({ code: "stale_proposal" });
    expect((await adminDb.collection(`projects/${projectId}/storyProposals`).get()).size).toBe(2);
  });

  it("reads proposals only for the project owner", async () => {
    const { projectId, userId } = await seedProject();
    const draft = proposal(projectId, uniqueId("proposal"), 1);
    await adminDb.doc(`projects/${projectId}/storyProposals/${draft.id}`).set({ ...draft, jobId: "job-1", createdAt: 30 });

    await expect(readProposal(adminDb, { userId, projectId, proposalId: draft.id })).resolves.toEqual(draft);
    await expect(readProposal(adminDb, { userId: "intruder", projectId, proposalId: draft.id })).resolves.toBeNull();
  });

  it("accepts only the current proposal and is idempotent", async () => {
    const { projectId, userId } = await seedProject();
    const stale = proposal(projectId, uniqueId("proposal-stale"), 1);
    const current = proposal(projectId, uniqueId("proposal-current"), 2, stale.id);
    await adminDb.doc(`projects/${projectId}/storyProposals/${stale.id}`).set(stale);
    await adminDb.doc(`projects/${projectId}/storyProposals/${current.id}`).set(current);
    await adminDb.doc(`projects/${projectId}`).update({ currentProposalId: current.id, acceptedProposalId: null });

    await expect(acceptProposal(adminDb, { userId, projectId, proposalId: stale.id })).rejects.toMatchObject({ code: "stale_proposal" });
    const accepted = await acceptProposal(adminDb, { userId, projectId, proposalId: current.id });
    expect(accepted.state).toBe("accepted");
    await expect(acceptProposal(adminDb, { userId, projectId, proposalId: current.id })).resolves.toEqual(accepted);
    expect((await adminDb.doc(`projects/${projectId}`).get()).get("acceptedProposalId")).toBe(current.id);
  });
});
