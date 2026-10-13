import { Router, type RequestHandler, type Response } from "express";
import type { Firestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { getAdminApp } from "../firebase/admin.js";
import { createDemoProject, type DemoBucket } from "../demo/createDemoProject.js";
import { requireUser } from "../auth/requireUser.js";
import { buildOriginalPath, isValidId } from "../domain/ids.js";
import type { ManifestEntry } from "../domain/uploadSession.js";
import {
  addEntries,
  closeSession,
  createProject,
  openSession,
  recordClientOutcome,
  getOwnedProject,
  StoreError,
  type NewEntryInput,
} from "../store/projectStore.js";
import { loadSearchableShots } from "../store/understandStore.js";
import { rankShots } from "../understand/search.js";

const STATUS: Record<StoreError["code"], number> = {
  not_found: 404,
  session_closed: 409,
  invalid_entry: 400,
  invalid_replacement: 400,
  replacement_conflict: 409,
  too_many_entries: 400,
};

function handleError(res: Response, error: unknown): void {
  if (error instanceof StoreError) {
    res.status(STATUS[error.code]).json({ error: error.code });
    return;
  }
  console.error("projects route failed", error);
  res.status(500).json({ error: "internal" });
}

function parseEntries(body: unknown): NewEntryInput[] | null {
  const entries = (body as { entries?: unknown })?.entries;
  if (!Array.isArray(entries) || entries.length === 0) return null;
  const ok = entries.every(
    (e) =>
      typeof e?.fileName === "string" &&
      typeof e?.contentType === "string" &&
      typeof e?.sizeBytes === "number" &&
      (e?.replacesAssetId === undefined || (typeof e.replacesAssetId === "string" && isValidId(e.replacesAssetId))) &&
      (e?.replacesSessionId === undefined || (typeof e.replacesSessionId === "string" && isValidId(e.replacesSessionId))) &&
      Boolean(e?.replacesAssetId) === Boolean(e?.replacesSessionId),
  );
  return ok
    ? entries.map((e) => ({
        fileName: e.fileName,
        contentType: e.contentType,
        sizeBytes: e.sizeBytes,
        ...(e.replacesAssetId ? { replacesAssetId: e.replacesAssetId } : {}),
        ...(e.replacesSessionId ? { replacesSessionId: e.replacesSessionId } : {}),
      }))
    : null;
}

function withPaths(
  userId: string,
  projectId: string,
  sessionId: string,
  entries: ManifestEntry[],
) {
  return entries.map((e) => ({
    ...e,
    storagePath: buildOriginalPath({
      userId,
      projectId,
      sessionId,
      assetId: e.assetId,
    }),
  }));
}

export function projectsRouter(deps: {
  db: Firestore;
  now?: () => number;
  auth?: RequestHandler;
  listProjects?: (userId: string) => Promise<Record<string, unknown>[]>;
  settle?: (projectId: string) => Promise<void>;
  notifyUploaded?: (input: { userId: string; projectId: string; sessionId: string; assetId: string; generation: string }) => Promise<unknown>;
  sleep?: (ms: number) => Promise<void>;
  embedQuery?: (text: string) => Promise<number[]>;
  demoBucket?: DemoBucket;
  storageBucket?: { deleteFiles(options: { prefix: string }): Promise<unknown> };
}): Router {
  const { db } = deps;
  const now = deps.now ?? Date.now;
  /** Runs after the response so a slow or failing settle never fails the request. */
  const settleAfter = (projectId: string) => {
    if (!deps.settle) return;
    void (async () => {
      const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          await deps.settle!(projectId);
          return;
        } catch (error) {
          console.error("settle after upload change failed", projectId, error);
          if (attempt === 2) {
            console.error("settle after upload change exhausted retries", projectId, error);
            return;
          }
          await sleep(attempt === 0 ? 100 : 300);
        }
      }
    })();
  };
  const router = Router();
  router.use(deps.auth ?? requireUser());
  for (const name of ["projectId", "sessionId", "assetId"]) {
    router.param(name, (_req, res, next, value: string) => {
      if (!isValidId(value)) {
        res.status(404).json({ error: "not_found" });
        return;
      }
      next();
    });
  }

  router.get("/:projectId/shots/search", async (req, res) => {
    if (!deps.embedQuery) {
      res.status(503).json({ error: "search_unavailable" });
      return;
    }
    const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
    if (!q) {
      res.status(400).json({ error: "invalid_query" });
      return;
    }
    try {
      const owned = await getOwnedProject(db, res.locals.userId, req.params.projectId);
      if (!owned) {
        res.status(404).json({ error: "not_found" });
        return;
      }
      const [embedding, shots] = await Promise.all([deps.embedQuery(q), loadSearchableShots(db, req.params.projectId)]);
      res.json({ results: rankShots(embedding, shots, 20) });
    } catch (error) {
      console.error("shot search failed", req.params.projectId, error);
      res.status(500).json({ error: "internal" });
    }
  });

  router.post("/", async (req, res) => {
    const mode = req.body?.mode;
    if (mode !== "memory" && mode !== "creator") {
      res.status(400).json({ error: "invalid_mode" });
      return;
    }
    try {
      const project = await createProject(db, {
        userId: res.locals.userId,
        mode,
        now: now(),
      });
      res.status(201).json({ project });
    } catch (error) {
      handleError(res, error);
    }
  });

  router.delete("/:projectId", async (req, res) => {
    const projectRef = db.collection("projects").doc(req.params.projectId);
    try {
      const snapshot = await projectRef.get();
      // Deletion is idempotent; a missing project is already in the desired state.
      if (!snapshot.exists) { res.status(204).end(); return; }
      const project = snapshot.data()!;
      const userId: string = res.locals.userId;
      if (project.userId !== userId) { res.status(404).json({ error: "not_found" }); return; }

      // Persist the tombstone before touching external storage so any worker
      // that checks the project can stop before publishing further outputs.
      const stillOwned = await db.runTransaction(async (transaction) => {
        const current = await transaction.get(projectRef);
        if (!current.exists) return true;
        if (current.get("userId") !== userId) return false;
        transaction.set(projectRef, { deleting: true, deletingAt: now() }, { merge: true });
        return true;
      });
      if (!stillOwned) { res.status(404).json({ error: "not_found" }); return; }
      const bucket = deps.storageBucket ?? getStorage(getAdminApp()).bucket(process.env.FIREBASE_STORAGE_BUCKET ?? "demo-mosae.appspot.com");
      for (const root of ["uploads", "proxies", "renders"]) {
        await bucket.deleteFiles({ prefix: `${root}/${userId}/${req.params.projectId}/` });
      }
      await db.recursiveDelete(projectRef);
      res.status(204).end();
    } catch (error) {
      console.error("delete project failed", req.params.projectId, error);
      res.status(500).json({ error: "internal" });
    }
  });

  router.get("/", async (_req, res) => {
    try {
      const projects = deps.listProjects
        ? await deps.listProjects(res.locals.userId)
        : await db.collection("projects").where("userId", "==", res.locals.userId).get().then((snapshot) => snapshot.docs.map((entry) => ({ ...entry.data(), id: entry.id })));
      res.json({ projects });
    } catch (error) {
      console.error("list projects failed", error);
      res.status(500).json({ error: "internal" });
    }
  });

  router.post("/demo", async (_req, res) => {
    try {
      const bucket = deps.demoBucket ?? getStorage(getAdminApp()).bucket(process.env.FIREBASE_STORAGE_BUCKET ?? "demo-mosae.appspot.com") as unknown as DemoBucket;
      const project = await createDemoProject({ db, bucket, userId: res.locals.userId, now: now() });
      res.status(201).json({ project });
    } catch (error) {
      handleError(res, error);
    }
  });

  router.post("/:projectId/upload-sessions", async (req, res) => {
    const entries = parseEntries(req.body);
    if (!entries) {
      res.status(400).json({ error: "invalid_entry" });
      return;
    }
    const userId: string = res.locals.userId;
    try {
      const result = await openSession(db, {
        userId,
        projectId: req.params.projectId,
        entries,
        now: now(),
      });
      res.status(201).json({
        session: result.session,
        entries: withPaths(
          userId,
          req.params.projectId,
          result.session.id,
          result.entries,
        ),
      });
    } catch (error) {
      handleError(res, error);
    }
  });

  router.post(
    "/:projectId/upload-sessions/:sessionId/entries",
    async (req, res) => {
      const entries = parseEntries(req.body);
      if (!entries) {
        res.status(400).json({ error: "invalid_entry" });
        return;
      }
      const userId: string = res.locals.userId;
      const { projectId, sessionId } = req.params;
      try {
        const added = await addEntries(db, {
          userId,
          projectId,
          sessionId,
          entries,
        });
        res
          .status(201)
          .json({ entries: withPaths(userId, projectId, sessionId, added) });
      } catch (error) {
        handleError(res, error);
      }
    },
  );

  router.post(
    "/:projectId/upload-sessions/:sessionId/entries/:assetId/uploaded",
    async (req, res) => {
      const generation = req.body?.generation;
      if (typeof generation !== "string" || !/^\d{1,30}$/.test(generation)) {
        res.status(400).json({ error: "invalid_generation" });
        return;
      }
      if (!deps.notifyUploaded) { res.status(503).json({ error: "upload_notification_unavailable" }); return; }
      try {
        const result = await deps.notifyUploaded({ userId: res.locals.userId, ...req.params, generation });
        res.status(202).json({ result });
        settleAfter(req.params.projectId);
      } catch (error) { handleError(res, error); }
    },
  );

  router.post(
    "/:projectId/upload-sessions/:sessionId/close",
    async (req, res) => {
      try {
        const session = await closeSession(db, {
          userId: res.locals.userId,
          ...req.params,
        });
        res.json({ session });
        settleAfter(req.params.projectId);
      } catch (error) {
        handleError(res, error);
      }
    },
  );

  router.post(
    "/:projectId/upload-sessions/:sessionId/entries/:assetId/outcome",
    async (req, res) => {
      const body = req.body ?? {};
      let event: { kind: "cancelled" } | { kind: "failed"; reason: string };
      if (body.kind === "cancelled") event = { kind: "cancelled" };
      else if (
        body.kind === "failed" &&
        typeof body.reason === "string" &&
        body.reason.length <= 200
      ) {
        event = { kind: "failed", reason: body.reason };
      } else {
        res.status(400).json({ error: "invalid_outcome" });
        return;
      }
      try {
        const entry = await recordClientOutcome(db, {
          userId: res.locals.userId,
          ...req.params,
          event,
        });
        res.json({ entry });
        settleAfter(req.params.projectId);
      } catch (error) {
        handleError(res, error);
      }
    },
  );

  return router;
}
