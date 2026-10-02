import { ref, uploadBytesResumable } from "firebase/storage";
import { prepareUploadFiles } from "./prepareUploadFiles";

export const ENTRY_BATCH = 500;
export const DEFAULT_CONCURRENCY = 4;

export type UploadProgress = {
  totalFiles: number;
  finishedFiles: number;
  failedFiles: number;
  bytesSent: number;
  totalBytes: number;
};
export type UploadPreparationProgress = { totalFiles: number; preparedFiles: number };

export type UploadDeps = {
  post: <T>(path: string, body?: unknown) => Promise<T>;
  putFile: (storagePath: string, file: File, onBytes: (sent: number) => void) => Promise<void>;
};

type RegisteredEntry = { assetId: string; storagePath: string };

const TYPE_BY_EXTENSION: Record<string, string> = {
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", heic: "image/heic", heif: "image/heif", webp: "image/webp", gif: "image/gif",
  mp4: "video/mp4", mov: "video/quicktime", m4v: "video/x-m4v", webm: "video/webm", mkv: "video/x-matroska",
};

export function contentTypeFor(file: File): string {
  if (file.type) return file.type;
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  return TYPE_BY_EXTENSION[extension] ?? "";
}

async function defaultDeps(): Promise<UploadDeps> {
  const [{ apiPost }, { getStorageClient }] = await Promise.all([import("./apiClient"), import("./firebase")]);
  return {
    post: apiPost,
    putFile: (storagePath, file, onBytes) =>
      new Promise((resolve, reject) => {
        const task = uploadBytesResumable(ref(getStorageClient(), storagePath), file, { contentType: contentTypeFor(file) });
        task.on("state_changed", (snap) => onBytes(snap.bytesTransferred), reject, () => resolve());
      }),
  };
}

export async function uploadMedia(
  files: File[],
  options: { mode: "memory" | "creator"; onProgress?: (p: UploadProgress) => void; onPreparationProgress?: (p: UploadPreparationProgress) => void; onProjectReady?: (projectId: string) => void; onReady?: (ready: { projectId: string; assetIds: string[] }) => void; concurrency?: number },
  deps?: UploadDeps,
): Promise<{ projectId: string; finished: number; failed: number; assetIds: string[] }> {
  const { post, putFile } = deps ?? (await defaultDeps());
  const concurrency = Math.max(1, options.concurrency ?? DEFAULT_CONCURRENCY);

  const acceptedOriginal = files.filter((file) => Boolean(contentTypeFor(file)));
  const rejected = files.length - acceptedOriginal.length;
  if (acceptedOriginal.length === 0) return { projectId: "", finished: 0, failed: rejected, assetIds: [] };
  const { project } = await post<{ project: { id: string } }>("/api/projects", { mode: options.mode });
  options.onProjectReady?.(project.id);
  options.onPreparationProgress?.({ totalFiles: acceptedOriginal.length, preparedFiles: 0 });
  const accepted = await prepareUploadFiles(acceptedOriginal, (preparedFiles, totalFiles) => options.onPreparationProgress?.({ preparedFiles, totalFiles }));
  const base = `/api/projects/${project.id}/upload-sessions`;

  const toInput = (f: File) => ({ fileName: f.name, contentType: contentTypeFor(f), sizeBytes: f.size });
  const first = await post<{ session: { id: string }; entries: RegisteredEntry[] }>(base, {
    entries: accepted.slice(0, ENTRY_BATCH).map(toInput),
  });
  const sessionPath = `${base}/${first.session.id}`;
  const entries = [...first.entries];
  let mainPathFailed = false;

  try {
    for (let start = ENTRY_BATCH; start < accepted.length; start += ENTRY_BATCH) {
      const batch = await post<{ entries: RegisteredEntry[] }>(`${sessionPath}/entries`, {
        entries: accepted.slice(start, start + ENTRY_BATCH).map(toInput),
      });
      entries.push(...batch.entries);
    }

    if (entries.length !== accepted.length) throw new Error("entry_registration_mismatch");

    const sent = new Array<number>(accepted.length).fill(0);
    const progress: UploadProgress = {
      totalFiles: files.length,
      finishedFiles: 0,
      failedFiles: rejected,
      bytesSent: 0,
      totalBytes: accepted.reduce((sum, f) => sum + f.size, 0),
    };
    const report = () => options.onProgress?.({ ...progress, bytesSent: sent.reduce((a, b) => a + b, 0) });
    report();
    options.onReady?.({ projectId: project.id, assetIds: entries.map(({ assetId }) => assetId) });

    let next = 0;
    async function worker() {
      while (next < accepted.length) {
        const index = next++;
        const entry = entries[index];
        if (!entry) throw new Error("entry_registration_mismatch");
        try {
          await putFile(entry.storagePath, accepted[index], (bytes) => {
            sent[index] = bytes;
            report();
          });
          sent[index] = accepted[index].size;
          progress.finishedFiles += 1;
        } catch (error) {
          progress.totalBytes -= accepted[index].size;
          sent[index] = 0;
          progress.failedFiles += 1;
          const reason = (error as { code?: string }).code ?? "upload_error";
          await post(`${sessionPath}/entries/${entry.assetId}/outcome`, { kind: "failed", reason }).catch(() => undefined);
        }
        report();
      }
    }

    await Promise.all(Array.from({ length: Math.min(concurrency, accepted.length) }, worker));
    return { projectId: project.id, finished: progress.finishedFiles, failed: progress.failedFiles, assetIds: entries.map(({ assetId }) => assetId) };
  } catch (error) {
    mainPathFailed = true;
    throw error;
  } finally {
    try {
      await post(`${sessionPath}/close`);
    } catch (error) {
      if (mainPathFailed) console.error("failed to close upload session", error);
      else throw error;
    }
  }
}
