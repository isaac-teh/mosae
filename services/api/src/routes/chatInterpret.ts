import { Router, type RequestHandler } from "express";
import type { Firestore } from "firebase-admin/firestore";
import { requireUser } from "../auth/requireUser.js";
import { isValidId } from "../domain/ids.js";
import { getOwnedProject } from "../store/projectStore.js";
import { interpret, type ChatStep } from "../directing/interpret.js";
import type { GenerateOptions } from "../gemini/client.js";

const steps = new Set<ChatStep>(["occasion", "people", "moments", "direction"]);
export function chatInterpretRouter(deps: {
  db: Firestore;
  auth?: RequestHandler;
  generate: (options: GenerateOptions<unknown>, projectId?: string) => Promise<unknown>;
  searchShots: (projectId: string, query: string) => Promise<string[]>;
}): Router {
  const router = Router();
  router.use(deps.auth ?? requireUser());
  router.param("projectId", (_req, res, next, value: string) => {
    if (!isValidId(value)) { res.status(404).json({ error: "not_found" }); return; }
    next();
  });
  router.post("/:projectId/chat/interpret", async (req, res) => {
    const { step, text, context } = req.body ?? {};
    if (typeof step !== "string" || !steps.has(step as ChatStep) || typeof text !== "string" || !text.trim()) {
      return res.status(400).json({ error: "invalid_request" });
    }
    try {
      const project = await getOwnedProject(deps.db, res.locals.userId, req.params.projectId);
      if (!project) return res.status(404).json({ error: "not_found" });
      const result = await interpret({ step: step as ChatStep, text: text.trim(), context: context && typeof context === "object" ? context : {} }, {
        generate: (options) => deps.generate(options, req.params.projectId),
        searchShots: (query) => deps.searchShots(req.params.projectId, query),
      });
      return res.json(result);
    } catch (error) {
      console.error("chat interpret route failed", req.params.projectId, error);
      return res.status(500).json({ error: "internal" });
    }
  });
  return router;
}
