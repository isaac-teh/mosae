import path from "node:path";
import { buildDerivativePath } from "../domain/ids.js";
import { MAX_INGEST_ATTEMPTS, type Derivatives, type MediaFacts, type MediaKind, type QualityFacts } from "../domain/media.js";
import type { Asset } from "../store/finalizeStore.js";
import type { IngestCommit } from "../store/ingestStore.js";
import { PermanentIngestError } from "./errors.js";
import type { ObjectStore } from "./objectStore.js";
import type { PhotoDerivatives, VideoDerivatives } from "./proxies.js";
import type { ShotRange } from "./shots.js";

export type IngestTask = { projectId: string; assetId: string; generation: string; attempt?: number };
export type IngestResult = "ingested" | "failed" | "skipped";

export type IngestDeps = {
  loadAsset(projectId: string, assetId: string): Promise<Asset | null>;
  objects: ObjectStore;
  probe(file: string, kind: MediaKind): Promise<MediaFacts>;
  photoDerivatives(input: string, outDir: string): Promise<PhotoDerivatives>;
  videoDerivatives(input: string, outDir: string, durationSec: number): Promise<VideoDerivatives>;
  analyze(file: string): Promise<QualityFacts>;
  detectShots(proxy: string, durationSec: number): Promise<ShotRange[]>;
  commitIngested(commit: IngestCommit): Promise<"ingested" | "skipped">;
  commitFailed(input: { projectId: string; assetId: string; generation: string; reason: string; now: number }): Promise<"failed" | "skipped">;
  settle(projectId: string): Promise<void>;
  dispatchDue(): Promise<void>;
  makeWorkDir(): Promise<string>;
  removeWorkDir(dir: string): Promise<void>;
  maxBytes: number;
  now(): number;
};

/** heif-convert decides by extension, so HEIC and HEIF originals keep theirs. */
export function extensionFor(contentType: string): string {
  if (contentType === "image/heic") return ".heic";
  if (contentType === "image/heif") return ".heif";
  return "";
}

async function ingestOriginal(deps: IngestDeps, asset: Asset, workDir: string): Promise<IngestResult> {
  if (asset.sizeBytes > deps.maxBytes) throw new PermanentIngestError("too_large_for_ingest");

  const kind: MediaKind = asset.contentType.startsWith("video/") ? "video" : "photo";
  const original = path.join(workDir, `original${extensionFor(asset.contentType)}`);
  await deps.objects.download({ path: asset.storagePath, generation: asset.generation, destination: original });

  const media = await deps.probe(original, kind);
  const owner = { userId: asset.userId, projectId: asset.projectId, assetId: asset.id, generation: asset.generation };
  const thumbPath = buildDerivativePath(owner, "thumb.jpg");
  const uploads: { source: string; path: string; contentType: string }[] = [];
  let derivatives: Derivatives;
  let quality: QualityFacts;
  let ranges: ShotRange[] = [];

  if (kind === "photo") {
    const made = await deps.photoDerivatives(original, workDir);
    const renderPath = buildDerivativePath(owner, "render.jpg");
    derivatives = { thumbPath, renderPath, proxyPath: null };
    uploads.push({ source: made.thumb, path: thumbPath, contentType: "image/jpeg" }, { source: made.render, path: renderPath, contentType: "image/jpeg" });
    quality = await deps.analyze(made.thumb);
  } else {
    const durationSec = media.durationSec ?? 0;
    const made = await deps.videoDerivatives(original, workDir, durationSec);
    const proxyPath = buildDerivativePath(owner, "proxy.mp4");
    derivatives = { thumbPath, renderPath: null, proxyPath };
    uploads.push({ source: made.thumb, path: thumbPath, contentType: "image/jpeg" }, { source: made.proxy, path: proxyPath, contentType: "video/mp4" });
    quality = await deps.analyze(made.thumb);
    ranges = await deps.detectShots(made.proxy, durationSec);
  }

  // Derivatives first, commit last: a reader that sees "ingested" can always fetch the files.
  for (const upload of uploads) await deps.objects.upload(upload);

  return await deps.commitIngested({
    projectId: asset.projectId, assetId: asset.id, generation: asset.generation,
    media, quality, derivatives, ranges, now: deps.now(),
  });
}

export async function ingestAsset(deps: IngestDeps, task: IngestTask): Promise<IngestResult> {
  const asset = await deps.loadAsset(task.projectId, task.assetId);
  if (!asset || asset.generation !== task.generation) return "skipped";
  if (asset.status !== "uploaded") {
    await deps.settle(task.projectId);
    await deps.dispatchDue();
    return "skipped";
  }

  const workDir = await deps.makeWorkDir();
  let result: IngestResult;
  try {
    result = await ingestOriginal(deps, asset, workDir);
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
  }
  if (result === "ingested" || result === "failed") await deps.settle(asset.projectId);
  if (result === "ingested") await deps.dispatchDue();
  return result;
}
