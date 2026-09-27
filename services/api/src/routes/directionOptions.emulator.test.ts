import express from "express";
import type { RequestHandler } from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { adminDb } from "../firebase/admin.js";

// Two distinct users: u1 owns the project, u2 is a stranger.
function auth(userId: string): RequestHandler {
  return (_req, res, next) => {
    res.locals.userId = userId;
    next();
  };
}

async function seedProject(userId: string) {
  const projectId = `direction-opts-${crypto.randomUUID()}`;
  await adminDb.doc(`projects/${projectId}`).set({
    id: projectId,
    userId,
    status: "ready",
    createdAt: 1,
  });
  return projectId;
}

/**
 * Seeds an accepted proposal with 12 photo moments and a recommendedCadence,
 * plus the story intent that holds the `note` text the route returns.
 */
async function seedProposal(projectId: string) {
  const intentId = "intent-dir-opts";
  await adminDb.doc(`projects/${projectId}/storyIntents/${intentId}`).set({
    schemaVersion: 1,
    id: intentId,
    projectId,
    version: 1,
    text: "A summer trip with the family",
    focus: [],
    createdAt: 1,
  });

  const proposalId = `prop-${crypto.randomUUID()}`;
  const moments = Array.from({ length: 12 }, (_, i) => ({
    id: `${proposalId}-m${i}`,
    shotId: `shot-${i}`,
    kind: "photo",
    title: `Photo ${i}`,
    description: "",
    rationale: "",
  }));

  await adminDb.doc(`projects/${projectId}/storyProposals/${proposalId}`).set({
    schemaVersion: 1,
    id: proposalId,
    projectId,
    storyIntentId: intentId,
    parentProposalId: null,
    state: "accepted",
    version: 1,
    title: "Summer trip",
    moments,
    chapters: [{ id: `${proposalId}-ch0`, title: "The trip", summary: "", momentIds: moments.map((m) => m.id) }],
    constraints: { excludedShotIds: [], deselectedMomentIds: [], mustIncludeMomentIds: [], feedback: [] },
    openQuestions: [],
    recommendedCadence: "playful",
    cadenceReason: "The kids were laughing all day",
    jobId: "job-1",
    createdAt: 1,
  });

  return proposalId;
}

async function buildApp(userId: string) {
  const app = express();
  app.use(express.json());
  // Mount the route under the same prefix as index.ts
  app.use(
    "/api/projects",
    (await import("./directionOptions.js")).directionOptionsRouter({
      db: adminDb,
      auth: auth(userId),
    }),
  );
  return app;
}

describe("direction-options route", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns options for an accepted proposal with 12 photo moments", async () => {
    const projectId = await seedProject("u1");
    const proposalId = await seedProposal(projectId);

    const app = await buildApp("u1");
    const res = await request(app)
      .get(`/api/projects/${projectId}/proposals/${proposalId}/direction-options`);

    expect(res.status).toBe(200);
    // 12 photos × 3s = 36s → snapped down to "30s"
    expect(res.body.recommendedDuration).toBe("30s");
    expect(res.body.recommendedCadence).toBe("playful");
    expect(res.body.cadenceReason).toBe("The kids were laughing all day");
    expect(res.body.cadences).toHaveLength(5);
    expect(res.body.soundtracks).toEqual([]);
    expect(res.body.durations).toHaveLength(5);
    // note comes from the story intent text
    expect(res.body.note).toBe("A summer trip with the family");
    expect(res.body.rewrites).toEqual([]);
  });

  it("returns 403 for a project the requesting user does not own", async () => {
    const projectId = await seedProject("u1");
    const proposalId = await seedProposal(projectId);

    const app = await buildApp("u2");
    const res = await request(app)
      .get(`/api/projects/${projectId}/proposals/${proposalId}/direction-options`);

    expect(res.status).toBe(403);
  });

  it("defaults recommendedCadence to reflective when the proposal has none", async () => {
    const projectId = await seedProject("u1");

    // Proposal without recommendedCadence
    const intentId = "intent-no-cadence";
    await adminDb.doc(`projects/${projectId}/storyIntents/${intentId}`).set({
      schemaVersion: 1,
      id: intentId,
      projectId,
      version: 1,
      text: "",
      focus: [],
      createdAt: 1,
    });
    const proposalId = `prop-nocadence-${crypto.randomUUID()}`;
    const moments = [
      { id: `${proposalId}-m0`, shotId: "s0", kind: "photo", title: "P0", description: "", rationale: "" },
    ];
    await adminDb.doc(`projects/${projectId}/storyProposals/${proposalId}`).set({
      schemaVersion: 1,
      id: proposalId,
      projectId,
      storyIntentId: intentId,
      parentProposalId: null,
      state: "accepted",
      version: 1,
      title: "No cadence proposal",
      moments,
      chapters: [{ id: `${proposalId}-ch0`, title: "Ch", summary: "", momentIds: [moments[0].id] }],
      constraints: { excludedShotIds: [], deselectedMomentIds: [], mustIncludeMomentIds: [], feedback: [] },
      openQuestions: [],
      jobId: "job-2",
      createdAt: 1,
    });

    const app = await buildApp("u1");
    const res = await request(app)
      .get(`/api/projects/${projectId}/proposals/${proposalId}/direction-options`);

    expect(res.status).toBe(200);
    expect(res.body.recommendedCadence).toBe("reflective");
    expect(res.body.cadenceReason).toBeNull();
  });
});
