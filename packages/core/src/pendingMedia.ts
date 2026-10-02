import type { UploadPreparationProgress, UploadProgress } from "./uploads";

// Hands File objects from the landing page to /pick-memory within the same SPA session.
// Files can't be serialized into a URL, and they don't need to outlive the tab.
// Read without clearing so React StrictMode's double-invoked state initializers see the same files;
// the next landing-page upload replaces them.
let pending: { file: File; assetId: string | null }[] = [];
let uploadProgress: UploadProgress | null = null;
let preparationProgress: UploadPreparationProgress | null = null;
let uploadFailure: string | null = null;
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

export function setPendingMedia(files: File[], assetIds: string[] = []) {
  pending = files.map((file, index) => ({ file, assetId: assetIds[index] ?? null }));
  progressListeners.forEach((listener) => listener());
}

export function getPendingMedia(): File[] {
  return pending.map(({ file }) => file);
}

export function getPendingMediaAssets() { return pending; }
