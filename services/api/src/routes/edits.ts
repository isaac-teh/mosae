import { Router, type RequestHandler } from "express";
import type { Firestore } from "firebase-admin/firestore";
import { requireUser } from "../auth/requireUser.js";
import { isValidId } from "../domain/ids.js";
import { getEditDocument, saveEditDocument } from "../directing/editStore.js";

export function editsRouter(deps: { db: Firestore; auth?: RequestHandler; now?: () => number }): Router {
  const router = Router();
  router.use(deps.auth ?? requireUser());
  for (const name of ["projectId", "generationId"]) {
    router.param(name, (_req, res, next, value: string) => {
      if (!isValidId(value)) { res.status(404).json({ error: "not_found" }); return; }
      next();
    });
  }
  router.get("/:projectId/generations/:generationId/edits", async (req, res) => {
    try {
      const document = await getEditDocument(deps.db, res.locals.userId, req.params.projectId, req.params.generationId);
      return document ? res.json(document) : res.status(404).json({ error: "not_found" });
    } catch (error) {
      console.error("get edits failed", error);
      return res.status(500).json({ error: "internal" });
    }
  });
  router.put("/:projectId/generations/:generationId/edits", async (req, res) => {
    try {
      const result = await saveEditDocument(deps.db, res.locals.userId, req.params.projectId, req.params.generationId, req.body, deps.now);
      if (result.status === "not_found") return res.status(404).json({ error: "not_found" });
      if (result.status === "stale") return res.status(409).json({ error: "stale_revision", current: result.current });
      if (result.status === "invalid") return res.status(422).json({ error: result.error, opIndex: result.opIndex });
      return res.json(result.document);
    } catch (error) {
      console.error("save edits failed", error);
      return res.status(500).json({ error: "internal" });
    }
  });
  return router;
}
