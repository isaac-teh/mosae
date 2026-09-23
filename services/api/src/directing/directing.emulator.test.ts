import express, { type RequestHandler } from "express";
import { FieldValue } from "firebase-admin/firestore";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { StoryProposalSchema } from "@mosae/contracts";
import { adminDb } from "../firebase/admin.js";
import { directingRouter, createPlanJob, type QueuePlan } from "../routes/directing.js";
import { createPlan, type PlanTask } from "./wire.js";
import type { PlanModelInput, PlanModelOutput, PlanningModel } from "./runPlan.js";

const USER_ID = "directing-emulator-owner";
const constraints = {
  excludedShotIds: [],
  deselectedMomentIds: [],
  mustIncludeMomentIds: [],
  feedback: [],
};

// Recorded from a successful model response and kept local so this suite never
// constructs a Gemini client or spends against a live model.
const RECORDED_GEMINI_SUBMISSION = {
  title: "A Day at the Park",
  moments: Array.from({ length: 12 }, (_, index) => ({
    shotId: `park-shot-${index}`,
    kind: "photo" as const,
    title: `Park moment ${index + 1}`,
    description: "Family spending time together outdoors.",
    rationale: "Builds a warm, chronological family story.",
  })),
  chapters: [{
    title: "Together outdoors",
    summary: "A warm day in the park.",
    momentIds: Array.from({ length: 12 }, (_, index) => `park-shot-${index}`),
  }],
  openQuestions: [],
};

const auth: RequestHandler = (_req, res, next) => {
  res.locals.userId = USER_ID;
  next();
};

function scriptedModel(
  run: (input: PlanModelInput) => Promise<PlanModelOutput> = async () => ({
    type: "submit",
    submission: RECORDED_GEMINI_SUBMISSION,
  }),
): { instance: PlanningModel; inputs: PlanModelInput[] } {
  const inputs: PlanModelInput[] = [];
  return {
    instance: {
      async runTurn(input) {
        inputs.push(input);
        return run(input);
      },
    },
    inputs,
  };
}

function app(queuePlan: QueuePlan = (input) => createPlanJob(adminDb, input)) {
  const server = express();
  server.use(express.json());
  server.use("/api/projects", directingRouter({
    db: adminDb,
    auth,
    now: () => 100,
    queuePlan,
  }));
  return server;
}

async function seedUnderstoodProject() {
  const projectId = `directing-emulator-${crypto.randomUUID()}`;
  const project = adminDb.collection("projects").doc(projectId);
  await project.set({
    id: projectId,
    userId: USER_ID,
    mode: "memory",
    title: "Park day",
    status: "ready",
    createdAt: 1,
    currentProposalId: null,
    acceptedProposalId: null,
  });

  const batch = adminDb.batch();
  for (let index = 0; index < 12; index += 1) {
    const assetId = `park-asset-${index}`;
    const shotId = `park-shot-${index}`;
    batch.set(project.collection("assets").doc(assetId), {
      id: assetId,
      projectId,
      status: "understood",
      generation: "fixture-1",
      eventId: "park-day",
      dupOf: null,
      media: { kind: "photo", localTime: `2026-05-0${(index % 3) + 1}T10:00:00` },
      transcript: null,
    });
    batch.set(project.collection("shots").doc(shotId), {
      id: shotId,
      assetId,
      assetGeneration: "fixture-1",
      sourceStartSec: null,
      sourceEndSec: null,
      embedding: FieldValue.vector([1, 0]),
      analysis: {
        kind: "photo",
        caption: "Family picnic in the park",
        subjects: [],
        setting: "park",
        activities: ["picnic"],
        mood: "warm",
        shotType: "wide",
        aesthetics: 4,
        keyMomentScore: 4,
        tags: ["family", "park"],
      },
    });
  }
  await batch.commit();
  return { projectId, project };
}

async function postIntent(server: express.Express, projectId: string, text = "Tell our park day warmly.") {
  const response = await request(server)
    .post(`/api/projects/${projectId}/story-intents`)
    .send({ text, focus: ["family"] });
  expect(response.status).toBe(202);
  return response.body as {
    intent: { id: string };
    job: { id: string; proposalId: string; version: number };
  };
}

async function runJob(projectId: string, job: { id: string; version: number }, model: PlanningModel) {
  const task: PlanTask = { projectId, jobId: job.id, generation: String(job.version) };
  return createPlan({ db: adminDb, model, now: () => 100 })(task);
}

async function storedProposal(projectId: string, proposalId: string) {
  const snapshot = await adminDb.doc(`projects/${projectId}/storyProposals/${proposalId}`).get();
  expect(snapshot.exists).toBe(true);
  const { jobId: _jobId, createdAt: _createdAt, ...proposal } = snapshot.data()!;
  return StoryProposalSchema.parse(proposal);
}

