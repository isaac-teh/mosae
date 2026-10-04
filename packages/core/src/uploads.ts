import { ref, uploadBytes, uploadBytesResumable } from "firebase/storage";
import { prepareUploadFiles, RAW_UPLOAD_MAX_FILES } from "./prepareUploadFiles";

export const ENTRY_BATCH = 500;
export const DEFAULT_CONCURRENCY = 4;
export const SINGLE_REQUEST_UPLOAD_LIMIT = 5_000_000;

export function shouldUseResumableUpload(sizeBytes: number): boolean {
  return sizeBytes >= SINGLE_REQUEST_UPLOAD_LIMIT;
}

export type UploadFileProgress = { assetId: string; status: "uploading" | "uploaded" | "failed" };
export type UploadProgress = {
  totalFiles: number;
  finishedFiles: number;
  failedFiles: number;
  bytesSent: number;
  totalBytes: number;
  assetStatuses?: UploadFileProgress[];
};
export type UploadPreparationProgress = { totalFiles: number; preparedFiles: number };

export type UploadDeps = {
  post: <T>(path: string, body?: unknown) => Promise<T>;
  putFile: (storagePath: string, file: File, onBytes: (sent: number) => void) => Promise<void>;
};

type RegisteredEntry = { assetId: string; storagePath: string };
type PendingRegistration = { index: number; file: File; resolve: (entry: RegisteredEntry) => void; reject: (error: unknown) => void };

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
    putFile: async (storagePath, file, onBytes) => {
      const storage = getStorageClient();
      const storageRef = ref(storage, storagePath);
      const metadata = { contentType: contentTypeFor(file) };
      if (!shouldUseResumableUpload(file.size)) {
        await uploadBytes(storageRef, file, metadata);
        onBytes(file.size);
        return;
      }
      await new Promise<void>((resolve, reject) => {
        const task = uploadBytesResumable(storageRef, file, metadata);
        task.on("state_changed", (snap) => onBytes(snap.bytesTransferred), reject, () => resolve());
      });
    },
  };
}

