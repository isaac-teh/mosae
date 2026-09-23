import type { Firestore } from "firebase-admin/firestore";
import { recordFinalize } from "./finalizeStore.js";

export type StorageObject = { name: string; generation: string; sizeBytes: number; contentType: string };

export type StoragePollerDeps = {
  db: Firestore;
  bucketName: string;
  listUploads(): Promise<StorageObject[]>;
  onAccepted(): Promise<void>;
  now?: () => number;
};

/**
 * The Storage emulator emits no finalize events, so locally nothing else
 * turns an uploaded object into an asset. This polls the emulator's
 * `uploads/` listing and replays finalize for anything not seen yet — the
 * same call the one-shot `replay:finalize` script makes, but continuously.
 * `recordFinalize` is idempotent, so re-polling an already-accepted object
 * is harmless; a key is remembered locally only to skip the extra
 * transaction on later polls.
 */
export function startStoragePoller(deps: StoragePollerDeps, intervalMs = 3000): () => void {
  const now = deps.now ?? Date.now;
  const seen = new Set<string>();
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  async function poll(): Promise<void> {
    if (stopped) return;
    try {
      const objects = await deps.listUploads();
      let accepted = false;
      for (const object of objects) {
        const key = `${object.name}@${object.generation}`;
        if (seen.has(key)) continue;
        const result = await recordFinalize(deps.db, deps.bucketName, {
          bucket: deps.bucketName,
          objectName: object.name,
          generation: object.generation,
          sizeBytes: object.sizeBytes,
          contentType: object.contentType,
          now: now(),
        });
        if (result.kind === "accepted") {
          console.log("dev finalize", object.name, result.kind);
          seen.add(key);
          accepted = true;
        } else if (result.kind === "duplicate" || result.kind === "rejected") {
          // Terminal for this object/generation: never accepted, and never will be.
          seen.add(key);
        }
        // Any other outcome (e.g. "unregistered", "stale") may resolve once
        // the project catches up, so it is left un-seen for the next poll.
      }
      if (accepted) await deps.onAccepted();
    } catch (error) {
      console.error("dev storage poller failed", error);
    } finally {
      if (!stopped) timer = setTimeout(poll, intervalMs);
    }
  }

  void poll();
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}
