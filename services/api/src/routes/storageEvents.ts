import { Router, type RequestHandler } from "express";
import type { Firestore } from "firebase-admin/firestore";
import { recordFinalize } from "../store/finalizeStore.js";

export function storageEventsRouter(deps: {
  db: Firestore;
  bucket: string;
  now?: () => number;
  auth: RequestHandler;
  onAccepted?: () => Promise<void>;
}): Router {
  const now = deps.now ?? Date.now;
  const router = Router();
  router.post("/storage-finalize", deps.auth, async (req, res) => {
    const { bucket, name, generation, size, contentType } = req.body ?? {};
    const sizeBytes = Number(size);
    if (
      typeof bucket !== "string" ||
      typeof name !== "string" ||
      typeof generation !== "string" ||
      !Number.isFinite(sizeBytes)
    ) {
      console.warn("ignoring malformed storage event");
      res.sendStatus(204);
      return;
    }
    try {
      const result = await recordFinalize(deps.db, deps.bucket, {
        bucket,
        objectName: name,
        generation,
        sizeBytes,
        contentType:
          typeof contentType === "string"
            ? contentType
            : "application/octet-stream",
        now: now(),
      });
      if (result.kind === "wrong_bucket") {
        console.error("storage finalize wrong bucket", { expectedBucket: deps.bucket, receivedBucket: bucket });
      } else if (
        result.kind !== "accepted" &&
        result.kind !== "ignored_path" &&
        result.kind !== "duplicate"
      )
        console.warn("storage finalize not accepted", name, result);
      res.sendStatus(204);
      if (result.kind === "accepted" && deps.onAccepted)
        deps
          .onAccepted()
          .catch((error) =>
            console.error("post-finalize dispatch failed", error),
          );
    } catch (error) {
      console.error("storage finalize failed", error);
      res.status(500).json({ error: "internal" });
    }
  });
  return router;
}
