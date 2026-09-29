import { Router, type RequestHandler } from "express";
import type { Firestore } from "firebase-admin/firestore";
import { applyEdits, type EditOp, type Timeline } from "@mosae/contracts";
import { requireUser } from "../auth/requireUser.js";
import { newOutboxTask } from "../domain/outbox.js";
import { isValidId } from "../domain/ids.js";

export function editRenderRouter(deps: { db: Firestore; auth?: RequestHandler; dispatch?: () => Promise<unknown>; downloadUrl?: (path: string) => Promise<string>; now?: () => number }): Router {
  const router = Router();
  router.use(deps.auth ?? requireUser());
  for (const name of ["projectId", "generationId"]) {
    router.param(name, (_req, res, next, value: string) => {
      if (!isValidId(value)) { res.status(404).json({ error: "not_found" }); return; }
      next();
    });
  }
  router.param("revision", (_req, res, next, value: string) => {
    if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value))) { res.status(404).json({ error: "not_found" }); return; }
    next();
  });
  const path = "/:projectId/generations/:generationId/edits/:revision/render";
  router.post(path, async (req, res) => {
    try {
      const project = deps.db.collection("projects").doc(req.params.projectId);
      const generation = project.collection("generations").doc(req.params.generationId);
      const current = generation.collection("edits").doc("current");
      const revision = Number(req.params.revision);
      const revisionDoc = current.collection("revisions").doc(String(revision));
      const task = newOutboxTask({ projectId: req.params.projectId, subjectKind: "generation", subjectId: req.params.generationId, generation: `edit-${revision}`, stage: "render", now: (deps.now ?? Date.now)() });
      const result = await deps.db.runTransaction(async (tx) => {
        const [projectSnap, generationSnap, currentSnap, revisionSnap] = await Promise.all([
          tx.get(project), tx.get(generation), tx.get(current), tx.get(revisionDoc),
        ]);
        if (!projectSnap.exists || projectSnap.get("userId") !== res.locals.userId || !generationSnap.exists || !revisionSnap.exists) return { status: "not_found" as const };
        if (!currentSnap.exists || currentSnap.get("revision") !== revision) return { status: "stale" as const };
        const timeline = generationSnap.get("timeline") as Timeline | null;
        if (!timeline) return { status: "invalid" as const, error: "timeline_unavailable" };
        const applied = applyEdits(timeline, revisionSnap.get("ops") as EditOp[]);
        if (!applied.ok) return { status: "invalid" as const, error: applied.error };
        if (currentSnap.get("renderRevision") === revision && ["rendering", "ready"].includes(currentSnap.get("status") as string)) return { status: "existing" as const };
        tx.set(current, { renderRevision: revision, status: "rendering", outputPath: null }, { merge: true });
        tx.set(revisionDoc, { status: "rendering", outputPath: null }, { merge: true });
        tx.set(project.collection("taskOutbox").doc(task.id), task);
        return { status: "queued" as const };
      });
      if (result.status === "not_found") return res.status(404).json({ error: "not_found" });
      if (result.status === "stale") return res.status(409).json({ error: "stale_revision" });
      if (result.status === "invalid") return res.status(422).json({ error: result.error });
      if (result.status === "queued") await deps.dispatch?.();
      return res.status(202).json({ renderId: task.id });
    } catch (error) {
      console.error("request edit render failed", error);
      return res.status(500).json({ error: "internal" });
    }
  });
  router.get(path, async (req, res) => {
    try {
      const project = deps.db.collection("projects").doc(req.params.projectId);
      const projectSnap = await project.get();
      if (!projectSnap.exists || projectSnap.get("userId") !== res.locals.userId) return res.status(404).json({ error: "not_found" });
      const generation = project.collection("generations").doc(req.params.generationId);
      if (!(await generation.get()).exists) return res.status(404).json({ error: "not_found" });
      const snap = await generation.collection("edits").doc("current").collection("revisions").doc(req.params.revision).get();
      if (!snap.exists) return res.status(404).json({ error: "not_found" });
      const data = snap.data()!;
      const outputPath = typeof data.outputPath === "string" ? data.outputPath : undefined;
      const downloadUrl = data.status === "ready" && outputPath && deps.downloadUrl ? await deps.downloadUrl(outputPath) : undefined;
      const renderProgress = typeof data.renderProgress === "number" ? data.renderProgress : undefined;
      return res.json({ revision: data.revision, status: data.status ?? "pending", ...(renderProgress === undefined ? {} : { renderProgress }), ...(outputPath ? { outputPath } : {}), ...(downloadUrl ? { downloadUrl } : {}) });
    } catch (error) {
      console.error("get edit render failed", error);
      return res.status(500).json({ error: "internal" });
    }
  });
  return router;
}