export async function uploadMedia(
  files: File[],
  options: {
    mode: "memory" | "creator";
    projectId?: string;
    onProgress?: (p: UploadProgress) => void;
    onFileFailed?: (file: File) => void;
    onCloseFailure?: (retry: () => Promise<void>) => void;
    onPreparationProgress?: (p: UploadPreparationProgress) => void;
    onProjectReady?: (projectId: string) => void;
    onEntryRegistered?: (entry: { fileIndex: number; file: File; assetId: string }) => void;
    onReady?: (ready: { projectId: string; assetIds: string[] }) => void;
    concurrency?: number;
  },
  deps?: UploadDeps,
): Promise<{ projectId: string; finished: number; failed: number; assetIds: string[] }> {
  const { post, putFile } = deps ?? (await defaultDeps());
  const concurrency = Math.max(1, options.concurrency ?? DEFAULT_CONCURRENCY);
  const acceptedOriginal = files.filter((file) => Boolean(contentTypeFor(file)));
  const rejected = files.length - acceptedOriginal.length;
  if (acceptedOriginal.length === 0) return { projectId: "", finished: 0, failed: rejected, assetIds: [] };

  const projectId = options.projectId ?? (await post<{ project: { id: string } }>("/api/projects", { mode: options.mode })).project.id;
  options.onProjectReady?.(projectId);
  const sessionBase = `/api/projects/${projectId}/upload-sessions`;
  let sessionPath: string | null = null;
  let mainPathFailed = false;
  const entries = new Array<RegisteredEntry | undefined>(acceptedOriginal.length);
  const statuses = new Array<UploadFileProgress | undefined>(acceptedOriginal.length);
  const sent = new Array<number>(acceptedOriginal.length).fill(0);
  const outcomes = new Map<string, { kind: "cancelled" } | { kind: "failed"; reason: string }>();
  const progress: UploadProgress = {
    totalFiles: files.length,
    finishedFiles: 0,
    failedFiles: rejected,
    bytesSent: 0,
    totalBytes: acceptedOriginal.reduce((sum, file) => sum + file.size, 0),
    assetStatuses: [],
  };
  const report = () => options.onProgress?.({
    ...progress,
    bytesSent: sent.reduce((total, bytes) => total + bytes, 0),
    assetStatuses: statuses.filter((status): status is UploadFileProgress => Boolean(status)),
  });
  const shrinking = acceptedOriginal.length >= RAW_UPLOAD_MAX_FILES;
  if (shrinking) options.onPreparationProgress?.({ totalFiles: acceptedOriginal.length, preparedFiles: 0 });
  report();

  const pending: PendingRegistration[] = [];
  let registrationTimer: ReturnType<typeof setTimeout> | undefined;
  let flushing: Promise<void> | null = null;
  let fatalRegistrationError: unknown;
  let readySent = false;
  const uploadTasks: Promise<void>[] = [];
  let activeUploads = 0;
  const uploadWaiters: (() => void)[] = [];
  const withUploadSlot = async (run: () => Promise<void>) => {
    if (activeUploads >= concurrency) await new Promise<void>((resolve) => uploadWaiters.push(resolve));
    activeUploads++;
    try { await run(); }
    finally { activeUploads--; uploadWaiters.shift()?.(); }
  };

  const toInput = (file: File) => ({ fileName: file.name, contentType: contentTypeFor(file), sizeBytes: file.size });
  const flushRegistrations = async () => {
    if (flushing) return flushing;
    flushing = (async () => {
      while (pending.length > 0) {
        const batch = pending.splice(0, ENTRY_BATCH);
        const body = { entries: batch.map(({ file }) => toInput(file)) };
        try {
          let registered: RegisteredEntry[];
          if (sessionPath) {
            registered = (await post<{ entries: RegisteredEntry[] }>(`${sessionPath}/entries`, body)).entries;
          } else {
            const opened = await post<{ session: { id: string }; entries: RegisteredEntry[] }>(sessionBase, body);
            sessionPath = `${sessionBase}/${opened.session.id}`;
            registered = opened.entries;
          }
          if (registered.length !== batch.length) throw new Error("entry_registration_mismatch");
          batch.forEach((item, i) => {
            const entry = registered[i]!;
            entries[item.index] = entry;
            item.resolve(entry);
            options.onEntryRegistered?.({ fileIndex: item.index, file: item.file, assetId: entry.assetId });
          });
          if (!readySent && entries.filter(Boolean).length === entries.length) {
            readySent = true;
            options.onReady?.({ projectId, assetIds: entries.map((entry) => entry!.assetId) });
          }
        } catch (error) {
          batch.forEach((item) => item.reject(error));
          throw error;
        }
      }
    })().catch((error) => {
      fatalRegistrationError = error;
      pending.splice(0).forEach((item) => item.reject(error));
      throw error;
    }).finally(() => {
      flushing = null;
      if (pending.length > 0 && !fatalRegistrationError) void flushRegistrations().catch(() => undefined);
    });
    return flushing;
  };
  const registerPrepared = (index: number, file: File) => new Promise<RegisteredEntry>((resolve, reject) => {
    if (fatalRegistrationError) { reject(fatalRegistrationError); return; }
    pending.push({ index, file, resolve, reject });
    if (pending.length >= Math.min(3, acceptedOriginal.length) || pending.length >= ENTRY_BATCH) {
      void flushRegistrations().catch(() => undefined);
    } else if (!registrationTimer) {
      registrationTimer = setTimeout(() => {
        registrationTimer = undefined;
        void flushRegistrations().catch(() => undefined);
      }, 20);
    }
  });

  const settleAndClose = async () => {
    if (!sessionPath) return;
    await Promise.all([...outcomes].map(async ([assetId, outcome]) => {
      await post(`${sessionPath}/entries/${assetId}/outcome`, outcome);
      outcomes.delete(assetId);
    }));
    await post(`${sessionPath}/close`);
  };

  try {
    await prepareUploadFiles(acceptedOriginal, (preparedFiles, total) => {
      if (shrinking) options.onPreparationProgress?.({ preparedFiles, totalFiles: total });
    }, async (index, file, prepareMs) => {
      progress.totalBytes += file.size - acceptedOriginal[index]!.size;
      report();
      const entry = await registerPrepared(index, file);
      statuses[index] = { assetId: entry.assetId, status: "uploading" };
      report();
      const task = withUploadSlot(async () => {
        const uploadStarted = performance.now();
        try {
          await putFile(entry.storagePath, file, (bytes) => { sent[index] = bytes; report(); });
          sent[index] = file.size;
          progress.finishedFiles++;
          statuses[index] = { assetId: entry.assetId, status: "uploaded" };
        } catch (error) {
          progress.totalBytes -= file.size;
          sent[index] = 0;
          progress.failedFiles++;
          statuses[index] = { assetId: entry.assetId, status: "failed" };
          options.onFileFailed?.(acceptedOriginal[index]!);
          const reason = (error as { code?: string }).code ?? "upload_error";
          const outcome = { kind: "failed" as const, reason };
          outcomes.set(entry.assetId, outcome);
          if (sessionPath) await post(`${sessionPath}/entries/${entry.assetId}/outcome`, outcome).then(() => outcomes.delete(entry.assetId)).catch(() => undefined);
        }
        console.info("upload_timing", { fileName: file.name, prepareMs, uploadMs: performance.now() - uploadStarted, bytes: file.size });
        report();
      });
      uploadTasks.push(task);
    });
    if (registrationTimer) { clearTimeout(registrationTimer); registrationTimer = undefined; }
    if (pending.length) await flushRegistrations();
    await Promise.all(uploadTasks);
    if (!readySent || entries.filter(Boolean).length !== entries.length) throw new Error("entry_registration_mismatch");
    return { projectId, finished: progress.finishedFiles, failed: progress.failedFiles, assetIds: entries.map((entry) => entry!.assetId) };
  } catch (error) {
    mainPathFailed = true;
    fatalRegistrationError = error;
    if (registrationTimer) clearTimeout(registrationTimer);
    pending.splice(0).forEach((item) => item.reject(error));
    await Promise.all(uploadTasks);
    entries.forEach((entry) => { if (entry) outcomes.set(entry.assetId, { kind: "cancelled" }); });
    throw error;
  } finally {
    try {
      await settleAndClose();
    } catch (error) {
      options.onCloseFailure?.(settleAndClose);
      if (mainPathFailed) console.error("failed to close upload session", error);
      else throw error;
    }
  }
}
