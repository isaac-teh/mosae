import { describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { listeningServer } from "../test/listeningServer.js";
import { adminDb } from "../firebase/admin.js";
import { createCompose } from "../compose/wire.js";
import { startRender, getGeneration } from "./generationStore.js";
import { createRender, type RenderEvent } from "../render/dispatchRender.js";
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
  const res = await request(await listeningServer(buildApp(projectId)))
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

/**
 * The render leg, with the one thing that cannot run in a test stubbed: the
 * HTTP call to `mosae-render`. Everything else is the production path — the
 * outbox record, the dispatcher, `/tasks/render`'s handler, source resolution,
 * throttled progress and the store transitions.
 */
function renderLeg(events: RenderEvent[]): (task: { projectId: string; generationId: string; giveUp?: string }) => Promise<unknown> {
  return createRender({
    db: adminDb,
    renderServiceUrl: "http://render.test",
    sources: {
      loadAsset: async (projectId, shotId) => {
        const project = adminDb.collection("projects").doc(projectId);
        const shot = await project.collection("shots").doc(shotId).get();
        if (!shot.exists) return null;
        const asset = await project.collection("assets").doc(shot.get("assetId") as string).get();
        if (!asset.exists) return null;
        return { storagePath: asset.get("storagePath") as string, derivatives: asset.get("derivatives") };
      },
    },
    post: async function* () {
      for (const event of events) yield event;
    },
  });
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
  it("auto-enqueues a render when compose succeeds, so the film is rendering", async () => {
    const { projectId, proposalId } = await seed();

    const generationId = await requestGeneration(projectId, proposalId, true);
    const afterRenderEnqueued = vi.fn();
    const queue = new DevTaskQueue({ ingest: vi.fn(), understand: vi.fn(), cluster: vi.fn(), compose: createCompose({ db: adminDb, generateStructured: async () => RECORDED, afterRenderEnqueued }) });
    expect(await deliverOwnTasks(projectId, queue)).toHaveLength(1);
    // The local runner drains only on events; this hook is how the render task
    // compose just wrote gets delivered at all.
    expect(afterRenderEnqueued).toHaveBeenCalledTimes(1);

    // Compose success moves the generation to playable and immediately enqueues
    // a render: the film is `rendering` with a real `taskOutbox` record in the
    // shape the dispatcher reads. No Save was pressed — this is Task 7's ruling.
    const composed = await getGeneration(adminDb, "owner", projectId, generationId);
    expect(composed?.status).toBe("rendering");

    // The compose task is delivered but still in the collection; only its render
    // sibling is what Task 7's ruling just wrote. Filter by stage so the count
    // names that one record, not every outbox doc for the project.
    const renderTask = await adminDb.collection(`projects/${projectId}/taskOutbox`).get();
    const renders = renderTask.docs.filter((doc) => doc.get("stage") === "render");
    expect(renders.length).toBe(1);
    const taskDoc = renders[0].data();
    expect(taskDoc.stage).toBe("render");
    expect(taskDoc.subjectId).toBe(generationId);

    // The render task is still pending — the dispatcher picks it up on its own.
    expect(renderTask.docs.every((doc) => doc.get("state") === "delivered" || doc.get("state") === "pending")).toBe(true);
  });

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

    // Compose success already enqueued a render (Task 7's ruling), so the film
    // is `rendering` with a real `taskOutbox` record in the shape the dispatcher
    // reads. No Save was pressed — this is what makes Save consistent with auto-rendering.
    const composed = await getGeneration(adminDb, "owner", projectId, generationId);
    expect(composed?.status).toBe("rendering");
    expect(await pointers(projectId)).toEqual({ latestRequested: generationId, currentPlayable: generationId, saved: null });

    // The render task the compose wrote is delivered the same way the compose task
    // was, through the real dispatcher to the real render leg. Calling
    // `setRenderProgress` and `markSaved` from the test instead would
    // manufacture by hand a state the system could not reach: until this
    // existed, `/tasks/render` was a 404 and the film was stuck at `rendering`
    // forever.
    const outputPath = `renders/owner/${projectId}/${generationId}.mp4`;
    const render = vi.fn(renderLeg([{ progress: 0.5 }, { done: true, outputPath: "/tmp/out.mp4", durationInFrames: 500 }]));
    const renderQueue = new DevTaskQueue({ ingest: vi.fn(), understand: vi.fn(), cluster: vi.fn(), render });
    // Two tasks delivered in total: the compose task and its auto-enqueued render.
    expect(await deliverOwnTasks(projectId, renderQueue)).toHaveLength(2);
    expect(render).toHaveBeenCalledWith({ projectId, generationId });

    const saved = await getGeneration(adminDb, "owner", projectId, generationId);
    expect(saved?.status).toBe("saved");
    expect(saved?.outputPath).toBe(outputPath);
    expect(saved?.renderProgress).toBe(1);
    expect(await pointers(projectId)).toEqual({ latestRequested: generationId, currentPlayable: generationId, saved: generationId });

    const download = await request(await listeningServer(buildApp(projectId))).get(`/api/projects/${projectId}/generations/${generationId}/download`);
    // The download route gets past its status gate now; only the signing itself
    // is beyond an emulator without a service-account key.
    expect(download.status).not.toBe(400);
  });

  it("gives the film back playable when the render fails, so Save can be pressed again", async () => {
    // The whole of C1's recovery path. `startRender` accepts only a `playable`
    // film, so a generation abandoned in `rendering` could never be rendered or
    // retried: pressing Save once bricked the film.
    const { projectId, proposalId } = await seed();
    const generationId = await requestGeneration(projectId, proposalId, true);
    const queue = new DevTaskQueue({ ingest: vi.fn(), understand: vi.fn(), cluster: vi.fn(), compose: createCompose({ db: adminDb, generateStructured: async () => RECORDED }) });
    await deliverOwnTasks(projectId, queue);

    await request(await listeningServer(buildApp(projectId))).post(`/api/projects/${projectId}/generations/${generationId}/render`).send({});
    const failing = new DevTaskQueue({
      ingest: vi.fn(), understand: vi.fn(), cluster: vi.fn(),
      render: renderLeg([{ progress: 0.3 }, { error: "render_failed", detail: "chromium died" }]),
    });
    await deliverOwnTasks(projectId, failing);

    const given = await getGeneration(adminDb, "owner", projectId, generationId);
    expect(given?.status).toBe("playable");
    expect(given?.renderProgress).toBe(0);
    expect(given?.failureReasons.join(" ")).toContain("chromium died");
    // The film still works, so no pointer moves.
    expect(await pointers(projectId)).toEqual({ latestRequested: generationId, currentPlayable: generationId, saved: null });

    // And it can be asked for again, which is the point.
    const retry = await request(await listeningServer(buildApp(projectId))).post(`/api/projects/${projectId}/generations/${generationId}/render`).send({});
    expect(retry.status).toBe(202);
    await retireTasks(projectId);
  });

  it("leaves every pointer where it was when a second generation fails", async () => {
    const { projectId, proposalId } = await seed();

    const first = await requestGeneration(projectId, proposalId, true);
    const good = new DevTaskQueue({ ingest: vi.fn(), understand: vi.fn(), cluster: vi.fn(), compose: createCompose({ db: adminDb, generateStructured: async () => RECORDED }) });
    await deliverOwnTasks(projectId, good);
    // Compose success auto-enqueued a render (Task 7's ruling), so the film is
    // `rendering` with a real taskOutbox record. Saved through the real render leg,
    // not by hand — delivering that enqueued task rather than calling startRender,
    // which refuses anything but a playable generation.
    const outputPath = `renders/owner/${projectId}/${first}.mp4`;
    const render = vi.fn(renderLeg([{ done: true, outputPath: "/tmp/first.mp4", durationInFrames: 1 }]));
    const renderQueue = new DevTaskQueue({ ingest: vi.fn(), understand: vi.fn(), cluster: vi.fn(), render });
    // Both the compose task and its auto-enqueued render are delivered through the queue.
    expect(await deliverOwnTasks(projectId, renderQueue)).toHaveLength(2);
    expect(render).toHaveBeenCalledWith({ projectId, generationId: first });
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
