import { Router, type Response } from "express";
import type { Firestore } from "firebase-admin/firestore";
import { requireUser } from "../auth/requireUser.js";
import { isValidId } from "../domain/ids.js";
import { createGeneration, getGeneration, StoreError } from "../store/generationStore.js";
import { safeParseDirectionSettings, type Generation } from "@mosae/contracts";

const STATUS: Record<StoreError["code"], number> = {
  not_found: 404,
  forbidden: 403,
  validation_error: 400,
};

function handleError(res: Response, error: unknown): void {
  if (error instanceof StoreError) {
    res.status(STATUS[error.code]).json({ error: error.code });
    return;
  }
  console.error("generations route failed", error);
  res.status(500).json({ error: "internal" });
}

export function generationsRouter(deps: {
  db: Firestore;
  generateStructured?: (options: unknown, deps: unknown) => Promise<unknown>;
  soundtrackIds?: Set<string>;
  assets?: Map<string, { kind: "photo" | "video"; analysis?: { shots?: Array<{ id: string }> } }>;
}): Router {
  const router = Router();
  router.use(requireUser());

  for (const name of ["projectId", "generationId"]) {
    router.param(name, (_req, res, next, value: string) => {
      if (!isValidId(value)) {
        res.status(404).json({ error: "not_found" });
        return;
      }
      next();
    });
  }

  // POST /api/projects/:id/generations — create a new generation (triggers compose)
  router.post("/:projectId/generations", async (req, res) => {
    const userId = res.locals.userId;
    const projectId = req.params.projectId;

    // Verify ownership
    const projectSnap = await deps.db.collection("projects").doc(projectId).get();
    if (!projectSnap.exists || projectSnap.get("userId") !== userId) {
      return res.status(403).json({ error: "forbidden" });
    }

    const body = req.body ?? {};
    const proposalId = typeof body.proposalId === "string" ? body.proposalId : null;
    if (!proposalId) {
      return res.status(400).json({ error: "missing_proposal_id" });
    }

    const parentGenerationId = typeof body.parentGenerationId === "string" ? body.parentGenerationId : null;
    const seed = typeof body.seed === "string" ? body.seed : crypto.randomUUID();

    // Parse direction settings from the proposal or request
    let settings: Generation["settings"] | null = null;
    if (body.settings && typeof body.settings === "object") {
      const parsed = safeParseDirectionSettings(body.settings);
      if (!parsed.ok) {
        return res.status(400).json({ error: "invalid_settings", details: parsed.errors });
      }
      settings = parsed.settings;
    }

    // At this point, if settings is null it's valid (user didn't provide any);
    // otherwise it has been validated by safeParseDirectionSettings.
    const resolvedSettings = settings ?? {
      schemaVersion: 1,
      id: "",
      projectId: "",
      version: 0,
      note: "",
      cadenceId: "standard",
      soundtrackId: null,
      durationId: "30s",
      aspect: "9:16",
      captions: false,
    };

    try {
      const generation = await createGeneration(deps.db, {
        userId,
        projectId,
        proposalId,
        parentGenerationId,
        settings: resolvedSettings,
        seed,
        now: Date.now(),
      });

      // Enqueue compose task immediately after creation
      // (The dispatcher will pick it up via the outbox)
      await deps.db.collection("outbox").add({
        projectId,
        stage: "compose",
        subjectKind: "generation",
        subjectId: generation.id,
        generation: generation.id,
        workKey: `compose-${generation.id}`,
        status: "pending",
        attempt: 0,
        createdAt: Date.now(),
      });

      return res.status(201).json({ generation });
    } catch (error) {
      handleError(res, error);
    }
  });

  // GET /api/projects/:id/generations/:gid — get generation status + timeline
  router.get("/:projectId/generations/:generationId", async (req, res) => {
    const userId = res.locals.userId;
    const projectId = req.params.projectId;
    const generationId = req.params.generationId;

    try {
      const generation = await getGeneration(deps.db, userId, projectId, generationId);
      if (!generation) {
        return res.status(404).json({ error: "not_found" });
      }

      // Return what the Player needs: status, timeline (if playable), preview sources
      const response: Record<string, unknown> = {
        id: generation.id,
        status: generation.status,
        timeline: generation.timeline,
        droppedPicks: generation.droppedPicks,
        failureReasons: generation.failureReasons,
        renderProgress: generation.renderProgress,
        outputPath: generation.outputPath,
      };

      // Resolve preview-mode sources if timeline exists
      let sources: Record<string, string> | undefined;
      if (generation.timeline) {
        const { resolveSources } = await import("../compose/resolveSources.js");
        const depsForResolve = {
          loadAsset: async (assetId: string) => {
            return deps.assets?.get(assetId) ?? null;
          },
        };
        try {
          sources = await resolveSources(generation.timeline, depsForResolve as any, projectId, "preview");
        } catch {
          // Sources missing — still return the generation without them
        }
      }

      if (sources) response.sources = sources;

      return res.json(response);
    } catch (error) {
      handleError(res, error);
    }
  });

  // POST /api/projects/:id/generations/:gid/render — trigger render
  router.post("/:projectId/generations/:generationId/render", async (req, res) => {
    const userId = res.locals.userId;
    const projectId = req.params.projectId;
    const generationId = req.params.generationId;

    try {
      const generation = await getGeneration(deps.db, userId, projectId, generationId);
      if (!generation || !generation.timeline) {
        return res.status(400).json({ error: "no_timeline" });
      }

      // Resolve render-mode sources
      const { resolveSources } = await import("../compose/resolveSources.js");
      const depsForResolve = {
        loadAsset: async (assetId: string) => {
          return deps.assets?.get(assetId) ?? null;
        },
      };

      let sources: Record<string, string>;
      try {
        sources = await resolveSources(generation.timeline, depsForResolve as any, projectId, "render");
      } catch (error) {
        return res.status(400).json({ error: "source_resolution_failed", detail: error instanceof Error ? error.message : String(error) });
      }

      // Enqueue render task
      await deps.db.collection("outbox").add({
        projectId,
        stage: "render",
        subjectKind: "generation",
        subjectId: generationId,
        generation: generationId,
        workKey: `render-${generationId}`,
        status: "pending",
        attempt: 0,
        createdAt: Date.now(),
      });

      // Update generation to rendering state
      const genRef = deps.db.collection("projects").doc(projectId).collection("generations").doc(generationId);
      await genRef.update({ status: "rendering" });

      return res.status(202).json({ generationId, status: "rendering" });
    } catch (error) {
      handleError(res, error);
    }
  });

  // GET /api/projects/:id/generations/:gid/download — get download URL
  router.get("/:projectId/generations/:generationId/download", async (req, res) => {
    const userId = res.locals.userId;
    const projectId = req.params.projectId;
    const generationId = req.params.generationId;

    try {
      const generation = await getGeneration(deps.db, userId, projectId, generationId);
      if (!generation) {
        return res.status(404).json({ error: "not_found" });
      }

      if (generation.status !== "saved" || !generation.outputPath) {
        return res.status(400).json({ error: "render_not_complete", status: generation.status });
      }

      // Return a signed URL for the output file
      const { getStorage } = await import("firebase-admin/storage");
      const { getAdminApp } = await import("../firebase/admin.js");
      const bucket = getStorage(getAdminApp()).bucket();
      const file = bucket.file(generation.outputPath);

      try {
        const [url] = await file.getSignedUrl({
          action: "read",
          expires: Date.now() + 24 * 60 * 60 * 1000, // 24 hours
        });
        return res.json({ downloadUrl: url, outputPath: generation.outputPath });
      } catch {
        return res.status(500).json({ error: "url_generation_failed" });
      }
    } catch (error) {
      handleError(res, error);
    }
  });

  return router;
}
