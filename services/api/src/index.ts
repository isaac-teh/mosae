import express from "express";
import { adminDb } from "./firebase/admin.js";
import { loadConfig } from "./config.js";
import { requireServiceCaller } from "./auth/requireServiceCaller.js";
import { projectsRouter } from "./routes/projects.js";
import { storageEventsRouter } from "./routes/storageEvents.js";
import { internalRouter } from "./routes/internal.js";
import { healthRouter } from "./routes/health.js";
import {
  CloudTasksQueue,
  InMemoryTaskQueue,
  type TaskQueue,
} from "./queue/taskQueue.js";
import { dispatchDue } from "./outbox/dispatcher.js";
import { apiCors } from "./http/cors.js";
import { settleProject } from "./store/readinessStore.js";

const config = loadConfig();
const queue: TaskQueue = config.tasks
  ? new CloudTasksQueue({ ...config.tasks, serviceUrl: config.serviceUrl })
  : new InMemoryTaskQueue();
if (!config.tasks)
  console.warn(
    "Cloud Tasks not configured; using in-memory task queue (local development only)",
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
  projectsRouter({
    db: adminDb,
    settle: async (projectId) => {
      const result = await settleProject(adminDb, projectId, Date.now());
      if (result.enqueued) await dispatchDue(adminDb, queue, Date.now());
    },
  }),
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
app.use("/", internalRouter({ db: adminDb, queue, auth: serviceAuth }));

app.listen(config.port, () => {
  console.log(`Mosaé API listening on port ${config.port}`);
});
