import { Router, type RequestHandler, type Response } from "express";
import type { Firestore } from "firebase-admin/firestore";
import { requireUser } from "../auth/requireUser.js";
import { buildOriginalPath, isValidId } from "../domain/ids.js";
import type { ManifestEntry } from "../domain/uploadSession.js";
import {
  addEntries,
  closeSession,
  createProject,
  openSession,
  recordClientOutcome,
  StoreError,
  type NewEntryInput,
} from "../store/projectStore.js";

const STATUS: Record<StoreError["code"], number> = {
  not_found: 404,
  session_closed: 409,
  invalid_entry: 400,
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
      typeof e?.sizeBytes === "number",
  );
  return ok
    ? entries.map((e) => ({
        fileName: e.fileName,
        contentType: e.contentType,
        sizeBytes: e.sizeBytes,
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
  settle?: (projectId: string) => Promise<void>;
  sleep?: (ms: number) => Promise<void>;
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
