import express from "express";
import { adminDb } from "./firebase/admin.js";
import { loadConfig } from "./config.js";
import { requireServiceCaller } from "./auth/requireServiceCaller.js";
import { projectsRouter } from "./routes/projects.js";
import { thumbnailsRouter } from "./routes/thumbnails.js";
import { firebaseThumbnailUrlStore } from "./ingest/objectStore.js";
import { createPlanJob, directingRouter, type QueuePlan } from "./routes/directing.js";
import { storageEventsRouter } from "./routes/storageEvents.js";
import { internalRouter } from "./routes/internal.js";
import { healthRouter } from "./routes/health.js";
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
const plan = createPlan({ db: adminDb, geminiApiKey: config.geminiApiKey });
const queuePlan: QueuePlan = async (input) => {
  const job = await createPlanJob(adminDb, input);
  await dispatchDue(adminDb, queue, Date.now());
  return job;
};

const queue: TaskQueue = config.tasks
  ? new CloudTasksQueue({ ...config.tasks, serviceUrl: config.serviceUrl })
  : useDevRunner
    ? new DevTaskQueue({ ingest, understand, cluster, plan })
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
