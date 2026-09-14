import { Router, type RequestHandler } from "express";
import type { Firestore } from "firebase-admin/firestore";
import { dispatchDue } from "../outbox/dispatcher.js";
import type { TaskQueue } from "../queue/taskQueue.js";

export function internalRouter(deps: {
  db: Firestore;
  queue: TaskQueue;
  now?: () => number;
  auth: RequestHandler;
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
  router.post("/tasks/ingest", deps.auth, (req, res) => {
    const { projectId, assetId, generation, workKey } = req.body ?? {};
    if (
      ![projectId, assetId, generation, workKey].every(
        (v) => typeof v === "string",
      )
    ) {
      res.status(400).json({ error: "invalid_task" });
      return;
    }
    console.log("ingest task received", workKey);
    res.sendStatus(204);
  });
  return router;
}
