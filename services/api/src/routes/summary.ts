import { gatherSummaryUpload } from "../store/readinessStore.js";
import { Router, type RequestHandler } from "express";
import type { Firestore } from "firebase-admin/firestore";
import { requireUser } from "../auth/requireUser.js";
import { isValidId } from "../domain/ids.js";
import { getProjectFaces } from "../store/understandStore.js";
import { summarise, type SummaryAsset } from "../directing/summary.js";

export function summaryRouter(deps: { db: Firestore; auth?: RequestHandler }): Router {
  const router = Router();
  router.use(deps.auth ?? requireUser());
  router.param("projectId", (_req, res, next, value: string) => {
    if (!isValidId(value)) { res.status(404).json({ error: "not_found" }); return; }
    next();
  });
  router.get("/:projectId/summary", async (req, res) => {
    try {
      const project = deps.db.collection("projects").doc(req.params.projectId);
      const projectSnap = await project.get();
      if (!projectSnap.exists || projectSnap.get("userId") !== res.locals.userId) return res.status(404).json({ error: "not_found" });
      const [assetSnap, faces] = await Promise.all([project.collection("assets").get(), getProjectFaces(deps.db, req.params.projectId)]);
      const faceAssetIds = new Set(faces.map((face) => face.assetId));
      const assets = assetSnap.docs.map((doc) => {
        const data = doc.data();
        return { ...data, id: doc.id, hasFaces: faceAssetIds.has(doc.id) } as SummaryAsset;
      });
      const proposalId = projectSnap.get("currentProposalId");
      let hasPlan = typeof proposalId === "string";
      if (!hasPlan) hasPlan = !(await project.collection("storyProposals").limit(1).get()).empty;
      const manifest = await gatherSummaryUpload(deps.db, req.params.projectId, assets);
      return res.json(summarise(assets, hasPlan, { ...manifest, projectStatus: projectSnap.get("status") }));
    } catch (error) {
      console.error("summary route failed", error);
      return res.status(500).json({ error: "internal" });
    }
  });
  return router;
}
