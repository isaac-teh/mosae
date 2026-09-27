import express from "express";
import { adminDb } from "./firebase/admin.js";
import { loadConfig } from "./config.js";
import { requireServiceCaller } from "./auth/requireServiceCaller.js";
import { projectsRouter } from "./routes/projects.js";
import { thumbnailsRouter } from "./routes/thumbnails.js";
import { firebaseDownloadUrlStore, firebaseThumbnailUrlStore } from "./ingest/objectStore.js";
import { createPlanJob, createQueuePlan, directingRouter, type QueuePlan } from "./routes/directing.js";
import { storageEventsRouter } from "./routes/storageEvents.js";
import { internalRouter } from "./routes/internal.js";
import { healthRouter } from "./routes/health.js";
import { generationsRouter } from "./routes/generations.js";
import { directionOptionsRouter } from "./routes/directionOptions.js";
import {
  CloudTasksQueue,
  InMemoryTaskQueue,
  type TaskQueue,
} from "./queue/taskQueue.js";
import { DevTaskQueue } from "./queue/devTaskQueue.js";
import { dispatchDue } from "./outbox/dispatcher.js";
import { apiCors } from "./http/cors.js";
import { settleProject } from "./store/readinessStore.js";
import { startStoragePoller } from "./store/storagePoller.js";
import { createIngest } from "./ingest/wire.js";
import { createUnderstand } from "./understand/wire.js";
import { createPlan } from "./directing/wire.js";
import { FirestoreProposalCache } from "./directing/proposalCache.js";
import { createCompose } from "./compose/wire.js";
import { createRender } from "./render/dispatchRender.js";
import { runProjectPass } from "./store/clusterStore.js";
import { createGenAI, embedContentVia } from "./gemini/wire.js";
import { embedText } from "./understand/embed.js";
import { getStorage } from "firebase-admin/storage";
import { getAdminApp } from "./firebase/admin.js";

const config = loadConfig();

// The dev task runner and storage poller stand in for Cloud Tasks and the
// Storage emulator's missing finalize events. Both signals must agree this
// is a local emulator run: no Cloud Tasks configured, not production, and
// both emulator hosts set (so a local API run against a real project never
// starts polling a real bucket).
const useDevRunner =
  !config.production &&
  !config.tasks &&
  !!process.env.FIRESTORE_EMULATOR_HOST &&
  !!process.env.FIREBASE_STORAGE_EMULATOR_HOST;

const settle = async (projectId: string): Promise<void> => {
  const result = await settleProject(adminDb, projectId, Date.now());
  if (result.enqueued) await dispatchDue(adminDb, queue, Date.now());
};
const ingest = createIngest({ db: adminDb, bucketName: config.storageBucket, settle, dispatchDue: () => dispatchDue(adminDb, queue, Date.now()).then(() => undefined) });
const understand = createUnderstand({ db: adminDb, bucketName: config.storageBucket, geminiApiKey: config.geminiApiKey, settle });
const geminiClient = createGenAI(config.geminiApiKey);
const embedQuery = (text: string) => embedText(embedContentVia(geminiClient), text);
const cluster = async (projectId: string): Promise<unknown> => {
  const result = await runProjectPass(adminDb, projectId, Date.now());
  // Local plan deliveries remain pending while media is processing. Drain them
  // when clustering settles readiness, even if no more uploads arrive.
  if (useDevRunner && result.status !== "skipped") {
    setImmediate(() => {
      void dispatchDue(adminDb, queue, Date.now()).catch((error) => console.error("plan readiness dispatch failed", error));
    });
  }
  return result;
};
const plan = createPlan({ db: adminDb, geminiApiKey: config.geminiApiKey, cache: new FirestoreProposalCache(adminDb) });
const compose = createCompose({
  db: adminDb,
  geminiApiKey: config.geminiApiKey,
  // Compose runs inside a drain, so deliver the render it queued on the next
  // tick, the same hand-off clustering uses for plan readiness.
  afterRenderEnqueued: useDevRunner
    ? () => { setImmediate(() => { void dispatchDue(adminDb, queue, Date.now()).catch((error) => console.error("render dispatch failed", error)); }); }
    : undefined,
});

