// Hands File objects from the landing page to /pick-memory within the same SPA session.
// Files can't be serialized into a URL, and they don't need to outlive the tab.
// Read without clearing so React StrictMode's double-invoked state initializers see the same files;
// the next landing-page upload replaces them.
let pending: File[] = [];

export function setPendingMedia(files: File[]) {
  pending = files;
}

export function getPendingMedia(): File[] {
  return pending;
}
