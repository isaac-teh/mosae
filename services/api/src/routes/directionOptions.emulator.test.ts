import express from "express";
import type { RequestHandler } from "express";
import request from "supertest";
import { listeningServer } from "../test/listeningServer.js";
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
async function seedProposal(projectId: string, constraints: { excludedShotIds: string[]; deselectedMomentIds: string[]; hiddenShotIds: string[] } = { excludedShotIds: [], deselectedMomentIds: [], hiddenShotIds: [] }) {
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
    constraints: { ...constraints, mustIncludeMomentIds: [], feedback: [] },
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
    const res = await request(await listeningServer(app))
      .get(`/api/projects/${projectId}/proposals/${proposalId}/direction-options`);

    expect(res.status).toBe(200);
    // Twelve photos include one four-photo collage, with 3⅓× stretch capacity.
    expect(res.body.recommendedDuration).toBe("30s");
    expect(res.body.maximumDurationSec).toBe(76);
    expect(res.body.maximumDurationSecByCadence).toMatchObject({ reflective: 68, playful: 38 });
    expect(res.body.recommendedCadence).toBe("playful");
    expect(res.body).toMatchObject({ collageAmount: "few", motionFeel: "calm" });
    expect(res.body.cadenceReason).toBe("The kids were laughing all day");
    expect(res.body.cadences).toHaveLength(5);
    // The library, with the track for the suggested cadence first.
    expect(res.body.soundtracks.length).toBeGreaterThanOrEqual(5);
    expect(res.body.soundtracks[0]).toMatchObject({ id: "lyria-playful", name: "Sandcastle Days" });
    expect(res.body.durations).toHaveLength(2);
    expect(res.body.durations).toContainEqual({ id: "30s", label: "30 sec", caption: "A quick share", seconds: 30 });
    // note comes from the story intent text
    expect(res.body.note).toBe("A summer trip with the family");
    expect(res.body.rewrites).toEqual([]);
  });

  it("bases the achievable length on moments the user has not left out", async () => {
    const projectId = await seedProject("u1");
    const proposalId = await seedProposal(projectId, { excludedShotIds: Array.from({ length: 10 }, (_, index) => `shot-${index}`), deselectedMomentIds: [], hiddenShotIds: [] });
    const app = await buildApp("u1");
    const res = await request(await listeningServer(app)).get(`/api/projects/${projectId}/proposals/${proposalId}/direction-options`);
    expect(res.status).toBe(200);
    expect(res.body.maximumDurationSecByCadence.reflective).toBe(14);
  });

  it("returns 403 for a project the requesting user does not own", async () => {
    const projectId = await seedProject("u1");
    const proposalId = await seedProposal(projectId);

    const app = await buildApp("u2");
    const res = await request(await listeningServer(app))
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
    const res = await request(await listeningServer(app))
      .get(`/api/projects/${projectId}/proposals/${proposalId}/direction-options`);

    expect(res.status).toBe(200);
    expect(res.body.recommendedCadence).toBe("reflective");
    expect(res.body.cadenceReason).toBeNull();
  });
});
