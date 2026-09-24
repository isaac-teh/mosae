import { Router, type RequestHandler } from "express";
import type { Firestore } from "firebase-admin/firestore";
import type { IngestTask } from "../ingest/ingestAsset.js";
import type { UnderstandTask } from "../understand/understandAsset.js";
import { dispatchDue } from "../outbox/dispatcher.js";
import type { TaskQueue } from "../queue/taskQueue.js";
import type { PlanTask } from "../directing/wire.js";
import { isValidId } from "../domain/ids.js";
import type { ComposeTask } from "../compose/wire.js";

const MAX_COMPOSE_ATTEMPTS = 3;

export function internalRouter(deps: {
  db: Firestore;
  queue: TaskQueue;
  now?: () => number;
  auth: RequestHandler;
  ingest: (task: IngestTask) => Promise<unknown>;
  understand: (task: UnderstandTask) => Promise<unknown>;
  cluster: (projectId: string) => Promise<unknown>;
  plan?: (task: PlanTask) => Promise<unknown>;
  compose?: (task: ComposeTask & { giveUp?: string }) => Promise<unknown>;
}): Router {
  const now = deps.now ?? Date.now;
  const router = Router();
  router.post("/tasks/plan", deps.auth, async (req, res) => {
    const { projectId, subjectKind, subjectId, generation, workKey } = req.body ?? {};
    if (![projectId, subjectId, generation, workKey].every((value) => typeof value === "string" && value.length > 0)
      || subjectKind !== "job" || !isValidId(projectId) || !isValidId(subjectId)) {
      res.status(400).json({ error: "invalid_task" });
      return;
    }
    try {
      if (!deps.plan) throw new Error("planning_not_configured");
      const result = await deps.plan({ projectId, jobId: subjectId, generation });
      console.log("plan", workKey, result);
      res.sendStatus(204);
    } catch (error) {
      console.error("plan task failed", workKey, error);
      res.status(500).json({ error: "plan_failed" });
    }
  });
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
  router.post("/tasks/understand", deps.auth, async (req, res) => {
    const { projectId, subjectKind, subjectId, generation, workKey } = req.body ?? {};
    if (![projectId, subjectKind, subjectId, generation, workKey].every((v) => typeof v === "string") || subjectKind !== "asset") {
      res.status(400).json({ error: "invalid_task" });
      return;
    }
    try {
      const raw = req.header("x-cloudtasks-taskretrycount")?.trim();
      const attempt = raw !== undefined && /^\d+$/.test(raw) ? Number(raw) : 0;
      const result = await deps.understand({ projectId, assetId: subjectId, generation, attempt });
      console.log("understand", workKey, result);
      res.sendStatus(204);
    } catch (error) {
      console.error("understand task failed", workKey, error);
      res.status(500).json({ error: "understand_failed" });
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

  /**
   * Compose is a thin route, like plan: it validates the task envelope and
   * hands the work to the composer, which owns loading, running and settling
   * the generation. Attempt exhaustion is terminal — the previous playable
   * film stays current, so a failed compose never loses the user a film.
   */
  router.post("/tasks/compose", deps.auth, async (req, res) => {
    const { projectId, subjectKind, subjectId, generation, workKey } = req.body ?? {};
    if (![projectId, subjectKind, subjectId, generation, workKey].every((v) => typeof v === "string" && v.length > 0)
      || subjectKind !== "generation" || !isValidId(projectId) || !isValidId(subjectId)) {
      res.status(400).json({ error: "invalid_task" });
      return;
    }

    const raw = req.header("x-cloudtasks-taskretrycount")?.trim();
    const attempt = raw !== undefined && /^\d+$/.test(raw) ? Number(raw) : 0;

    try {
      if (!deps.compose) throw new Error("compose_not_configured");

      if (attempt >= MAX_COMPOSE_ATTEMPTS) {
        await deps.compose({ projectId, generationId: subjectId, giveUp: `exceeded ${MAX_COMPOSE_ATTEMPTS} compose attempts` });
        res.sendStatus(204);
        return;
      }

      const result = await deps.compose({ projectId, generationId: subjectId });
      console.log("compose", workKey, result);
      // A failed generation is a settled outcome, not a delivery failure: it is
      // recorded on the generation and must not be retried by Cloud Tasks.
      res.sendStatus(204);
    } catch (error) {
      console.error("compose task failed", workKey, error);
      res.status(500).json({ error: "compose_failed" });
    }
  });

  return router;
}
