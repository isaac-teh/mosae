import { ref, uploadBytesResumable } from "firebase/storage";

export const ENTRY_BATCH = 500;
export const DEFAULT_CONCURRENCY = 4;

export type UploadProgress = {
  totalFiles: number;
  finishedFiles: number;
  failedFiles: number;
  bytesSent: number;
  totalBytes: number;
};

export type UploadDeps = {
  post: <T>(path: string, body?: unknown) => Promise<T>;
  putFile: (storagePath: string, file: File, onBytes: (sent: number) => void) => Promise<void>;
};

type RegisteredEntry = { assetId: string; storagePath: string };

async function defaultDeps(): Promise<UploadDeps> {
  const [{ apiPost }, { getStorageClient }] = await Promise.all([import("./apiClient"), import("./firebase/client")]);
  return {
    post: apiPost,
    putFile: (storagePath, file, onBytes) =>
      new Promise((resolve, reject) => {
        const task = uploadBytesResumable(ref(getStorageClient(), storagePath), file, { contentType: file.type });
        task.on("state_changed", (snap) => onBytes(snap.bytesTransferred), reject, () => resolve());
      }),
  };
}

export async function uploadMedia(
  files: File[],
  options: { mode: "memory" | "creator"; onProgress?: (p: UploadProgress) => void; concurrency?: number },
  deps?: UploadDeps,
): Promise<{ projectId: string; finished: number; failed: number }> {
  const { post, putFile } = deps ?? (await defaultDeps());
  const concurrency = Math.max(1, options.concurrency ?? DEFAULT_CONCURRENCY);

  const { project } = await post<{ project: { id: string } }>("/api/projects", { mode: options.mode });
  const base = `/api/projects/${project.id}/upload-sessions`;

  const toInput = (f: File) => ({ fileName: f.name, contentType: f.type, sizeBytes: f.size });
  const first = await post<{ session: { id: string }; entries: RegisteredEntry[] }>(base, {
    entries: files.slice(0, ENTRY_BATCH).map(toInput),
  });
  const sessionPath = `${base}/${first.session.id}`;
  const entries = [...first.entries];
  let mainPathFailed = false;

  try {
    for (let start = ENTRY_BATCH; start < files.length; start += ENTRY_BATCH) {
      const batch = await post<{ entries: RegisteredEntry[] }>(`${sessionPath}/entries`, {
        entries: files.slice(start, start + ENTRY_BATCH).map(toInput),
      });
      entries.push(...batch.entries);
    }

    if (entries.length !== files.length) throw new Error("entry_registration_mismatch");

    const sent = new Array<number>(files.length).fill(0);
    const progress: UploadProgress = {
      totalFiles: files.length,
      finishedFiles: 0,
      failedFiles: 0,
      bytesSent: 0,
      totalBytes: files.reduce((sum, f) => sum + f.size, 0),
    };
    const report = () => options.onProgress?.({ ...progress, bytesSent: sent.reduce((a, b) => a + b, 0) });

    let next = 0;
    async function worker() {
      while (next < files.length) {
        const index = next++;
        const entry = entries[index];
        if (!entry) throw new Error("entry_registration_mismatch");
        try {
          await putFile(entry.storagePath, files[index], (bytes) => {
            sent[index] = bytes;
            report();
          });
          sent[index] = files[index].size;
          progress.finishedFiles += 1;
        } catch (error) {
          progress.failedFiles += 1;
          const reason = (error as { code?: string }).code ?? "upload_error";
          await post(`${sessionPath}/entries/${entry.assetId}/outcome`, { kind: "failed", reason }).catch(() => undefined);
        }
        report();
      }
    }

    await Promise.all(Array.from({ length: Math.min(concurrency, files.length) }, worker));
    return { projectId: project.id, finished: progress.finishedFiles, failed: progress.failedFiles };
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
