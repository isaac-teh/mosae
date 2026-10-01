// Hands File objects from the landing page to /pick-memory within the same SPA session.
// Files can't be serialized into a URL, and they don't need to outlive the tab.
// Read without clearing so React StrictMode's double-invoked state initializers see the same files;
// the next landing-page upload replaces them.
let pending: { file: File; assetId: string | null }[] = [];

export function setPendingMedia(files: File[], assetIds: string[] = []) {
  pending = files.map((file, index) => ({ file, assetId: assetIds[index] ?? null }));
}

export function getPendingMedia(): File[] {
  return pending.map(({ file }) => file);
}

export function getPendingMediaAssets() { return pending; }
