import { Router, type Response } from "express";
import type { Firestore } from "firebase-admin/firestore";
import { requireUser } from "../auth/requireUser.js";
import { isValidId } from "../domain/ids.js";
import { createGeneration, getGeneration, StoreError } from "../store/generationStore.js";
import { enqueueRender } from "../store/enqueueRender.js";
import { newOutboxTask } from "../domain/outbox.js";
import { safeParseDirectionSettings, type Generation } from "@mosae/contracts";
import type { UnusedProjectMedia } from "./editorMedia.js";

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
  /** Resolve a shot id to the asset whose files back it. */
  loadSource?: (projectId: string, shotId: string) => Promise<{ storagePath: string; sourceDurationSec?: number; derivatives?: { proxyPath?: string | null; renderPath?: string | null; thumbPath: string } } | null>;
  /** The bucket renders are stored in. The admin app has no default bucket. */
  storageBucket?: string;
  /** Map resolved object paths to URLs the editor's browser can load. */
  signReadUrl?: (path: string, expiresAt: number) => Promise<string>;
  /** Resolve a selected library track to its object path. */
  loadSoundtrack?: (soundtrackId: string) => Promise<string | null>;
  /** Resolve every selectable soundtrack so the editor can switch tracks without reloading. */
  loadSoundtrackLibrary?: () => Promise<{ id: string; path: string }[]>;
  loadUnusedMedia?: (projectId: string, timeline: Generation["timeline"]) => Promise<UnusedProjectMedia[]>;
  /** Drains the outbox after a task is written; the dispatcher does it in production. */
  dispatch?: () => Promise<unknown>;
}): Router {
  const router = Router();
  router.use(requireUser());

  // A Timeline names shots. Files hang off assets, so the shot is the hop in
  // between — `resolveSources` is deliberately given a flat id-to-file lookup
  // and never learns the project's collection layout.
  const resolve: (projectId: string, shotId: string) => Promise<{ storagePath: string; sourceDurationSec?: number; derivatives?: { proxyPath?: string | null; renderPath?: string | null; thumbPath: string } } | null> =
    deps.loadSource ?? (async (projectId, shotId) => {
      const project = deps.db.collection("projects").doc(projectId);
      const shot = await project.collection("shots").doc(shotId).get();
      if (!shot.exists) return null;
      const asset = await project.collection("assets").doc(shot.get("assetId") as string).get();
      if (!asset.exists) return null;
      const media = asset.get("media") as { durationSec?: unknown } | undefined;
      return { storagePath: asset.get("storagePath") as string, ...(typeof media?.durationSec === "number" && media.durationSec > 0 ? { sourceDurationSec: media.durationSec } : {}), derivatives: asset.get("derivatives") };
    });

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

    // Settings are required: every field the composer reads comes from them, and
    // the placeholder this once fell back to could not itself parse — an empty
    // id, version 0 and a cadence that is not in CADENCES — so it would only
    // have failed later, at publication, with a worse message.
    if (!settings) {
      return res.status(400).json({ error: "missing_settings" });
    }
    const resolvedSettings = settings;


    try {
      if (settings.focus !== undefined && settings.focus !== "family") {
        const castSnap = await deps.db.collection("projects").doc(projectId).collection("cast").doc("current").get();
        const cast = castSnap.exists ? castSnap.data() as { confirmed?: boolean; people?: { personId: string; excluded?: boolean }[] } : null;
        if (!cast?.confirmed || !cast.people?.some(person => person.personId === settings.focus && !person.excluded)) {
          return res.status(400).json({ error: "invalid_focus", details: ["Choose a person in the confirmed cast."] });
        }
      }
      const generation = await createGeneration(deps.db, {
        userId,
        projectId,
        proposalId,
        parentGenerationId,
        settings: resolvedSettings,
        seed,
        now: Date.now(),
      });

      // The outbox the dispatcher actually reads is per project, under
      // `taskOutbox`, in the OutboxTask shape. A record anywhere else is
      // written and never delivered.
      const task = newOutboxTask({
        projectId,
        subjectKind: "generation",
        subjectId: generation.id,
        generation: String(generation.schemaVersion),
        stage: "compose",
        now: Date.now(),
      });
      await deps.db.collection("projects").doc(projectId).collection("taskOutbox").doc(task.id).set(task);
      await deps.dispatch?.();

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
        reasons: generation.reasons,
        failureReasons: generation.failureReasons,
        renderProgress: generation.renderProgress,
        outputPath: generation.outputPath,
      };

      // Resolve preview-mode sources if timeline exists
      let sources: Record<string, string> | undefined;
      if (generation.timeline) {
        const videoClips = await Promise.all(generation.timeline.videoClips.map(async (clip) => {
          if (!("source" in clip) || clip.source.kind !== "video" || clip.source.sourceDurationSec !== undefined) return clip;
          const source = await resolve(projectId, clip.source.shotId);
          return source?.sourceDurationSec !== undefined ? { ...clip, source: { ...clip.source, sourceDurationSec: source.sourceDurationSec } } : clip;
        }));
        response.timeline = { ...generation.timeline, videoClips };
        if (deps.loadUnusedMedia) response.unusedMedia = await deps.loadUnusedMedia(projectId, generation.timeline);
        const { resolveSources } = await import("../compose/resolveSources.js");
        try {
          const paths = await resolveSources(generation.timeline, {
            loadAsset: resolve,
            ...(deps.loadSoundtrack ? { loadSoundtrack: deps.loadSoundtrack } : {}),
          }, projectId, "preview");
          for (const track of await deps.loadSoundtrackLibrary?.() ?? []) paths[track.id] = track.path;
          const signReadUrl = deps.signReadUrl;
          if (!signReadUrl) throw new Error("preview URL signer is not configured");
          const expiresAt = Date.now() + 6 * 60 * 60 * 1000;
          sources = Object.fromEntries(await Promise.all(Object.entries(paths).map(async ([id, objectPath]) => [
            id,
            await signReadUrl(objectPath, expiresAt),
          ])));
          const videoShotIds = [...new Set(generation.timeline.videoClips.flatMap((clip) =>
            "source" in clip && clip.source.kind === "video" ? [clip.source.shotId] : [],
          ))];
          const thumbnails = await Promise.all(videoShotIds.map(async (shotId) => {
            try {
              const asset = await resolve(projectId, shotId);
              const thumbPath = asset?.derivatives?.thumbPath;
              return thumbPath ? [shotId, await signReadUrl(thumbPath, expiresAt)] as const : null;
            } catch {
              return null;
            }
          }));
          response.thumbnails = Object.fromEntries(thumbnails.filter((entry): entry is readonly [string, string] => entry !== null));
        } catch (error) {
          console.error("generation preview source resolution failed", error);
          return res.status(500).json({ error: "preview_sources_unavailable" });
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

      let sources: Record<string, string>;
      try {
        sources = await resolveSources(generation.timeline, { loadAsset: resolve }, projectId, "render");
      } catch (error) {
        return res.status(400).json({ error: "source_resolution_failed", detail: error instanceof Error ? error.message : String(error) });
      }

      // The status moves through the store, which refuses anything but a
      // playable film, so a second render cannot start on top of a running one.
      await enqueueRender(deps.db, {
        userId,
        projectId,
        generationId,
        schemaVersion: generation.schemaVersion,
      });

      return res.status(202).json({ generationId, status: "rendering", sources });
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

      const editSnap = await deps.db.collection("projects").doc(projectId).collection("generations").doc(generationId).collection("edits").doc("current").get();
      const editedPath = editSnap.exists && editSnap.get("status") === "ready" && editSnap.get("renderRevision") === editSnap.get("revision")
        ? editSnap.get("outputPath") as string | undefined
        : undefined;
      const outputPath = editedPath || (generation.status === "saved" ? generation.outputPath : null);
      if (!outputPath) {
        return res.status(400).json({ error: "render_not_complete", status: generation.status });
      }

      // Return a URL that answers 200 with video/mp4 locally. On the storage
      // emulator, getSignedUrl has no credentials and fails, so address the file
      // directly through the same GCS-style download path the thumbnail store
      // uses (firebaseDownloadUrlStore). Otherwise sign a read.
      const { firebaseDownloadUrlStore } = await import("../ingest/objectStore.js");
      const { getAdminApp } = await import("../firebase/admin.js");
      const { getStorage } = await import("firebase-admin/storage");
      const bucket = getStorage(getAdminApp()).bucket(deps.storageBucket);
      const store = firebaseDownloadUrlStore(bucket);

      try {
        const downloadUrl = await store.signedDownloadUrl(outputPath);
        return res.json({ downloadUrl, outputPath });
      } catch {
        return res.status(500).json({ error: "url_generation_failed" });
      }
    } catch (error) {
      handleError(res, error);
    }
  });

  return router;
}
