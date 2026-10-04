import path from "node:path";
import { buildDerivativePath } from "../domain/ids.js";
import { MAX_INGEST_ATTEMPTS, type Derivatives, type MediaFacts, type MediaKind, type QualityFacts } from "../domain/media.js";
import type { Asset } from "../store/finalizeStore.js";
import type { IngestCommit } from "../store/ingestStore.js";
import { PermanentIngestError } from "./errors.js";
import type { ObjectStore } from "./objectStore.js";
import type { DerivativeTiming, PhotoDerivatives, VideoDerivatives } from "./proxies.js";
import type { ShotRange } from "./shots.js";
import type { PlaceResolver } from "../understand/place.js";

export type IngestTask = { projectId: string; assetId: string; generation: string; attempt?: number };
export type IngestResult = "ingested" | "failed" | "skipped";

export type IngestDeps = {
  loadAsset(projectId: string, assetId: string): Promise<Asset | null>;
  objects: ObjectStore;
  probe(file: string, kind: MediaKind): Promise<MediaFacts>;
  placeResolver?: PlaceResolver;
  photoDerivatives(input: string, outDir: string, onTiming?: DerivativeTiming): Promise<PhotoDerivatives>;
  videoDerivatives(input: string, outDir: string, durationSec: number, onTiming?: DerivativeTiming): Promise<VideoDerivatives>;
  analyze(file: string): Promise<QualityFacts>;
  detectShots(proxy: string, durationSec: number): Promise<ShotRange[]>;
  commitIngested(commit: IngestCommit, enqueueUnderstand?: boolean): Promise<"ingested" | "skipped">;
  understand?(task: IngestTask): Promise<unknown>;
  commitFailed(input: { projectId: string; assetId: string; generation: string; reason: string; now: number }): Promise<"failed" | "skipped">;
  settle(projectId: string): Promise<void>;
  dispatchDue(): Promise<void>;
  makeWorkDir(): Promise<string>;
  removeWorkDir(dir: string): Promise<void>;
  maxBytes: number;
  now(): number;
};

type IngestTimings = { downloadMs: number; decodeResizeMs: number; thumbMs: number; exifMs: number; uploadDerivativesMs: number; megapixels: number | null };

async function timed<T>(deps: IngestDeps, timings: IngestTimings, stage: "downloadMs" | "exifMs" | "uploadDerivativesMs", operation: () => Promise<T>): Promise<T> {
  const startedAt = deps.now();
  try { return await operation(); }
  finally { timings[stage] += Math.max(0, deps.now() - startedAt); }
}

/** heif-convert decides by extension, so HEIC and HEIF originals keep theirs. */
export function extensionFor(contentType: string): string {
  if (contentType === "image/heic") return ".heic";
  if (contentType === "image/heif") return ".heif";
  return "";
}

