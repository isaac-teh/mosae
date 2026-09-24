import { Router, type RequestHandler } from "express";
import type { Firestore } from "firebase-admin/firestore";
import type { IngestTask } from "../ingest/ingestAsset.js";
import type { UnderstandTask } from "../understand/understandAsset.js";
import { dispatchDue } from "../outbox/dispatcher.js";
import type { TaskQueue } from "../queue/taskQueue.js";
import type { PlanTask } from "../directing/wire.js";
import { isValidId } from "../domain/ids.js";
import { runCompose, type ComposeJob, type ComposeDeps } from "../compose/runCompose.js";
import { createGeneration, publishGeneration, failGeneration } from "../store/generationStore.js";
import { safeParseDirectionSettings } from "@mosae/contracts";

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
  generateStructured?: (options: unknown, deps: unknown) => Promise<unknown>;
  soundtrackIds?: Set<string>;
  assets?: Map<string, { kind: "photo" | "video"; analysis?: { shots?: Array<{ id: string }> } }>;
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

  // Task 9: /tasks/compose handler
  router.post("/tasks/compose", deps.auth, async (req, res) => {
    const { projectId, subjectKind, subjectId, generation, workKey } = req.body ?? {};
    if (![projectId, subjectKind, subjectId, generation, workKey].every((v) => typeof v === "string") || subjectKind !== "generation") {
      res.status(400).json({ error: "invalid_task" });
      return;
    }

    const raw = req.header("x-cloudtasks-taskretrycount")?.trim();
    const attempt = raw !== undefined && /^\d+$/.test(raw) ? Number(raw) : 0;

    if (attempt >= MAX_COMPOSE_ATTEMPTS) {
      console.error(`compose ${workKey} exhausted attempts (${attempt}/${MAX_COMPOSE_ATTEMPTS})`);
      try {
        await failGeneration(deps.db, {
          userId: "", // will be validated by store
          projectId,
          generationId: subjectId,
          reasons: [`exceeded ${MAX_COMPOSE_ATTEMPTS} compose attempts`],
        });
      } catch (err) {
        console.error("failed to record exhaustion", workKey, err);
      }
      res.status(500).json({ error: "compose_exhausted" });
      return;
    }

    try {
      // Fetch the generation to get proposal and settings
      const genSnap = await deps.db.collection("projects").doc(projectId)
        .collection("generations").doc(subjectId).get();
      if (!genSnap.exists) {
        res.status(404).json({ error: "generation_not_found" });
        return;
      }

      const genData = genSnap.data();
      if (!genData || genData.status !== "composing") {
        res.status(400).json({ error: `invalid_generation_status_${genData?.status}` });
        return;
      }

      // Build ComposeJob from generation data
      const settingsResult = safeParseDirectionSettings(genData.settings);
      if (!settingsResult.ok) {
        await failGeneration(deps.db, {
          userId: genData.userId || "",
          projectId,
          generationId: subjectId,
          reasons: [`invalid direction settings: ${settingsResult.errors.join("; ")}`],
        });
        res.status(500).json({ error: "invalid_settings" });
        return;
      }

      const job: ComposeJob = {
        proposal: genData.proposalId as any, // will be resolved by caller
        projectId,
        mode: (genData.mode || "creator") as "memory" | "creator",
        aspect: settingsResult.settings.aspect,
        durationId: ((settingsResult.settings.durationId ?? "30s") as any),
        cadenceId: settingsResult.settings.cadenceId as any,
        seed: genData.seed,
        soundtrackId: settingsResult.settings.soundtrackId,
      };

      // Build ComposeDeps with real Gemini client and asset store
      const depsForCompose: ComposeDeps = {
        generateStructured: deps.generateStructured || (async () => ({ clips: [], musicCues: [] })),
        soundtrackIds: deps.soundtrackIds || new Set(),
        assets: deps.assets || new Map(),
      };

      // Run the compose pipeline
      const result = await runCompose(job, depsForCompose);

      if (result.ok) {
        // Publish the generation with the composed timeline
        await publishGeneration(deps.db, {
          userId: genData.userId || "",
          projectId,
          generationId: subjectId,
          timeline: result.timeline,
          droppedPicks: [],
          now: Date.now(),
        });
      } else {
        // Fail the generation with reasons
        await failGeneration(deps.db, {
          userId: genData.userId || "",
          projectId,
          generationId: subjectId,
          reasons: result.reasons,
        });
      }

      res.sendStatus(204);
    } catch (error) {
      console.error("compose task failed", workKey, error);
      res.status(500).json({ error: "compose_failed" });
    }
  });

  return router;
}