// A Timeline names shots; files hang off assets, so the shot is the hop in
// between. The same lookup the generations route uses.
const loadSource = async (projectId: string, shotId: string) => {
  const project = adminDb.collection("projects").doc(projectId);
  const shot = await project.collection("shots").doc(shotId).get();
  if (!shot.exists) return null;
  const asset = await project.collection("assets").doc(shot.get("assetId") as string).get();
  if (!asset.exists) return null;
  return { storagePath: asset.get("storagePath") as string, derivatives: asset.get("derivatives") };
};
const renderBucket = () => getStorage(getAdminApp()).bucket(config.storageBucket);
const render = createRender({
  db: adminDb,
  renderServiceUrl: config.renderServiceUrl,
  sources: { loadAsset: loadSource },
  // The render service is handed URLs it can fetch and one it can PUT to, so
  // it needs no storage credentials of its own. On the storage emulator there
  // are no credentials to sign with at all: reads use the emulator's direct
  // download form, and there is no signed PUT, so the render stays on disk and
  // storeLocalOutput below copies it into the bucket.
  signRead: process.env.FIREBASE_STORAGE_EMULATOR_HOST
    ? (path) => firebaseDownloadUrlStore(renderBucket()).signedDownloadUrl(path)
    : async (path) => {
        const [url] = await renderBucket().file(path).getSignedUrl({ version: "v4", action: "read", expires: Date.now() + 6 * 60 * 60 * 1000 });
        return url;
      },
  ...(process.env.FIREBASE_STORAGE_EMULATOR_HOST
    ? {}
    : {
        signUpload: async (path: string) => {
          const [url] = await renderBucket().file(path).getSignedUrl({ version: "v4", action: "write", contentType: "video/mp4", expires: Date.now() + 6 * 60 * 60 * 1000 });
          return url;
        },
      }),
  // A local render never uploads, so the MP4 stays on the render service's disk
  // and /download (a storage-emulator URL for generation.outputPath) would 404.
  // When the emulator is set, copy the finished file into the bucket at its
  // storage path so the same /download form serves it back.
  ...(process.env.FIREBASE_STORAGE_EMULATOR_HOST
    ? { storeLocalOutput: async (localFile: string, storagePath: string) => { await renderBucket().upload(localFile, { destination: storagePath, contentType: "video/mp4" as const }); } }
    : {}),
});
const queuePlan: QueuePlan = createQueuePlan({
  createJob: (input) => createPlanJob(adminDb, input),
  dispatch: () => dispatchDue(adminDb, queue, Date.now()),
  // The dev runner plans in-process; see createQueuePlan.
  defer: useDevRunner ? (run) => { setImmediate(run); } : null,
});

const queue: TaskQueue = config.tasks
  ? new CloudTasksQueue({ ...config.tasks, serviceUrl: config.serviceUrl })
  : useDevRunner
    ? new DevTaskQueue({ ingest, understand, cluster, plan, compose, render })
    : new InMemoryTaskQueue();

if (!config.tasks && !useDevRunner)
  console.warn(
    "Cloud Tasks not configured; using in-memory task queue (local development only)",
  );
if (useDevRunner)
  console.warn(
    "Cloud Tasks not configured; running tasks in-process and polling the Storage emulator (local development only)",
  );
const serviceAuth = requireServiceCaller({
  audience: config.serviceUrl,
  allowedEmails: config.invokerEmails,
});
const app = express();
app.use("/", healthRouter());
app.use("/api", apiCors(config));
app.use("/api", express.json({ limit: "2mb" }));
app.use(express.json({ limit: "2mb" }));
app.use(
  "/api/projects",
  projectsRouter({ db: adminDb, settle, embedQuery }),
);
app.use(
  "/api/projects",
  directingRouter({ db: adminDb, queuePlan }),
);
app.use(
  "/api/projects",
  thumbnailsRouter({ db: adminDb, thumbnails: {
    signedReadUrl: (path, expiresAt) => firebaseThumbnailUrlStore(getStorage(getAdminApp()).bucket(config.storageBucket)).signedReadUrl(path, expiresAt),
  } }),
);
app.use(
  "/api/projects",
  generationsRouter({ db: adminDb, loadSource, storageBucket: config.storageBucket, dispatch: () => dispatchDue(adminDb, queue, Date.now()) }),
);
app.use(
  "/api/projects",
  directionOptionsRouter({ db: adminDb }),
);
app.use(
  "/events",
  storageEventsRouter({
    db: adminDb,
    bucket: config.storageBucket,
    auth: serviceAuth,
    onAccepted: async () => {
      await dispatchDue(adminDb, queue, Date.now());
    },
  }),
);
app.use(
  "/",
  internalRouter({
    db: adminDb,
    queue,
    auth: serviceAuth,
    ingest,
    understand,
    cluster,
    plan,
    compose,
    render,
  }),
);

if (useDevRunner) {
  startStoragePoller({
    db: adminDb,
    bucketName: config.storageBucket,
    listUploads: async () => {
      const [files] = await getStorage(getAdminApp()).bucket(config.storageBucket).getFiles({ prefix: "uploads/" });
      return files.map((file) => ({
        name: file.name,
        generation: String(file.metadata.generation),
        sizeBytes: Number(file.metadata.size),
        contentType: file.metadata.contentType ?? "application/octet-stream",
      }));
    },
    onAccepted: async () => {
      await dispatchDue(adminDb, queue, Date.now());
    },
  });
}

app.listen(config.port, () => {
  console.log(`Mosaé API listening on port ${config.port}`);
});
