import { Router, type RequestHandler } from "express";
import type { Firestore } from "firebase-admin/firestore";
import { requireUser } from "../auth/requireUser.js";
import { buildDerivativePath, isValidId } from "../domain/ids.js";
import type { ThumbnailUrlStore } from "../ingest/objectStore.js";
import { getOwnedProject } from "../store/projectStore.js";

export function thumbnailsRouter(deps: {
  db: Firestore;
  thumbnails: ThumbnailUrlStore;
  auth?: RequestHandler;
  now?: () => number;
}): Router {
  const router = Router();
  router.use(deps.auth ?? requireUser());
  router.get("/:projectId/assets/:assetId/thumbnail", async (req, res) => {
    res.set("Cache-Control", "private, no-store");
    const { projectId, assetId } = req.params;
    const userId: string = res.locals.userId;
    if (![projectId, assetId, userId].every(isValidId)) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    try {
      if (!await getOwnedProject(deps.db, userId, projectId)) {
        res.status(404).json({ error: "not_found" });
        return;
      }
      const asset = await deps.db.collection("projects").doc(projectId).collection("assets").doc(assetId).get();
      const path: unknown = asset.data()?.derivatives?.thumbPath;
      const generation = typeof path === "string" ? path.split("/")[4] : undefined;
      // Only sign this owner's persisted thumbnail, never a caller-supplied object path.
      if (!generation || !isValidId(generation) || path !== buildDerivativePath({ userId, projectId, assetId, generation }, "thumb.jpg")) {
        res.status(404).json({ error: "not_found" });
        return;
      }
      const expiresAt = (deps.now ?? Date.now)() + 5 * 60 * 1000;
      const url = await deps.thumbnails.signedReadUrl(path, expiresAt);
      res.json({ url, expiresAt });
    } catch (error) {
      console.error("thumbnail URL failed", projectId, assetId, error);
      res.status(500).json({ error: "internal" });
    }
  });
  return router;
}
