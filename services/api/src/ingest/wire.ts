import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Firestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { MAX_INGEST_BYTES } from "../domain/media.js";
import { getAdminApp } from "../firebase/admin.js";
import { commitFailed, commitIngested, loadAsset } from "../store/ingestStore.js";
import { ingestAsset, type IngestDeps, type IngestResult, type IngestTask } from "./ingestAsset.js";
import { firebaseObjectStore } from "./objectStore.js";
import { probeMedia } from "./probe.js";
import { makePhotoDerivatives, makeVideoDerivatives } from "./proxies.js";
import { analyzeImage } from "./quality.js";
import { detectShots } from "./shots.js";

/**
 * Glue only: every behaviour lives in a module with its own tests, and the
 * emulator flow test in Task 13 exercises this wiring end to end. The bucket is
 * resolved per call so the server still boots without Storage credentials.
 */
export function createIngest(config: {
  db: Firestore;
  bucketName: string;
  settle: (projectId: string) => Promise<void>;
}): (task: IngestTask) => Promise<IngestResult> {
  return (task) => {
    const deps: IngestDeps = {
      loadAsset: (projectId, assetId) => loadAsset(config.db, projectId, assetId),
      objects: firebaseObjectStore(getStorage(getAdminApp()).bucket(config.bucketName)),
      probe: (file, kind) => probeMedia(file, kind),
      photoDerivatives: (input, outDir) => makePhotoDerivatives(input, outDir),
      videoDerivatives: (input, outDir, durationSec) => makeVideoDerivatives(input, outDir, durationSec),
      analyze: analyzeImage,
      detectShots: (proxy, durationSec) => detectShots(proxy, durationSec),
      commitIngested: (commit) => commitIngested(config.db, commit),
      commitFailed: (input) => commitFailed(config.db, input),
      settle: config.settle,
      makeWorkDir: () => mkdtemp(path.join(tmpdir(), "mosae-ingest-")),
      removeWorkDir: (dir) => rm(dir, { recursive: true, force: true }),
      maxBytes: MAX_INGEST_BYTES,
      now: Date.now,
    };
    return ingestAsset(deps, task);
  };
}
