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
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { fixturePlaceResolver, googlePlaceResolver, nominatimPlaceResolver, type GeocodeResult, type PlaceResolver } from "../understand/place.js";

export async function loadPlaceResolver(db: Firestore, env: NodeJS.ProcessEnv = process.env, fetchImpl: typeof fetch = fetch): Promise<PlaceResolver> {
  const apiKey = env.GOOGLE_MAPS_API_KEY;
  if (apiKey) return googlePlaceResolver(apiKey, fetchImpl);
  const mode = env.PLACE_RESOLVER ?? (env.NODE_ENV === "production" ? "nominatim" : "fixtures");
  if (mode === "nominatim") return nominatimPlaceResolver(db, env.NOMINATIM_CONTACT ?? "", { fetchImpl });
  if (mode !== "fixtures") throw new Error(`Unknown PLACE_RESOLVER: ${mode}`);
  const directory = fileURLToPath(new URL("../../fixtures/places/", import.meta.url));
  const table: Record<string, GeocodeResult[]> = {};
  for (const file of (await readdir(directory)).filter((entry) => entry.endsWith(".json")).sort()) {
    Object.assign(table, JSON.parse(await readFile(path.join(directory, file), "utf8")) as Record<string, GeocodeResult[]>);
  }
  return fixturePlaceResolver(table);
}

/**
 * Glue only: every behaviour lives in a module with its own tests, and the
 * emulator flow test in Task 13 exercises this wiring end to end. The bucket is
 * resolved per call so the server still boots without Storage credentials.
 */
export function createIngest(config: {
  db: Firestore;
  bucketName: string;
  settle: (projectId: string) => Promise<void>;
  dispatchDue: () => Promise<void>;
}): (task: IngestTask) => Promise<IngestResult> {
  // One resolver per API process shares the in-flight key map and Nominatim queue.
  let resolver: Promise<PlaceResolver> | null = null;
  return async (task) => {
    const deps: IngestDeps = {
      loadAsset: (projectId, assetId) => loadAsset(config.db, projectId, assetId),
      objects: firebaseObjectStore(getStorage(getAdminApp()).bucket(config.bucketName)),
      probe: (file, kind) => probeMedia(file, kind),
      placeResolver: await (resolver ??= loadPlaceResolver(config.db)),
      photoDerivatives: (input, outDir, onTiming) => makePhotoDerivatives(input, outDir, undefined, onTiming),
      videoDerivatives: (input, outDir, durationSec, onTiming) => makeVideoDerivatives(input, outDir, durationSec, undefined, onTiming),
      analyze: analyzeImage,
      detectShots: (proxy, durationSec) => detectShots(proxy, durationSec),
      commitIngested: (commit) => commitIngested(config.db, commit),
      commitFailed: (input) => commitFailed(config.db, input),
      settle: config.settle,
      dispatchDue: config.dispatchDue,
      makeWorkDir: () => mkdtemp(path.join(tmpdir(), "mosae-ingest-")),
      removeWorkDir: (dir) => rm(dir, { recursive: true, force: true }),
      maxBytes: MAX_INGEST_BYTES,
      now: Date.now,
    };
    return ingestAsset(deps, task);
  };
}
