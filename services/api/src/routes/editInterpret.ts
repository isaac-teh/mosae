import { createHash, randomUUID } from "node:crypto";
import { loadEditContext } from "../directing/loadEditContext.js";
import { validateEditContext } from "../directing/editContext.js";
import { Router, type RequestHandler } from "express";
import type { Firestore } from "firebase-admin/firestore";
import { applyEdits, type EditOp, type Timeline } from "@mosae/contracts";
import { requireUser } from "../auth/requireUser.js";
import { isValidId } from "../domain/ids.js";
import type { GenerateOptions } from "../gemini/client.js";
import { DemoLimitReached } from "../gemini/errors.js";
import { interpretEdit, type InterpretEditModelResult } from "../directing/interpretEdit.js";
import { EditInterpretationLeaseLost, EditInterpretationStaleRevision, EDIT_INTERPRETATION_LEASE_MS, getEditDocument, beginEditInterpretation, renewEditInterpretation, finishEditInterpretation, abandonEditInterpretation, getEditConversation, acknowledgeEditInterpretation, type StoredEditInterpretation } from "../directing/editStore.js";

export function editInterpretRouter(deps: {
  db: Firestore;
  auth?: RequestHandler;
  leaseRenewIntervalMs?: number;
  renewLease?: typeof renewEditInterpretation;
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
    if (typeof text !== "string" || !text.trim() || text.length > 2000 || !Number.isSafeInteger(revision) || revision < 0) {
      return res.status(400).json({ error: "invalid_request" });
    }
    let reservedRequestId: string | undefined;
    let reservationToken: string | undefined;
    let leaseTimer: ReturnType<typeof setInterval> | undefined;
    let leaseWasLost = false;
    let renewalInFlight = false;
    try {
      const [document, generationSnap] = await Promise.all([
        getEditDocument(deps.db, res.locals.userId, req.params.projectId, req.params.generationId),
        deps.db.doc(`projects/${req.params.projectId}/generations/${req.params.generationId}`).get(),
      ]);
      if (!document || !generationSnap.exists) return res.status(404).json({ error: "not_found" });
      const timeline = generationSnap.get("timeline") as Timeline | undefined;
      if (!timeline) return res.status(404).json({ error: "timeline_unavailable" });
      const rawContext = req.body.context ?? { scope: { kind: "film" }, requestId: randomUUID() };
      if (!rawContext || typeof rawContext.requestId !== "string" || !rawContext.requestId.trim() || rawContext.requestId.length > 200) return res.status(400).json({ error: "invalid_scope" });
      const fingerprint = createHash("sha256").update(JSON.stringify({ text: text.trim(), revision, scope: rawContext.scope })).digest("hex");
      const reservation = await beginEditInterpretation(deps.db, res.locals.userId, req.params.projectId, req.params.generationId, rawContext.requestId, fingerprint);
      if (reservation.status === "complete") {
        if (revision !== reservation.currentRevision) return res.status(409).json({ error: "stale_revision", currentRevision: reservation.currentRevision });
        return res.json(reservation.result);
      }
      if (reservation.status === "not_found") return res.status(404).json({ error: "not_found" });
      if (reservation.status !== "started") return res.status(409).json({ error: reservation.status === "conflict" ? "request_id_conflict" : "request_in_progress" });
      reservedRequestId = rawContext.requestId;
      reservationToken = reservation.leaseToken;
      leaseTimer = setInterval(() => {
        if (renewalInFlight) return;
        renewalInFlight = true;
        void (deps.renewLease ?? renewEditInterpretation)(deps.db, req.params.projectId, req.params.generationId, rawContext.requestId, reservation.leaseToken, Date.now)
          .then((owned) => { if (!owned) leaseWasLost = true; })
          .catch(() => { /* A later tick retries while the current lease remains valid. */ })
          .finally(() => { renewalInFlight = false; });
      }, deps.leaseRenewIntervalMs ?? Math.floor(EDIT_INTERPRETATION_LEASE_MS / 3));
      if (document.revision !== revision) return res.status(409).json({ error: "stale_revision", currentRevision: document.revision });
      const current = applyEdits(timeline, document.ops as EditOp[]);
      if (!current.ok) return res.status(409).json({ error: "invalid_current_edits" });
      const context = validateEditContext(current.timeline, rawContext);
      if (!context) return res.status(400).json({ error: "invalid_scope" });
      const groundedContext = await loadEditContext(deps.db, res.locals.userId, req.params.projectId, req.params.generationId, context.scope);
      const result = await interpretEdit({ text: text.trim(), timeline: current.timeline, ...context, groundedContext }, {
        generate: (options) => deps.generate(options, req.params.projectId),
      });
      const response = { ...result, ...(result.kind === "edit" ? { baseRevision: document.revision } : {}), requestId: context.requestId } as StoredEditInterpretation;
      response.reply = response.reply.slice(0, 2000);
      if (response.kind === "edit") response.baseRevision = document.revision;
      if (leaseWasLost) throw new EditInterpretationLeaseLost();
      await finishEditInterpretation(deps.db, res.locals.userId, req.params.projectId, req.params.generationId, text.trim(), revision, document.ops, response, reservation.leaseToken);
      reservedRequestId = undefined;
      return res.json(response);
    } catch (error) {
      if (error instanceof EditInterpretationLeaseLost) return res.status(409).json({ error: "request_lease_lost" });
      if (error instanceof EditInterpretationStaleRevision) return res.status(409).json({ error: "stale_revision", currentRevision: error.currentRevision });
      if (error instanceof DemoLimitReached) return res.status(429).json({ error: "demo_limit_reached", message: error.message });
      console.error("edit interpretation failed", req.params.projectId, req.params.generationId, error);
      return res.status(500).json({ error: "internal" });
    } finally {
      if (leaseTimer) clearInterval(leaseTimer);
      if (reservedRequestId && reservationToken) await abandonEditInterpretation(deps.db, req.params.projectId, req.params.generationId, reservedRequestId, reservationToken);
    }
  });
  router.get("/:projectId/generations/:generationId/edits/conversation", async (req, res) => {
    try {
      const turns = await getEditConversation(deps.db, res.locals.userId, req.params.projectId, req.params.generationId);
      return turns ? res.json({ turns }) : res.status(404).json({ error: "not_found" });
    } catch { return res.status(500).json({ error: "internal" }); }
  });
  router.post("/:projectId/generations/:generationId/edits/acknowledge", async (req, res) => {
    const { requestId, revision } = req.body ?? {};
    if (typeof requestId !== "string" || !requestId.trim() || requestId.length > 200 || !Number.isSafeInteger(revision) || revision < 1) return res.status(400).json({ error: "invalid_request" });
    try {
      const status = await acknowledgeEditInterpretation(deps.db, res.locals.userId, req.params.projectId, req.params.generationId, requestId, revision);
      return status === "applied" ? res.json({ status, revision }) : res.status(status === "not_found" ? 404 : 409).json({ error: status });
    } catch { return res.status(500).json({ error: "internal" }); }
  });
  return router;
}
