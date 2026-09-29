import { Router, type RequestHandler } from "express";
import type { Firestore } from "firebase-admin/firestore";
import { applyEdits, type EditOp, type Timeline } from "@mosae/contracts";
import { requireUser } from "../auth/requireUser.js";
import { isValidId } from "../domain/ids.js";
import type { GenerateOptions } from "../gemini/client.js";
import { DemoLimitReached } from "../gemini/wire.js";
import { interpretEdit, type InterpretEditModelResult } from "../directing/interpretEdit.js";
import { getEditDocument } from "../directing/editStore.js";

export function editInterpretRouter(deps: {
  db: Firestore;
  auth?: RequestHandler;
  generate: (options: GenerateOptions<InterpretEditModelResult>, projectId?: string) => Promise<unknown>;
}): Router {
  const router = Router();
  router.use(deps.auth ?? requireUser());
  for (const name of ["projectId", "generationId"]) {
    router.param(name, (_req, res, next, value: string) => {
      if (!isValidId(value)) { res.status(404).json({ error: "not_found" }); return; }
      next();
    });
  }
  router.post("/:projectId/generations/:generationId/edits/interpret", async (req, res) => {
    const { text, revision } = req.body ?? {};
    if (typeof text !== "string" || !text.trim() || !Number.isSafeInteger(revision) || revision < 0) {
      return res.status(400).json({ error: "invalid_request" });
    }
    try {
      const [document, generationSnap] = await Promise.all([
        getEditDocument(deps.db, res.locals.userId, req.params.projectId, req.params.generationId),
        deps.db.doc(`projects/${req.params.projectId}/generations/${req.params.generationId}`).get(),
      ]);
      if (!document || !generationSnap.exists) return res.status(404).json({ error: "not_found" });
      if (document.revision !== revision) return res.status(409).json({ error: "stale_revision", currentRevision: document.revision });
      const timeline = generationSnap.get("timeline") as Timeline | undefined;
      if (!timeline) return res.status(404).json({ error: "timeline_unavailable" });
      const current = applyEdits(timeline, document.ops as EditOp[]);
      if (!current.ok) return res.status(409).json({ error: "invalid_current_edits" });
      const result = await interpretEdit({ text: text.trim(), timeline: current.timeline }, {
        generate: (options) => deps.generate(options, req.params.projectId),
      });
      return res.json(result);
    } catch (error) {
      if (error instanceof DemoLimitReached) return res.status(429).json({ error: "demo_limit_reached", message: error.message });
      console.error("edit interpretation failed", req.params.projectId, req.params.generationId, error);
      return res.status(500).json({ error: "internal" });
    }
  });
  return router;
}
