import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Firestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { getAdminApp } from "../firebase/admin.js";
import { firebaseObjectStore } from "../ingest/objectStore.js";
import { PermanentIngestError } from "../ingest/errors.js";
import { createGenAI, createEmbedClient, createImageEmbedClient, createFileClient, createGeminiClient, geminiConfigured, deleteFileVia, embedContentVia, generateContentVia, recordUsageToLog, uploadAndWaitActive } from "../gemini/wire.js";
import { loadAsset } from "../store/ingestStore.js";
import { commitUnderstandFailed, commitUnderstood, loadShotsForAsset } from "../store/understandStore.js";
import { analyzePhoto, analyzeVideo } from "./analyze.js";
import { embedShotAnalyses } from "./embed.js";
import { understandAsset, type UnderstandDeps, type UnderstandResult, type UnderstandTask } from "./understandAsset.js";
export function createUnderstand(config: { db: Firestore; bucketName: string; geminiApiKey?: string; settle: (projectId: string) => Promise<void> }): (task: UnderstandTask) => Promise<UnderstandResult> {
  const usable = geminiConfigured(config.geminiApiKey);
  const generateContent = usable ? createGeminiClient(config.geminiApiKey) : undefined;
  const embedContent = usable ? createEmbedClient(config.geminiApiKey) : undefined;
  const embedImageContent = usable ? createImageEmbedClient(config.geminiApiKey) : undefined;
  const fileClient = usable ? createFileClient(config.geminiApiKey) : undefined;
  return (task) => {
    if (!generateContent || !embedContent) throw new PermanentIngestError("gemini_api_key_missing");
    const gemini = { generateContent, recordUsage: recordUsageToLog(config.db, { projectId: task.projectId }) };
    const unavailable = async (): Promise<never> => { throw new PermanentIngestError("gemini_api_key_missing"); };
    const deps: UnderstandDeps = { loadAsset: (projectId, assetId) => loadAsset(config.db, projectId, assetId), loadShots: (projectId, assetId) => loadShotsForAsset(config.db, projectId, assetId), objects: firebaseObjectStore(getStorage(getAdminApp()).bucket(config.bucketName)), analyzePhoto: (input) => analyzePhoto(gemini, input), analyzeVideo: (input) => analyzeVideo(gemini, input), embedShots: (shots) => embedShotAnalyses(embedContent, shots), embedImageContent: embedImageContent!, uploadVideoFile: (filePath) => fileClient!.upload({ path: filePath, mimeType: "video/mp4" }), deleteVideoFile: (name) => fileClient!.delete(name), commitUnderstood: (input) => commitUnderstood(config.db, input), commitUnderstandFailed: (input) => commitUnderstandFailed(config.db, input), settle: config.settle, makeWorkDir: () => mkdtemp(path.join(tmpdir(), "mosae-understand-")), removeWorkDir: (dir) => rm(dir, { recursive: true, force: true }), now: Date.now }; return understandAsset(deps, task); };
}
