import express from "express";
import type { RequestHandler } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { adminDb } from "../firebase/admin.js";
import type { PhotoAnalysis } from "../domain/understanding.js";

const USER_ID = "character-picker-owner";
const auth: RequestHandler = (_req, res, next) => {
  res.locals.userId = USER_ID;
  next();
};

function photoShot(shotId: string, faces: PhotoAnalysis["faces"]): PhotoAnalysis {
  return { kind: "photo", caption: "", subjects: [], setting: "", activities: [], mood: "", shotType: "", aesthetics: 0, keyMomentScore: 0, tags: [], faces };
}

const face = (faceId: string): NonNullable<PhotoAnalysis["faces"]>[number] => ({ faceId, bbox: [0.1, 0.2, 0.3, 0.4], confidence: 1 });

async function seedProject(userId = USER_ID) {
  const projectId = `route-${crypto.randomUUID()}`;
  await adminDb.doc(`projects/${projectId}`).set({ id: projectId, userId, status: "understood", createdAt: 1 });
  return projectId;
}

function photo(projectId: string, shotId: string, faces: PhotoAnalysis["faces"]) {
  return adminDb.doc(`projects/${projectId}/shots/${shotId}`).set({ id: shotId, assetId: shotId, index: 0, analysis: photoShot(shotId, faces) });
}

async function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/projects", (await import("./directing.js")).directingRouter({ db: adminDb, now: () => 42, newId: () => "intent-new", auth, queuePlan: vi.fn() }));
  return app;
}

async function listen(app: express.Express) {
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const { port } = server.address() as import("net").AddressInfo;
  return { url: `http://127.0.0.1:${port}`, close: () => new Promise<void>((resolve) => server.close(() => resolve())) };
}

/**
 * A complete, schema-valid proposal. The constraints route re-parses what it
 * reads with a strict schema, so a partial stand-in would fail for the wrong
 * reason.
 */
async function seedProposal(projectId: string) {
  const id = "proposal-1";
  await adminDb.doc(`projects/${projectId}/storyProposals/${id}`).set({
    schemaVersion: 1,
    id,
    projectId,
    storyIntentId: "intent-1",
    parentProposalId: null,
    version: 1,
    state: "accepted",
    title: "A Day Out",
    moments: [
      { id: `${id}-moment-0`, shotId: "shot-1", kind: "photo", title: "Arrival", description: "At the gate.", rationale: "Opens the day." },
      { id: `${id}-moment-1`, shotId: "shot-2", kind: "photo", title: "Lunch", description: "Around the table.", rationale: "Brings everyone together." },
    ],
    chapters: [{ id: `${id}-chapter-0`, title: "The Day", summary: "Start to finish.", momentIds: [`${id}-moment-0`, `${id}-moment-1`] }],
    constraints: { excludedShotIds: [], deselectedMomentIds: [`${id}-moment-1`], mustIncludeMomentIds: [], feedback: [] },
    openQuestions: [],
    jobId: "job-1",
    createdAt: 1,
  });
  await adminDb.doc(`projects/${projectId}`).update({ currentProposalId: id, proposalVersionCounter: 1 });
  return id;
}

