import { describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { adminDb } from "../firebase/admin.js";
import { createCompose } from "../compose/wire.js";
import { startRender, setRenderProgress, markSaved, getGeneration } from "./generationStore.js";
import { dispatchDue } from "../outbox/dispatcher.js";
import { DevTaskQueue } from "../queue/devTaskQueue.js";
import { loadConfig } from "../config.js";

vi.mock("../auth/requireUser.js", () => ({
  requireUser: () => (_req: unknown, res: { locals: { userId: string } }, next: () => void) => {
    res.locals.userId = "owner";
    next();
  },
}));

const { generationsRouter } = await import("../routes/generations.js");

const SETTINGS = {
  schemaVersion: 1 as const,
  id: "settings-1",
  projectId: "",
  version: 1,
  note: "",
  cadenceId: "tender",
  soundtrackId: null,
  durationId: "30s",
  aspect: "9:16" as const,
  captions: false,
};

/** One recorded composer reply for the seeded proposal. Never a live call. */
const RECORDED = {
  clips: [
    { candidateId: "m-still#still@c0", holdSec: 4, transition: "cut", audio: "mute" },
    { candidateId: "m-clip#s0@0.15c0", transition: "cut", audio: "keep" },
  ],
  musicCues: [],
};

async function seed(): Promise<{ projectId: string; proposalId: string }> {
  const projectId = `compose-${crypto.randomUUID()}`;
  const proposalId = "proposal-1";
  const project = adminDb.doc(`projects/${projectId}`);
  await project.set({ id: projectId, userId: "owner", status: "ready", mode: "memory", createdAt: 1 });

  const batch = adminDb.batch();
  batch.set(project.collection("assets").doc("asset-still"), {
    id: "asset-still", projectId, userId: "owner", generation: "1", status: "understood",
    storagePath: `uploads/owner/${projectId}/s/still.jpg`, fileName: "still.jpg", transcript: null,
    derivatives: { thumbPath: "d/still-thumb.jpg", renderPath: "d/still-render.jpg", proxyPath: null },
  });
  batch.set(project.collection("assets").doc("asset-clip"), {
    id: "asset-clip", projectId, userId: "owner", generation: "1", status: "understood",
    storagePath: `uploads/owner/${projectId}/s/clip.mp4`, fileName: "clip.mp4",
    transcript: [{ startSec: 6, endSec: 9, text: "It rained the whole way." }],
    derivatives: { thumbPath: "d/clip-thumb.jpg", proxyPath: "d/clip-proxy.mp4", renderPath: null },
  });
  batch.set(project.collection("shots").doc("shot-still"), {
    assetId: "asset-still", assetGeneration: "1", sourceStartSec: null, sourceEndSec: null,
    analysis: { kind: "photo", caption: "Wet tent", subjects: [], setting: "campsite", activities: [], mood: "wry", shotType: "wide", aesthetics: 3, keyMomentScore: 4, tags: [] },
  });
  batch.set(project.collection("shots").doc("shot-clip"), {
    assetId: "asset-clip", assetGeneration: "1", sourceStartSec: 0, sourceEndSec: 14,
    analysis: { kind: "video", description: "Packing up in the rain", camera: "handheld", role: "A_ROLL", subjects: [], emotion: "amused", quality: 0.8, usable: true, reason: "" },
  });
  batch.set(project.collection("storyProposals").doc(proposalId), {
    schemaVersion: 1, id: proposalId, projectId, storyIntentId: "intent-1", parentProposalId: null,
    state: "accepted", version: 1, title: "The wet weekend",
    moments: [
      { id: "m-still", shotId: "shot-still", kind: "photo", title: "The tent", description: "", rationale: "" },
      { id: "m-clip", shotId: "shot-clip", kind: "video", previewInSec: 0, previewOutSec: 14, title: "Packing up", description: "", rationale: "" },
    ],
    chapters: [{ id: "ch-1", title: "Rain", summary: "All of it", momentIds: ["m-still", "m-clip"] }],
    constraints: { excludedShotIds: [], deselectedMomentIds: [], mustIncludeMomentIds: [], feedback: [] },
    openQuestions: [],
  });
  await batch.commit();
  return { projectId, proposalId };
}

function buildApp(projectId: string): express.Express {
  const app = express();
  app.use(express.json());
  app.use("/api/projects", generationsRouter({ db: adminDb, dispatch: async () => undefined }));
  void projectId;
  return app;
}

/**
 * `dispatchDue` claims across the whole `taskOutbox` collection group, so a
 * record this test leaves pending is work every other emulator suite's
 * dispatcher will try to deliver. A test that does not dispatch its own task
 * retires it instead of leaving it for someone else.
 */
async function requestGeneration(projectId: string, proposalId: string, dispatch = false): Promise<string> {
  const res = await request(buildApp(projectId))
    .post(`/api/projects/${projectId}/generations`)
    .send({ proposalId, settings: { ...SETTINGS, projectId } });
  expect(res.status).toBe(201);
  if (!dispatch) await retireTasks(projectId);
  return res.body.generation.id as string;
}

async function retireTasks(projectId: string): Promise<void> {
  const outbox = adminDb.collection(`projects/${projectId}/taskOutbox`);
  const snaps = await outbox.get();
  await Promise.all(snaps.docs.map((doc) => doc.ref.update({ state: "delivered", leaseUntil: null })));
}

/** Deliver only this project's tasks, so a shared emulator cannot skew the count. */
async function deliverOwnTasks(projectId: string, queue: DevTaskQueue): Promise<string[]> {
  const before = await adminDb.collection(`projects/${projectId}/taskOutbox`).get();
  await dispatchDue(adminDb, queue, Date.now());
  const after = await adminDb.collection(`projects/${projectId}/taskOutbox`).get();
  const delivered = after.docs.filter((doc) => doc.get("state") === "delivered").map((doc) => doc.id);
  expect(before.docs.length).toBeGreaterThan(0);
  return delivered;
}

const pointers = async (projectId: string): Promise<Record<string, string | null>> => {
  const snap = await adminDb.doc(`projects/${projectId}`).get();
  return {
    latestRequested: snap.get("latestRequestedGenerationId") ?? null,
    currentPlayable: snap.get("currentPlayableGenerationId") ?? null,
    saved: snap.get("savedGenerationId") ?? null,
  };
};

describe("compose flow (emulator)", () => {
  it("carries an accepted proposal to a saved film and moves each pointer in turn", async () => {
    const { projectId, proposalId } = await seed();

    const generationId = await requestGeneration(projectId, proposalId, true);
    expect(await pointers(projectId)).toEqual({ latestRequested: generationId, currentPlayable: null, saved: null });

    // The request wrote a real outbox task, in the shape and place the
    // dispatcher reads. A record anywhere else is written and never delivered.
    const compose = vi.fn(createCompose({ db: adminDb, generateStructured: async () => RECORDED }));
    const queue = new DevTaskQueue({ ingest: vi.fn(), understand: vi.fn(), cluster: vi.fn(), compose });
    expect(await deliverOwnTasks(projectId, queue)).toHaveLength(1);
    expect(compose).toHaveBeenCalledWith({ projectId, generationId });

    const composed = await getGeneration(adminDb, "owner", projectId, generationId);
    expect(composed?.status).toBe("playable");
    expect(composed?.timeline?.videoClips).toHaveLength(2);
    // The clips name shots, not moments or candidates: the renderer resolves
    // these to files and a moment id is not something it can resolve.
    expect(composed?.timeline?.videoClips.map((clip) => clip.source.shotId)).toEqual(["shot-still", "shot-clip"]);
    expect(await pointers(projectId)).toEqual({ latestRequested: generationId, currentPlayable: generationId, saved: null });

    const rendered = await request(buildApp(projectId))
      .post(`/api/projects/${projectId}/generations/${generationId}/render`)
      .send({});
    expect(rendered.status).toBe(202);
    // Render resolves through the shot to the asset's original file.
    expect(rendered.body.sources["shot-clip"]).toBe(`uploads/owner/${projectId}/s/clip.mp4`);
    expect((await getGeneration(adminDb, "owner", projectId, generationId))?.status).toBe("rendering");
    await retireTasks(projectId);
    expect(await pointers(projectId)).toEqual({ latestRequested: generationId, currentPlayable: generationId, saved: null });

    const outputPath = `renders/owner/${projectId}/${generationId}.mp4`;
    await setRenderProgress(adminDb, { userId: "owner", projectId, generationId, progress: 1 });
    await markSaved(adminDb, { userId: "owner", projectId, generationId, outputPath });

    const saved = await getGeneration(adminDb, "owner", projectId, generationId);
    expect(saved?.status).toBe("saved");
    expect(saved?.outputPath).toBe(outputPath);
    expect(await pointers(projectId)).toEqual({ latestRequested: generationId, currentPlayable: generationId, saved: generationId });
  });

  it("leaves every pointer where it was when a second generation fails", async () => {
    const { projectId, proposalId } = await seed();

    const first = await requestGeneration(projectId, proposalId, true);
    const good = new DevTaskQueue({ ingest: vi.fn(), understand: vi.fn(), cluster: vi.fn(), compose: createCompose({ db: adminDb, generateStructured: async () => RECORDED }) });
    await deliverOwnTasks(projectId, good);
    await retireTasks(projectId);
    await startRender(adminDb, { userId: "owner", projectId, generationId: first });
    await setRenderProgress(adminDb, { userId: "owner", projectId, generationId: first, progress: 1 });
    await markSaved(adminDb, { userId: "owner", projectId, generationId: first, outputPath: "renders/first.mp4" });
    const before = await pointers(projectId);
    expect(before).toEqual({ latestRequested: first, currentPlayable: first, saved: first });

    // The second attempt gets a reply whose every pick is unknown, so assemble
    // drops all of them and no film is possible.
    const second = await requestGeneration(projectId, proposalId, true);
    const bad = new DevTaskQueue({
      ingest: vi.fn(), understand: vi.fn(), cluster: vi.fn(),
      compose: createCompose({ db: adminDb, generateStructured: async () => ({ clips: [{ candidateId: "invented", transition: "cut", audio: "keep" }], musicCues: [] }) }),
    });
    await deliverOwnTasks(projectId, bad);

    const failed = await getGeneration(adminDb, "owner", projectId, second);
    expect(failed?.status).toBe("failed");
    expect(failed?.failureReasons.join(" ")).toContain("every pick was dropped");
    expect(failed?.timeline).toBeNull();

    // The request pointer follows the request; the film pointers do not move,
    // so the user keeps the film that worked.
    expect(await pointers(projectId)).toEqual({ latestRequested: second, currentPlayable: first, saved: first });
    expect((await getGeneration(adminDb, "owner", projectId, first))?.status).toBe("saved");
  });

  it("fails a compose task with a clear reason when GEMINI_API_KEY is missing", async () => {
    const { projectId, proposalId } = await seed();
    const generationId = await requestGeneration(projectId, proposalId);

    // No key, no injected transport: exactly how `index.ts` builds the composer
    // when the environment has no GEMINI_API_KEY.
    const compose = createCompose({ db: adminDb, geminiApiKey: "" });
    expect(await compose({ projectId, generationId })).toBe("failed");

    const failed = await getGeneration(adminDb, "owner", projectId, generationId);
    expect(failed?.status).toBe("failed");
    expect(failed?.failureReasons.join(" ")).toContain("gemini_api_key_missing");
    expect(await pointers(projectId)).toEqual({ latestRequested: generationId, currentPlayable: null, saved: null });
  });

  it("boots without GEMINI_API_KEY, and builds a composer that only fails on use", () => {
    vi.stubEnv("GEMINI_API_KEY", "");
    vi.stubEnv("FIREBASE_STORAGE_BUCKET", "demo-mosae.appspot.com");
    vi.stubEnv("SERVICE_URL", "http://localhost:8080");
    try {
      // Config load and composer construction are what boot does. Neither may
      // reach for the SDK, so neither can throw for want of a key.
      expect(loadConfig().geminiApiKey).toBe("");
      expect(() => createCompose({ db: adminDb, geminiApiKey: loadConfig().geminiApiKey })).not.toThrow();
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("settles a generation as failed when the composer gives up on retries", async () => {
    const { projectId, proposalId } = await seed();
    const generationId = await requestGeneration(projectId, proposalId);

    const compose = createCompose({ db: adminDb, generateStructured: async () => RECORDED });
    expect(await compose({ projectId, generationId, giveUp: "exceeded 3 compose attempts" })).toBe("failed");

    const failed = await getGeneration(adminDb, "owner", projectId, generationId);
    expect(failed?.failureReasons).toEqual(["exceeded 3 compose attempts"]);
    expect(await pointers(projectId)).toEqual({ latestRequested: generationId, currentPlayable: null, saved: null });
  });

  it("ignores a redelivered task for a generation that is already settled", async () => {
    const { projectId, proposalId } = await seed();
    const generationId = await requestGeneration(projectId, proposalId);

    const compose = createCompose({ db: adminDb, generateStructured: async () => RECORDED });
    expect(await compose({ projectId, generationId })).toBe("composed");
    const first = await getGeneration(adminDb, "owner", projectId, generationId);

    // A retry must not recompose over a published film.
    expect(await compose({ projectId, generationId })).toBe("skipped");
    expect(await getGeneration(adminDb, "owner", projectId, generationId)).toEqual(first);
  });
});
