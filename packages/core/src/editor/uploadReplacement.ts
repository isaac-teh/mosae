import type { EditorMediaItem, StoryRepository } from "../story/repository";
import { uploadMedia, type UploadDeps, type UploadProgress } from "../uploads";

/** Invalidates pending UI completions when a replacement sheet or target is abandoned. */
export function createReplacementGuard() {
  let nonce = 0;
  return {
    begin: () => ++nonce,
    invalidate: () => { nonce += 1; },
    isCurrent: (candidate: number) => candidate === nonce,
  };
}

export type UploadReplacementOptions = {
  projectId: string;
  generationId: string;
  repository: Pick<StoryRepository, "getFilmTimeline">;
  onProgress?: (progress: UploadProgress) => void;
  timeoutMs?: number;
  pollIntervalMs?: number;
};

/** Uploads into the current project, then waits for the server to expose its real shot record. */
export async function uploadReplacement(
  file: File,
  options: UploadReplacementOptions,
  uploadDeps?: UploadDeps,
  runtime: { now?: () => number; wait?: (ms: number) => Promise<void> } = {},
): Promise<EditorMediaItem> {
  const upload = await uploadMedia([file], {
    mode: "memory",
    projectId: options.projectId,
    onProgress: options.onProgress,
  }, uploadDeps);
  if (!upload.finished || !upload.assetIds.length) throw new Error("replacement_upload_failed");

  const now = runtime.now ?? Date.now;
  const wait = runtime.wait ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const timeoutMs = Math.max(0, options.timeoutMs ?? 60_000);
  const pollIntervalMs = Math.max(1, options.pollIntervalMs ?? 1_000);
  const deadline = now() + timeoutMs;
  while (true) {
    const film = await options.repository.getFilmTimeline(options.projectId, options.generationId);
    const media = film.unusedMedia?.find((item) => upload.assetIds.some((assetId) => item.shotId.startsWith(`${assetId}_`)));
    if (media) return media;
    if (now() >= deadline) throw new Error("replacement_media_not_ready");
    await wait(Math.min(pollIntervalMs, deadline - now()));
  }
}