describe("character picker routes", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns every photo-face grouped by shot with null identity when unassigned", async () => {
    const projectId = await seedProject();
    await photo(projectId, "shot-1", [face("shot-1-f0"), face("shot-1-f1")]);
    await photo(projectId, "shot-2", [face("shot-2-f0")]);

    const { url, close } = await listen(await buildApp());
    try {
      const res = await fetch(`${url}/api/projects/${projectId}/characters`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as { shots: Array<{ shotId: string; faces: Array<{ faceId: string; characterId: unknown; name: unknown; role: unknown }> }> };
      expect(body.shots.map((s) => s.shotId)).toEqual(["shot-1", "shot-2"]);
      expect(body.shots.find((s) => s.shotId === "shot-1")!.faces).toHaveLength(2);
      expect(body.shots.find((s) => s.shotId === "shot-1")!.faces[0]).toMatchObject({ faceId: "shot-1-f0", characterId: null, name: null, role: null });
    } finally {
      await close();
    }
  });

  it("assigns a character via POST and returns the updated face", async () => {
    const projectId = await seedProject();
    await photo(projectId, "shot-1", [face("shot-1-f0")]);

    const { url, close } = await listen(await buildApp());
    try {
      const res = await fetch(`${url}/api/projects/${projectId}/shots/shot-1/characters`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ faceId: "shot-1-f0", name: "Alice" }),
      });
      expect(res.status).toBe(201);
      const body = (await res.json()) as { face: { name: string; characterId: string } };
      expect(body.face.name).toBe("Alice");
      expect(body.face.characterId).toBe(`char-${projectId}-alice`);

      const read = await fetch(`${url}/api/projects/${projectId}/characters`);
      const readBody = (await read.json()) as { shots: Array<{ faces: Array<{ characterId: unknown; name: unknown }> }> };
      expect(readBody.shots[0].faces[0]).toMatchObject({ characterId: `char-${projectId}-alice`, name: "Alice" });
    } finally {
      await close();
    }
  });

  it("rejects an empty body with invalid_assignment", async () => {
    const projectId = await seedProject();
    await photo(projectId, "shot-1", [face("shot-1-f0")]);

    const { url, close } = await listen(await buildApp());
    try {
      const res = await fetch(`${url}/api/projects/${projectId}/shots/shot-1/characters`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "invalid_assignment" });
    } finally {
      await close();
    }
  });

  it("rejects an invalid role with invalid_assignment", async () => {
    const projectId = await seedProject();
    await photo(projectId, "shot-1", [face("shot-1-f0")]);

    const { url, close } = await listen(await buildApp());
    try {
      const res = await fetch(`${url}/api/projects/${projectId}/shots/shot-1/characters`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ faceId: "shot-1-f0", name: "Bob", role: "LEAD" }),
      });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "invalid_assignment" });
    } finally {
      await close();
    }
  });

  /**
   * The GET route above renders an unassigned face as `role: null`, and the
   * picker seeds its editor straight from that value. A user who names a face
   * without also choosing a role therefore posts `role: null` — which this
   * route used to reject, failing every roleless save with a silent 400.
   */
  it("accepts a null role, which is what its own GET route emits", async () => {
    const projectId = await seedProject();
    await photo(projectId, "shot-1", [face("shot-1-f0")]);

    const { url, close } = await listen(await buildApp());
    try {
      const res = await fetch(`${url}/api/projects/${projectId}/shots/shot-1/characters`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ faceId: "shot-1-f0", name: "Mom", role: null }),
      });
      expect(res.status).toBe(201);
      const body = (await res.json()) as { face: { name: string; role?: unknown } };
      expect(body.face.name).toBe("Mom");
      expect(body.face.role).toBeUndefined();
    } finally {
      await close();
    }
  });

  it("returns not_found for a project the requesting user does not own", async () => {
    const projectId = await seedProject(USER_ID);
    await photo(projectId, "shot-1", [face("shot-1-f0")]);

    // Auth middleware injects USER_ID; request as someone else by swapping it.
    const app = await buildApp();
    const server = app.listen(0);
    await new Promise<void>((resolve) => server.once("listening", resolve));
    try {
      const { port } = server.address() as import("net").AddressInfo;
      // Point the route at a project owned by another user.
      const otherId = `other-${crypto.randomUUID()}`;
      await adminDb.doc(`projects/${otherId}`).set({ id: otherId, userId: "someone-else", status: "understood", createdAt: 1 });
      const res = await fetch(`http://127.0.0.1:${port}/api/projects/${otherId}/characters`);
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: "not_found" });
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
  /**
   * The picker patches only `focusCharacterIds` when the user continues. The
   * moment lists it leaves out must survive that write, or naming a main
   * character would silently clear whatever the user had already deselected.
   */
  it("patches focus characters without disturbing the moment constraints", async () => {
    const projectId = await seedProject();
    const proposalId = await seedProposal(projectId);

    const { url, close } = await listen(await buildApp());
    try {
      const res = await fetch(`${url}/api/projects/${projectId}/proposals/${proposalId}/constraints`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ focusCharacterIds: ["char-mom"] }),
      });
      expect(res.status).toBe(201);
      const body = (await res.json()) as { proposal: { constraints: Record<string, unknown> } };
      expect(body.proposal.constraints).toMatchObject({
        focusCharacterIds: ["char-mom"],
        // Untouched by a focus-only patch.
        deselectedMomentIds: [`${proposalId}-moment-1`],
        mustIncludeMomentIds: [],
      });
    } finally {
      await close();
    }
  });
});
