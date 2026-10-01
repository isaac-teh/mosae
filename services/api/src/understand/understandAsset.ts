import path from "node:path";
import sharp from "sharp";
import { MAX_UNDERSTAND_ATTEMPTS, type PhotoAnalysis, type ShotAnalysis, type TranscriptLine, type VideoShotAnalysis } from "../domain/understanding.js";
import { PermanentIngestError } from "../ingest/errors.js";
import type { ObjectStore } from "../ingest/objectStore.js";
import type { Asset } from "../store/finalizeStore.js";
import type { ShotRef, UnderstandCommit } from "../store/understandStore.js";
import type { VideoFile } from "./analyze.js";
import { faceCropRect } from "./faceCrops.js";
import { embedImages, type EmbedImageContent } from "./embed.js";
export type UnderstandTask = { projectId: string; assetId: string; generation: string; attempt?: number };
export type UnderstandResult = "understood" | "failed" | "skipped";
export type UnderstandDeps = {
  loadAsset(projectId: string, assetId: string): Promise<Asset | null>; loadShots(projectId: string, assetId: string): Promise<ShotRef[]>; objects: ObjectStore;
  analyzePhoto(input: { assetId: string; shotId: string; renderPath: string }): Promise<PhotoAnalysis>; analyzeVideo(input: { assetId: string; file: VideoFile; shotCount: number; durationSec: number }): Promise<{ shots: VideoShotAnalysis[]; transcript: TranscriptLine[] }>;
  embedShots(shots: { shotId: string; analysis: ShotAnalysis }[]): Promise<{ shotId: string; embedding: number[] | null }[]>; embedImageContent: EmbedImageContent; uploadVideoFile(path: string): Promise<VideoFile & { name: string }>; deleteVideoFile(name: string): Promise<void>;
  commitUnderstood(input: UnderstandCommit): Promise<"understood" | "skipped">; commitUnderstandFailed(input: { projectId: string; assetId: string; generation: string; reason: string; now: number }): Promise<"failed" | "skipped">; settle(projectId: string): Promise<void>; makeWorkDir(): Promise<string>; removeWorkDir(dir: string): Promise<void>; now(): number;
};
async function commit(deps: UnderstandDeps, asset: Asset, shots: { shotId: string; analysis: ShotAnalysis; embedding: number[] | null; faceEmbeddings?: Record<string, number[]> }[], transcript: TranscriptLine[] | null): Promise<UnderstandResult> { return deps.commitUnderstood({ projectId: asset.projectId, assetId: asset.id, generation: asset.generation, shots, transcript, now: deps.now() }); }
async function understandOriginal(deps: UnderstandDeps, asset: Asset, shots: ShotRef[], workDir: string): Promise<UnderstandResult> {
  if (asset.media?.kind === "photo") {
    if (!asset.derivatives?.renderPath) throw new PermanentIngestError("missing_derivatives");
    const renderPath = path.join(workDir, "render.jpg"); await deps.objects.downloadCurrent({ path: asset.derivatives.renderPath, destination: renderPath });
    const analysis = await deps.analyzePhoto({ assetId: asset.id, shotId: shots[0].id, renderPath }); const embedded = await deps.embedShots([{ shotId: shots[0].id, analysis }]);
    let faceEmbeddings: Record<string, number[]> | undefined;
    if (analysis.faces?.length) {
      const metadata = await sharp(renderPath).metadata();
      const size = { width: metadata.width ?? 0, height: metadata.height ?? 0 };
      const candidates = analysis.faces.flatMap((face) => {
        const rect = faceCropRect(face, size);
        return rect ? [{ face, rect }] : [];
      });
      const images = await Promise.all(candidates.map(async ({ face, rect }) => ({
        id: face.faceId,
        jpeg: await sharp(renderPath).extract(rect).jpeg({ quality: 90 }).toBuffer(),
      })));
      const vectors = await embedImages(deps.embedImageContent, images);
      if (vectors.size > 0) faceEmbeddings = Object.fromEntries(vectors);
    }
    return commit(deps, asset, [{ shotId: shots[0].id, analysis, embedding: embedded[0]?.embedding ?? null, ...(faceEmbeddings ? { faceEmbeddings } : {}) }], null);
  }
  if (!asset.derivatives?.proxyPath) throw new PermanentIngestError("missing_derivatives");
  const proxyPath = path.join(workDir, "proxy.mp4"); await deps.objects.downloadCurrent({ path: asset.derivatives.proxyPath, destination: proxyPath }); const file = await deps.uploadVideoFile(proxyPath);
  try { const { shots: analyses, transcript } = await deps.analyzeVideo({ assetId: asset.id, file, shotCount: shots.length, durationSec: asset.media?.durationSec ?? 0 }); const withAnalysis = shots.map((shot, i) => ({ shotId: shot.id, analysis: analyses[i] as ShotAnalysis })); const embedded = await deps.embedShots(withAnalysis); const embeddings = new Map(embedded.map((item) => [item.shotId, item.embedding])); return commit(deps, asset, withAnalysis.map((item) => ({ ...item, embedding: embeddings.get(item.shotId) ?? null })), transcript); } finally { await deps.deleteVideoFile(file.name); }
}

/** Credentials and malformed Gemini requests cannot improve on a retry. */
function permanentGeminiError(error: unknown): PermanentIngestError | null {
  const status = (error as { status?: unknown } | null)?.status;
  const message = error instanceof Error ? error.message : String(error);
  if (status === 400 || status === 401 || status === 403 || /api.?key|credential|unauthenticated|permission denied/i.test(message)) {
    return new PermanentIngestError("gemini_auth_failed");
  }
  return null;
}
export async function understandAsset(deps: UnderstandDeps, task: UnderstandTask): Promise<UnderstandResult> {
  const asset = await deps.loadAsset(task.projectId, task.assetId); if (!asset || asset.generation !== task.generation) return "skipped";
  if (asset.status !== "ingested") { await deps.settle(task.projectId); return "skipped"; }
  const shots = await deps.loadShots(task.projectId, task.assetId); const workDir = await deps.makeWorkDir(); let result: UnderstandResult;
  try { if (shots.length === 0) throw new PermanentIngestError("no_shots"); result = await understandOriginal(deps, asset, shots, workDir); }
  catch (error) { let permanent: PermanentIngestError; const geminiError = permanentGeminiError(error); if (error instanceof PermanentIngestError) permanent = error; else if (geminiError) permanent = geminiError; else { if ((task.attempt ?? 0) + 1 < MAX_UNDERSTAND_ATTEMPTS) throw error; console.error("understand retries exhausted", task.projectId, task.assetId, error); permanent = new PermanentIngestError("retries_exhausted"); } result = await deps.commitUnderstandFailed({ projectId: asset.projectId, assetId: asset.id, generation: asset.generation, reason: permanent.reason, now: deps.now() }); }
  finally { await deps.removeWorkDir(workDir); }
  if (result === "understood" || result === "failed") await deps.settle(asset.projectId); return result;
}
