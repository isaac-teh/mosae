import { Router, type RequestHandler } from "express";
import type { Firestore } from "firebase-admin/firestore";
import type { IngestTask } from "../ingest/ingestAsset.js";
import { dispatchDue } from "../outbox/dispatcher.js";
import type { TaskQueue } from "../queue/taskQueue.js";

export function internalRouter(deps: {
  db: Firestore;
  queue: TaskQueue;
  now?: () => number;
  auth: RequestHandler;
  ingest: (task: IngestTask) => Promise<unknown>;
  cluster: (projectId: string) => Promise<unknown>;
}): Router {
  const now = deps.now ?? Date.now;
  const router = Router();
  router.post("/internal/dispatch-outbox", deps.auth, async (_req, res) => {
    try {
      res.json(await dispatchDue(deps.db, deps.queue, now()));
    } catch (error) {
      console.error("outbox dispatch run failed", error);
      res.status(500).json({ error: "internal" });
    }
  });
  router.post("/tasks/ingest", deps.auth, async (req, res) => {
    const { projectId, subjectKind, subjectId, generation, workKey } = req.body ?? {};
    if (![projectId, subjectKind, subjectId, generation, workKey].every((v) => typeof v === "string") || subjectKind !== "asset") {
      res.status(400).json({ error: "invalid_task" });
      return;
    }
    try {
      const raw = req.header("x-cloudtasks-taskretrycount")?.trim();
      const attempt = raw !== undefined && /^\d+$/.test(raw) ? Number(raw) : 0;
      const result = await deps.ingest({ projectId, assetId: subjectId, generation, attempt });
      console.log("ingest", workKey, result);
      res.sendStatus(204);
    } catch (error) {
      console.error("ingest task failed", workKey, error);
      res.status(500).json({ error: "ingest_failed" });
    }
  });
  router.post("/tasks/cluster", deps.auth, async (req, res) => {
    const { projectId, subjectKind, subjectId, generation, workKey } = req.body ?? {};
    if (![projectId, subjectKind, subjectId, generation, workKey].every((v) => typeof v === "string") || subjectKind !== "project") {
      res.status(400).json({ error: "invalid_task" });
      return;
    }
    try {
      const result = await deps.cluster(projectId);
      console.log("cluster", workKey, result);
      res.sendStatus(204);
    } catch (error) {
      console.error("cluster task failed", workKey, error);
      res.status(500).json({ error: "cluster_failed" });
    }
  });
  return router;
}