async function ingestOriginal(deps: IngestDeps, asset: Asset, workDir: string, timings: IngestTimings): Promise<IngestResult> {
  if (asset.sizeBytes > deps.maxBytes) throw new PermanentIngestError("too_large_for_ingest");

  const kind: MediaKind = asset.contentType.startsWith("video/") ? "video" : "photo";
  const original = path.join(workDir, `original${extensionFor(asset.contentType)}`);
  await timed(deps, timings, "downloadMs", () => deps.objects.download({ path: asset.storagePath, generation: asset.generation, destination: original }));

  const media = await timed(deps, timings, "exifMs", () => deps.probe(original, kind));
  timings.megapixels = media.width > 0 && media.height > 0 ? (media.width * media.height) / 1_000_000 : null;
  const place = media.gps && deps.placeResolver ? await deps.placeResolver.resolve(media.gps).catch(() => null) : null;
  const owner = { userId: asset.userId, projectId: asset.projectId, assetId: asset.id, generation: asset.generation };
  const thumbPath = buildDerivativePath(owner, "thumb.jpg");
  const uploads: { source: string; path: string; contentType: string }[] = [];
  let derivatives: Derivatives;
  let quality: QualityFacts;
  let ranges: ShotRange[] = [];

  if (kind === "photo") {
    const made = await deps.photoDerivatives(original, workDir, (stage, milliseconds) => { timings[stage] += Math.max(0, milliseconds); });
    const renderPath = buildDerivativePath(owner, "render.jpg");
    derivatives = { thumbPath, renderPath, proxyPath: null };
    uploads.push({ source: made.thumb, path: thumbPath, contentType: "image/jpeg" }, { source: made.render, path: renderPath, contentType: "image/jpeg" });
    quality = await deps.analyze(made.thumb);
  } else {
    const durationSec = media.durationSec ?? 0;
    const made = await deps.videoDerivatives(original, workDir, durationSec, (stage, milliseconds) => { timings[stage] += Math.max(0, milliseconds); });
    const proxyPath = buildDerivativePath(owner, "proxy.mp4");
    derivatives = { thumbPath, renderPath: null, proxyPath };
    uploads.push({ source: made.thumb, path: thumbPath, contentType: "image/jpeg" }, { source: made.proxy, path: proxyPath, contentType: "video/mp4" });
    quality = await deps.analyze(made.thumb);
    ranges = await deps.detectShots(made.proxy, durationSec);
  }

  // Derivatives first, commit last: a reader that sees "ingested" can always fetch the files.
  await timed(deps, timings, "uploadDerivativesMs", async () => {
    for (const upload of uploads) await deps.objects.upload(upload);
  });

  const commit = {
    projectId: asset.projectId, assetId: asset.id, generation: asset.generation,
    media, place, quality, derivatives, ranges, now: deps.now(),
  };
  return deps.understand ? deps.commitIngested(commit, false) : deps.commitIngested(commit);
}

export async function ingestAsset(deps: IngestDeps, task: IngestTask): Promise<IngestResult> {
  const totalStartedAt = deps.now();
  const asset = await deps.loadAsset(task.projectId, task.assetId);
  if (!asset || asset.generation !== task.generation) return "skipped";
  if (asset.status !== "uploaded") {
    if (asset.status === "ingested" && deps.understand) await deps.understand(task);
    await deps.settle(task.projectId);
    await deps.dispatchDue();
    return "skipped";
  }

  const timings: IngestTimings = { downloadMs: 0, decodeResizeMs: 0, thumbMs: 0, exifMs: 0, uploadDerivativesMs: 0, megapixels: null };
  const workDir = await deps.makeWorkDir();
  let result: IngestResult;
  try {
    result = await ingestOriginal(deps, asset, workDir, timings);
  } catch (error) {
    let permanent: PermanentIngestError;
    if (error instanceof PermanentIngestError) {
      permanent = error;
    } else {
      if ((task.attempt ?? 0) + 1 < MAX_INGEST_ATTEMPTS) throw error;
      console.error("ingest retries exhausted", task.projectId, task.assetId, error);
      permanent = new PermanentIngestError("retries_exhausted");
    }
    const committed = await deps.commitFailed({
      projectId: asset.projectId, assetId: asset.id, generation: asset.generation, reason: permanent.reason, now: deps.now(),
    });
    result = committed;
  } finally {
    await deps.removeWorkDir(workDir);
    console.info("ingest_timing", {
      queueWaitMs: Number.isFinite(asset.createdAt) ? Math.max(0, totalStartedAt - asset.createdAt) : null,
      downloadMs: timings.downloadMs,
      decodeResizeMs: timings.decodeResizeMs,
      thumbMs: timings.thumbMs,
      exifMs: timings.exifMs,
      uploadDerivativesMs: timings.uploadDerivativesMs,
      totalMs: Math.max(0, deps.now() - totalStartedAt),
      bytes: asset.sizeBytes,
      megapixels: timings.megapixels,
    });
  }
  if (result === "ingested" && deps.understand) await deps.understand(task);
  if (result === "ingested" || result === "failed") await deps.settle(asset.projectId);
  if (result === "ingested") await deps.dispatchDue();
  return result;
}