describe("directing route and worker flow (emulator)", () => {
  it("persists a valid proposal from an intent job and makes it current", async () => {
    const { projectId, project } = await seedUnderstoodProject();
    const response = await postIntent(app(), projectId);
    const scripted = scriptedModel();

    await expect(runJob(projectId, response.job, scripted.instance)).resolves.toBe("published");

    const proposal = await storedProposal(projectId, response.job.proposalId);
    expect(proposal).toMatchObject({
      projectId,
      storyIntentId: response.intent.id,
      version: 1,
      parentProposalId: null,
      state: "draft",
      title: "A Day at the Park",
    });
    expect(proposal.moments).toHaveLength(12);
    expect((await project.get()).get("currentProposalId")).toBe(proposal.id);
    expect(scripted.inputs).toHaveLength(1);
  });

  it("revises deselected moments without invoking a model and retains its source as parent", async () => {
    const { projectId } = await seedUnderstoodProject();
    const baselineId = "recorded-proposal";
    const baseline = {
      schemaVersion: 1,
      id: baselineId,
      projectId,
      storyIntentId: "recorded-intent",
      parentProposalId: null,
      state: "draft",
      version: 1,
      title: "Recorded park day",
      moments: RECORDED_GEMINI_SUBMISSION.moments.map((moment, index) => ({
        ...moment,
        id: `${baselineId}-moment-${index}`,
      })),
      chapters: [{
        id: `${baselineId}-chapter-0`,
        title: RECORDED_GEMINI_SUBMISSION.chapters[0].title,
        summary: RECORDED_GEMINI_SUBMISSION.chapters[0].summary,
        momentIds: Array.from({ length: 12 }, (_, index) => `${baselineId}-moment-${index}`),
      }],
      constraints,
      openQuestions: [],
    };
    await adminDb.doc(`projects/${projectId}/storyIntents/recorded-intent`).set({
      schemaVersion: 1,
      id: "recorded-intent",
      projectId,
      version: 1,
      text: "Tell our park day warmly.",
      focus: ["family"],
      createdAt: 1,
    });
    await adminDb.doc(`projects/${projectId}/storyProposals/${baselineId}`).set({ ...baseline, jobId: "recorded-job", createdAt: 1 });
    await adminDb.doc(`projects/${projectId}`).update({ currentProposalId: baselineId, proposalVersionCounter: 1 });

    let requestedModelBackedPlan = 0;
    const response = await request(app(async () => {
      requestedModelBackedPlan += 1;
      throw new Error("constraint revisions must not plan");
    }))
      .patch(`/api/projects/${projectId}/proposals/${baselineId}/constraints`)
      .send({ deselectedMomentIds: [`${baselineId}-moment-0`], mustIncludeMomentIds: [] });

    expect(response.status).toBe(201);
    expect(response.body.proposal).toMatchObject({
      parentProposalId: baselineId,
      version: 2,
      constraints: { ...constraints, deselectedMomentIds: [`${baselineId}-moment-0`] },
    });
    const source = await storedProposal(projectId, baselineId);
    expect(source).toEqual(baseline);
    expect(requestedModelBackedPlan).toBe(0);
    expect((await adminDb.collection(`projects/${projectId}/jobs`).get()).empty).toBe(true);
  });

  it("carries feedback into a new draft and accepts that exact proposal", async () => {
    const { projectId, project } = await seedUnderstoodProject();
    const server = app();
    const initial = await postIntent(server, projectId);
    await expect(runJob(projectId, initial.job, scriptedModel().instance)).resolves.toBe("published");

    const feedback = "Keep the grandparents at the emotional center.";
    const feedbackResponse = await request(server)
      .post(`/api/projects/${projectId}/proposals/${initial.job.proposalId}/feedback`)
      .send({ feedback });
    expect(feedbackResponse.status).toBe(202);
    const feedbackJob = feedbackResponse.body.job as { id: string; proposalId: string; version: number };
    await expect(runJob(projectId, feedbackJob, scriptedModel().instance)).resolves.toBe("published");

    const revised = await storedProposal(projectId, feedbackJob.proposalId);
    expect(revised).toMatchObject({
      parentProposalId: initial.job.proposalId,
      version: 2,
      state: "draft",
      constraints: { ...constraints, feedback: [feedback] },
    });
    const acceptResponse = await request(server)
      .post(`/api/projects/${projectId}/proposals/${revised.id}/accept`);
    expect(acceptResponse.status).toBe(200);
    expect(acceptResponse.body.proposal).toMatchObject({ id: revised.id, state: "accepted" });
    expect((await project.get()).data()).toMatchObject({
      currentProposalId: revised.id,
      acceptedProposalId: revised.id,
    });
    expect((await storedProposal(projectId, revised.id)).state).toBe("accepted");
  });

  it("keeps the newer proposal current when concurrent jobs finish out of order", async () => {
    const { projectId, project } = await seedUnderstoodProject();
    const server = app();
    const older = await postIntent(server, projectId, "Start with the quiet arrivals.");
    const newer = await postIntent(server, projectId, "End with the family picnic.");
    let releaseOlder!: (output: PlanModelOutput) => void;
    let olderStarted!: () => void;
    const started = new Promise<void>((resolve) => { olderStarted = resolve; });
    const olderModel = scriptedModel(async () => {
      olderStarted();
      return new Promise((resolve) => { releaseOlder = resolve; });
    });
    const olderRun = runJob(projectId, older.job, olderModel.instance);
    await started;

    const newerModel = scriptedModel();
    await expect(runJob(projectId, newer.job, newerModel.instance)).resolves.toBe("published");
    releaseOlder({ type: "submit", submission: RECORDED_GEMINI_SUBMISSION });
    await expect(olderRun).resolves.toBe("stale");

    expect((await project.get()).get("currentProposalId")).toBe(newer.job.proposalId);
    expect((await adminDb.collection(`projects/${projectId}/storyProposals`).get()).size).toBe(2);
    expect((await adminDb.doc(`projects/${projectId}/jobs/${older.job.id}`).get()).get("publication")).toBe("stale");
    expect((await adminDb.doc(`projects/${projectId}/jobs/${newer.job.id}`).get()).get("publication")).toBe("published");
    expect(olderModel.inputs).toHaveLength(1);
    expect(newerModel.inputs).toHaveLength(1);
  });
});
