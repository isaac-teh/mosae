import express from "express";
import type { Firestore } from "firebase-admin/firestore";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { directionOptionsRouter } from "./directionOptions.js";
import { listeningServer } from "../test/listeningServer.js";
import { runCompose } from "../compose/runCompose.js";
import type { StoryProposal } from "@mosae/contracts";

describe("direction options contextual copy", () => {
  it.each([undefined, null, 42, "", "x".repeat(301), "For these portraits, I’d suggest a gentle pace.", "For this celebration, I’d suggest a lively rhythm."])("keeps intent distinct from recommendation %j", async (copy) => {
    const proposal = { storyIntentId: "intent-1", moments: [], directionRecommendation: copy };
    const projectRef = {
      get: async () => ({ exists: true, get: () => "owner" }),
      collection: (name: string) => ({ doc: () => ({ get: async () => name === "storyProposals"
        ? { exists: true, data: () => proposal }
        : { exists: true, get: () => "The user's story intent" } }) }),
    };
    const db = { collection: () => ({ doc: () => projectRef }) } as unknown as Firestore;
    const app = express();
    app.use("/api/projects", directionOptionsRouter({ db, auth: (_req, res, next) => { res.locals.userId = "owner"; next(); } }));
    const response = await request(await listeningServer(app)).get("/api/projects/project-1/proposals/proposal-1/direction-options");
    expect(response.status).toBe(200);
    expect(response.body.note).toBe("The user's story intent");
    expect(response.body.recommendation).toBe(typeof copy === "string" && copy.length > 0 && copy.length <= 300 ? copy : undefined);
  });
});

describe("direction options v2 capacity", () => {
  it("composes the six-photo recommendation returned to the chat director", async () => {
    const moments = Array.from({ length: 6 }, (_, index) => ({ id: `m${index}`, shotId: `s${index}`, kind: "photo" as const, title: `Photo ${index}`, description: "", rationale: "" }));
    const projectRef = {
      get: async () => ({ exists: true, get: () => "owner" }),
      collection: () => ({ doc: () => ({ get: async () => ({ exists: true, data: () => ({ moments, constraints: {}, recommendedCadence: "playful" }) }) }) }),
    };
    const db = { collection: () => ({ doc: () => projectRef }) } as unknown as Firestore;
    const app = express();
    app.use("/api/projects", directionOptionsRouter({ db, auth: (_req, res, next) => { res.locals.userId = "owner"; next(); } }));
    const options = await request(await listeningServer(app)).get("/api/projects/project-1/proposals/proposal-1/direction-options");
    const selected = options.body.durations.find(({ id }: { id: string }) => id === options.body.recommendedDuration);
    expect(options.body.recommendedDuration).toBe("short");
    expect(selected.seconds).toBe(20);

    const proposal = { schemaVersion: 1, id: "proposal-1", projectId: "project-1", storyIntentId: "intent-1", parentProposalId: null, state: "accepted", version: 1, title: "Trip", moments, chapters: [{ id: "chapter-1", title: "Trip", summary: "", momentIds: moments.map(({ id }) => id) }], constraints: { excludedShotIds: [], deselectedMomentIds: [], mustIncludeMomentIds: [], feedback: [] }, openQuestions: [] } as StoryProposal;
    const result = await runCompose({ proposal, projectId: "project-1", generationId: "generation-1", mode: "creator", aspect: "9:16", durationId: options.body.recommendedDuration, durationSec: selected.seconds, cadenceId: options.body.recommendedCadence, seed: "seed", soundtrackId: null, note: "", captions: false, collageAmount: "none" }, {
      assets: new Map(moments.map(({ id }, index) => [id, { kind: "photo" as const, analysis: { caption: `Photo ${index}` } }])),
      soundtrackIds: new Set(),
      generateStructured: async () => ({ clips: moments.map(({ id }) => ({ candidateId: `${id}#still@c0`, holdSec: 1.2, transition: "cut", audio: "mute" })), musicCues: [] }),
    });
    if (!result.ok) throw new Error(result.reasons.join("; "));
    expect(result.timeline.durationSec).toBeCloseTo(20, 0);
  });

  it.each([
    [3, { tender: 12, reflective: 12, playful: 12, energetic: 12, celebratory: 12 }, "short", 12],
    [6, { tender: 24, reflective: 24, playful: 24, energetic: 24, celebratory: 24 }, "short", 20],
    [10, { tender: 36, reflective: 34, playful: 30, energetic: 30, celebratory: 31 }, "30s", 20],
    [12, { tender: 44, reflective: 42, playful: 38, energetic: 38, celebratory: 39 }, "30s", 20],
  ] as const)("uses v2 clip capacity for %i photos", async (photoCount, capacities, recommendation, shortSeconds) => {
    const moments = Array.from({ length: photoCount }, (_, i) => ({ id: `m${i}`, shotId: `s${i}`, kind: "photo", title: `Photo ${i}`, description: "", rationale: "" }));
    const projectRef = {
      get: async () => ({ exists: true, get: () => "owner" }),
      collection: () => ({ doc: () => ({ get: async () => ({ exists: true, data: () => ({ moments, constraints: {}, recommendedCadence: "playful" }) }) }) }),
    };
    const db = { collection: () => ({ doc: () => projectRef }) } as unknown as Firestore;
    const app = express();
    app.use("/api/projects", directionOptionsRouter({ db, auth: (_req, res, next) => { res.locals.userId = "owner"; next(); } }));
    const response = await request(await listeningServer(app)).get("/api/projects/project-1/proposals/proposal-1/direction-options");

    expect(response.status).toBe(200);
    expect(response.body.maximumDurationSecByCadence).toMatchObject(capacities);
    expect(response.body.durations).toContainEqual(expect.objectContaining({ id: "short", seconds: shortSeconds }));
    if (Math.max(...Object.values(capacities)) >= 30) expect(response.body.durations).toContainEqual(expect.objectContaining({ id: "30s", seconds: 30 }));
    expect(response.body.recommendedDuration).toBe(recommendation);
  });
});
