import type { UploadPreparationProgress, UploadProgress } from "./uploads";
import { runUploadRecovery, type UploadRecoveryOwner } from "./uploadRecovery";

// Hands File objects from the landing page to /pick-memory within the same SPA session.
// Files can't be serialized into a URL, and they don't need to outlive the tab.
// Read without clearing so React StrictMode's double-invoked state initializers see the same files;
// the next landing-page upload replaces them.
let pending: { file: File; assetId: string | null; sessionId: string | null }[] = [];
let uploadProgress: UploadProgress | null = null;
let preparationProgress: UploadPreparationProgress | null = null;
let uploadFailure: string | null = null;
let pendingProjectId: string | null = null;
const progressListeners = new Set<() => void>();

export function setUploadProgress(progress: UploadProgress | null) {
  uploadProgress = progress;
  progressListeners.forEach((listener) => listener());
}

export function getUploadProgress() { return uploadProgress; }
export function setUploadPreparationProgress(progress: UploadPreparationProgress | null) {
  preparationProgress = progress;
  progressListeners.forEach((listener) => listener());
}
export function getUploadPreparationProgress() { return preparationProgress; }
export function setUploadFailure(message: string | null) {
  uploadFailure = message;
  progressListeners.forEach((listener) => listener());
}
export function getUploadFailure() { return uploadFailure; }
export function subscribeUploadProgress(listener: () => void) {
  progressListeners.add(listener);
  return () => progressListeners.delete(listener);
}

export function setPendingMedia(files: File[], assetIds: string[] = [], projectId: string | null = null, sessionIds: string[] = []) {
  if (files.length === 0 && projectId === null) {
    retryOwners.clear();
    recoveryOwners.clear();
    retryingProjects.clear();
  }
  pendingProjectId = projectId;
  pending = files.map((file, index) => ({ file, assetId: assetIds[index] ?? null, sessionId: sessionIds[index] ?? null }));
  progressListeners.forEach((listener) => listener());
}

export function getPendingMediaProjectId() { return pendingProjectId; }

export function getPendingMedia(): File[] {
  return pending.map(({ file }) => file);
}

export function getPendingMediaAssets() { return pending; }

const retryOwners = new Map<string, () => Promise<void>>();
const recoveryOwners = new Map<string, UploadRecoveryOwner>();
const retryingProjects = new Set<string>();
export function setPendingMediaRetry(projectId: string, retry: () => Promise<void>) {
  retryOwners.set(projectId, retry);
}
export function hasPendingMediaRetry(projectId: string) { return retryOwners.has(projectId); }
export function setUploadRecoveryOwner(owner: UploadRecoveryOwner) { recoveryOwners.set(owner.projectId, owner); }
export function getUploadRecoveryOwner(projectId: string) { return recoveryOwners.get(projectId) ?? null; }
export async function retryPendingMedia(projectId: string): Promise<boolean> {
  const retry = retryOwners.get(projectId);
  if (!retry) return false;
  const recovery = recoveryOwners.get(projectId);
  if (recovery) {
    try {
      const result = await runUploadRecovery(recovery, retry);
      return result !== false;
    } finally {
      if (uploadProgress) uploadProgress = { ...uploadProgress };
      progressListeners.forEach((listener) => listener());
    }
  }
  if (retryingProjects.has(projectId)) return false;
  retryingProjects.add(projectId);
  try { await retry(); return true; }
  finally { retryingProjects.delete(projectId); }
}
