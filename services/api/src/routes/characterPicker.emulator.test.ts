import express from "express";
import type { RequestHandler } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { adminDb } from "../firebase/admin.js";
import type { PhotoAnalysis } from "../domain/understanding.js";
import { buildDerivativePath } from "../domain/ids.js";

const USER_ID = "character-picker-owner";
const auth: RequestHandler = (_req, res, next) => {
  res.locals.userId = USER_ID;
  next();
};

function photoShot(shotId: string, faces: PhotoAnalysis["faces"]): PhotoAnalysis {
  return { kind: "photo", caption: "", subjects: [], setting: "", activities: [], mood: "", shotType: "", aesthetics: 0, keyMomentScore: 0, tags: [], ...(faces ? { faces } : {}) };
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
  app.use("/api/projects", (await import("./directing.js")).directingRouter({
    db: adminDb, now: () => 42, newId: () => "intent-new", auth, queuePlan: vi.fn(),
    thumbnails: { signedReadUrl: async (path) => `signed:${path}` },
  }));
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
    constraints: { excludedShotIds: [], deselectedMomentIds: [`${id}-moment-1`], mustIncludeMomentIds: [], feedback: [], hiddenShotIds: [], momentOrder: [], photoSwaps: {} },
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

  it("returns a successful null cast until planning creates the cast document", async () => {
    const projectId = await seedProject();
    const { url, close } = await listen(await buildApp());
    try {
      const res = await fetch(`${url}/api/projects/${projectId}/cast`);
      expect(res.status).toBe(200);
      await expect(res.json()).resolves.toEqual({ cast: null });
    } finally {
      await close();
    }
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

  it("adds manual moment tags for a new person and removes a detected person from a shot", async () => {
    const projectId = await seedProject();
    await photo(projectId, "shot-1", [{ ...face("face-old"), characterId: "old" }]);
    await photo(projectId, "shot-2", []);
    await adminDb.doc(`projects/${projectId}/cast/current`).set({ people: [{ personId: "old", name: "Mia", role: "child", ageBand: "child", appearances: 1, subjectCount: 1, faceIds: ["face-old"], confidence: "high" }], core: ["old"], focus: ["old"], source: "embeddings" });
    const { url, close } = await listen(await buildApp());
    try {
      const res = await fetch(`${url}/api/projects/${projectId}/cast`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ people: [
        { personId: "old", name: "Mia", role: "child", removeShots: ["shot-1"] },
        { personId: "p-manual-grandma", name: "Grandma", role: "other", addShots: ["shot-2"] },
      ], focus: [] }) });
      expect(res.status).toBe(200);
      const body = await res.json() as { cast: { people: Array<{ personId: string; manualShots?: string[]; removedShots?: string[] }> } };
      expect(body.cast.people.find((person) => person.personId === "p-manual-grandma")).toMatchObject({ manualShots: ["shot-2"], removedShots: [] });
      expect(body.cast.people.find((person) => person.personId === "old")?.removedShots).toEqual(["shot-1"]);
      const saved = await adminDb.doc(`projects/${projectId}/shots/shot-1`).get();
      expect((saved.get("analysis") as PhotoAnalysis).faces?.[0]?.characterId).toBeUndefined();
    } finally { await close(); }
  });

  it("merges people by moving all face identities into the retained cast person", async () => {
    const projectId = await seedProject();
    await photo(projectId, "shot-1", [{ ...face("first-face"), characterId: "first" }, { ...face("second-face"), characterId: "second" }]);
    await adminDb.doc(`projects/${projectId}/cast/current`).set({
      people: ["first", "second"].map((personId) => ({ personId, name: "My daughter", role: "child", ageBand: "child", appearances: 1, subjectCount: 1, faceIds: [`${personId}-face`], confidence: "high" })),
      core: ["first", "second"], focus: ["first"], source: "embeddings",
    });
    const { url, close } = await listen(await buildApp());
    try {
      const res = await fetch(`${url}/api/projects/${projectId}/cast`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({
        people: [{ personId: "first", name: "My daughter", role: "child" }], focus: ["first"], merges: [{ fromPersonId: "second", toPersonId: "first" }],
      }) });
      expect(res.status).toBe(200);
      const body = await res.json() as { cast: { people: Array<{ personId: string; faceIds: string[] }> } };
      expect(body.cast.people).toHaveLength(1);
      expect(body.cast.people[0]).toMatchObject({ personId: "first", faceIds: ["first-face", "second-face"] });
      const saved = await adminDb.doc(`projects/${projectId}/shots/shot-1`).get();
      expect((saved.get("analysis") as PhotoAnalysis).faces?.map((f) => f.characterId)).toEqual(["first", "first"]);
    } finally { await close(); }
  });

  it("gets and confirms the cast, moves a face, and recomputes empty focus", async () => {
    const projectId = await seedProject();
    await photo(projectId, "shot-1", [
      { ...face("kid-face"), bbox: [0.2, 0.3, 0.7, 0.7], characterId: "kid" },
      { ...face("dad-face"), bbox: [0.05, 0.9, 0.12, 0.97], characterId: "dad" },
    ]);
    await adminDb.doc(`projects/${projectId}/cast/current`).set({
      people: [
        { personId: "dad", role: "parent", ageBand: "adult", appearances: 1, subjectCount: 0, faceIds: ["dad-face"], confidence: "high" },
        { personId: "mom", role: "parent", ageBand: "adult", appearances: 0, subjectCount: 0, faceIds: [], confidence: "high" },
        { personId: "kid", role: "child", ageBand: "child", appearances: 1, subjectCount: 1, faceIds: ["kid-face"], confidence: "high" },
      ], core: ["dad", "mom", "kid"], focus: ["kid"], source: "labelled",
    });
    const { url, close } = await listen(await buildApp());
    try {
      const get = await fetch(`${url}/api/projects/${projectId}/cast`);
      expect(get.status).toBe(200);
      const res = await fetch(`${url}/api/projects/${projectId}/cast`, {
        method: "PUT", headers: { "content-type": "application/json" },
        body: JSON.stringify({
          people: [
            { personId: "dad", role: "parent", excluded: true },
            { personId: "mom", role: "parent" },
            { personId: "kid", role: "child" },
          ], focus: [], moves: [{ faceId: "dad-face", personId: "mom" }],
        }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { cast: { confirmed: boolean; focus: string[]; people: Array<{ personId: string; excluded?: boolean }> } };
      expect(body.cast).toMatchObject({ confirmed: true, focus: ["kid"] });
      expect(body.cast.people.find((person) => person.personId === "dad")?.excluded).toBe(true);
      expect(((await adminDb.doc(`projects/${projectId}/shots/shot-1`).get()).get("analysis") as PhotoAnalysis).faces?.[1]?.characterId).toBe("mom");
    } finally { await close(); }
  });

  it("applies a confirmed leave-out to the current plan without a model call", async () => {
    const projectId = await seedProject();
    const proposalId = await seedProposal(projectId);
    const big: [number, number, number, number] = [0.2, 0.3, 0.7, 0.7];
    const small: [number, number, number, number] = [0.05, 0.9, 0.12, 0.97];
    // shot-1: dad alone (left out once he is excluded). shot-2: the child with dad far behind (kept).
    await photo(projectId, "shot-1", [{ faceId: "shot-1-0", bbox: big, confidence: 1, characterId: "dad" }]);
    await photo(projectId, "shot-2", [
      { faceId: "shot-2-0", bbox: big, confidence: 1, characterId: "kid" },
      { faceId: "shot-2-1", bbox: small, confidence: 1, characterId: "dad" },
    ]);
    const person = (personId: string, role: string) => ({ personId, role, ageBand: role === "child" ? "child" : "adult", appearances: 1, subjectCount: 1, faceIds: [], confidence: "high" });
    await adminDb.doc(`projects/${projectId}/cast/current`).set({ people: [person("dad", "parent"), person("kid", "child")], core: ["dad", "kid"], focus: ["kid"], source: "labelled" });
    const { url, close } = await listen(await buildApp());
    try {
      const res = await fetch(`${url}/api/projects/${projectId}/cast`, {
        method: "PUT", headers: { "content-type": "application/json" },
        body: JSON.stringify({ people: [{ personId: "dad", role: "parent", excluded: true }, { personId: "kid", role: "child" }], focus: [], proposalId }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { proposalId: string };
      expect(body.proposalId).not.toBe(proposalId);
      const next = (await adminDb.doc(`projects/${projectId}/storyProposals/${body.proposalId}`).get()).data()!;
      // The seed had moment-1 deselected by the user; that choice is kept, and
      // dad's solo photo (moment-0) is now deselected with its reason.
      expect(next.constraints.deselectedMomentIds.sort()).toEqual([`${proposalId}-moment-0`, `${proposalId}-moment-1`]);
      expect(next.constraints.focusCharacterIds).toEqual(["kid"]);
      expect(next.leftOut).toEqual([{ shotId: "shot-1", reason: "Left out: someone you left out is the main subject." }]);

      // Bringing dad back returns his photo; the user's own deselection stays.
      const back = await fetch(`${url}/api/projects/${projectId}/cast`, {
        method: "PUT", headers: { "content-type": "application/json" },
        body: JSON.stringify({ people: [{ personId: "dad", role: "parent" }, { personId: "kid", role: "child" }], focus: ["kid"], proposalId: body.proposalId }),
      });
      const again = (await adminDb.doc(`projects/${projectId}/storyProposals/${((await back.json()) as { proposalId: string }).proposalId}`).get()).data()!;
      expect(again.constraints.deselectedMomentIds).toEqual([`${proposalId}-moment-1`]);
      expect(again.leftOut).toEqual([]);
    } finally {
      await close();
    }
  });

  it("keeps ingestion blur and duplicate results after confirming the cast", async () => {
    const projectId = await seedProject();
    const proposalId = await seedProposal(projectId);
    await photo(projectId, "shot-1", []);
    await adminDb.doc(`projects/${projectId}/shots/shot-1`).update({ analysis: photoShot("shot-1", undefined) });
    await photo(projectId, "shot-2", []);
    await adminDb.doc(`projects/${projectId}/assets/shot-1`).set({ quality: { blurry: true } });
    await adminDb.doc(`projects/${projectId}/assets/shot-2`).set({ dupOf: "primary" });
    await adminDb.doc(`projects/${projectId}/cast/current`).set({ people: [], core: [], focus: [], source: "labelled" });
    const { url, close } = await listen(await buildApp());
    try {
      const res = await fetch(`${url}/api/projects/${projectId}/cast`, {
        method: "PUT", headers: { "content-type": "application/json" },
        body: JSON.stringify({ people: [], focus: [], proposalId }),
      });
      expect(res.status).toBe(200);
      const body = await res.json() as { proposalId: string };
      const next = (await adminDb.doc(`projects/${projectId}/storyProposals/${body.proposalId}`).get()).data()!;
      expect(next.leftOut).toEqual([
        { shotId: "shot-1", reason: "Blurry photo." },
        { shotId: "shot-2", reason: "Near-duplicate: kept the sharpest photo in this burst." },
      ]);
    } finally { await close(); }
  });

  it("rejects a focus that includes an excluded person", async () => {
    const projectId = await seedProject();
    await adminDb.doc(`projects/${projectId}/cast/current`).set({
      people: [{ personId: "dad", role: "parent", ageBand: "adult", appearances: 0, subjectCount: 0, faceIds: [], confidence: "high" }],
      core: ["dad"], focus: [], source: "labelled",
    });
    const { url, close } = await listen(await buildApp());
    try {
      const res = await fetch(`${url}/api/projects/${projectId}/cast`, {
        method: "PUT", headers: { "content-type": "application/json" },
        body: JSON.stringify({ people: [{ personId: "dad", role: "parent", excluded: true }], focus: ["dad"] }),
      });
      expect(res.status).toBe(400);
    } finally { await close(); }
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

  it("patches review edits, restores old constraints on undo, and lists same-event alternatives", async () => {
    const projectId = await seedProject();
    const proposalId = await seedProposal(projectId);
    const assets = adminDb.collection(`projects/${projectId}/assets`);
    await assets.doc("shot-1").set({ id: "shot-1", generation: "1", eventId: "burst-a" });
    await assets.doc("shot-2").set({ id: "shot-2", generation: "1", eventId: "burst-b" });
    const thumbPath = buildDerivativePath({ userId: USER_ID, projectId, assetId: "shot-9", generation: "1" }, "thumb.jpg");
    await assets.doc("shot-9").set({ id: "shot-9", generation: "1", eventId: "burst-a", derivatives: { thumbPath } });
    await adminDb.doc(`projects/${projectId}/shots/shot-1`).set({ id: "shot-1", assetId: "shot-1", assetGeneration: "1" });
    await adminDb.doc(`projects/${projectId}/shots/shot-9`).set({ id: "shot-9", assetId: "shot-9", assetGeneration: "1" });

    const { url, close } = await listen(await buildApp());
    try {
      const patch = async (id: string, body: unknown) => fetch(`${url}/api/projects/${projectId}/proposals/${id}/constraints`, {
        method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
      });
      const editedResponse = await patch(proposalId, { hiddenShotIds: ["shot-1"] });
      expect(editedResponse.status).toBe(201);
      const edited = (await editedResponse.json() as { proposal: { id: string; constraints: Record<string, unknown> } }).proposal;
      expect(edited.constraints).toMatchObject({ hiddenShotIds: ["shot-1"], deselectedMomentIds: [`${proposalId}-moment-1`] });
      const undoneResponse = await patch(edited.id, { hiddenShotIds: [], momentOrder: [], photoSwaps: {}, deselectedMomentIds: [`${proposalId}-moment-1`], mustIncludeMomentIds: [] });
      expect(undoneResponse.status).toBe(201);
      const undone = (await undoneResponse.json() as { proposal: { constraints: Record<string, unknown> } }).proposal;
      expect(undone.constraints).toMatchObject({ hiddenShotIds: [], deselectedMomentIds: [`${proposalId}-moment-1`], mustIncludeMomentIds: [] });
      expect(undone.constraints).toEqual({ excludedShotIds: [], deselectedMomentIds: [`${proposalId}-moment-1`], mustIncludeMomentIds: [], feedback: [], hiddenShotIds: [], momentOrder: [], photoSwaps: {} });

      const alternatives = await fetch(`${url}/api/projects/${projectId}/proposals/${proposalId}/moments/${proposalId}-moment-0/alternatives`);
      expect(alternatives.status).toBe(200);
      expect(await alternatives.json()).toEqual({ shots: [{ shotId: "shot-9", thumbUrl: `signed:${thumbPath}`, kind: "photo" }] });
    } finally {
      await close();
    }
  });
});
