export type ProjectStatus = "collecting" | "processing" | "ready" | "ready_with_errors" | "failed";

export type RawProgress = { status: ProjectStatus | null; ingested: number; failed: number };

export type ProjectProgress = {
  status: ProjectStatus;
  total: number;
  done: number;
  failed: number;
  ready: boolean;
  finished: boolean;
};

/** `expectedTotal` is what the picker sent; the server counts can only add to it. */
export function computeProgress(raw: RawProgress, expectedTotal: number): ProjectProgress {
  const status = raw.status ?? "processing";
  const done = raw.ingested + raw.failed;
  const ready = status === "ready" || status === "ready_with_errors";
  return { status, total: Math.max(expectedTotal, done), done, failed: raw.failed, ready, finished: ready || status === "failed" };
}

export function describeProgress(progress: ProjectProgress): string {
  if (progress.status === "failed") return "We couldn't read any of your files. Please try uploading again.";
  if (progress.ready) {
    if (progress.failed === 0) return "Your memories are ready.";
    const noun = progress.failed === 1 ? "file couldn't be read and was" : "files couldn't be read and were";
    return `Your memories are ready. ${progress.failed} ${noun} skipped.`;
  }
  return `Getting your memories ready: ${progress.done} of ${progress.total}`;
}
