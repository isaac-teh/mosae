export type UploadRecoveryEntry = {
  file: File;
  assetId: string | null;
  sessionId: string | null;
  status: "pending" | "uploaded" | "failed";
  replacesAssetId?: string;
  replacesSessionId?: string;
  replacesPending?: boolean;
};

export type UploadRecoveryOwner = {
  projectId: string;
  entries: UploadRecoveryEntry[];
  aggregate: { totalFiles: number; uploadedFiles: number; failedFiles: number; bytesSent: number; totalBytes: number };
  closeRetry: (() => Promise<void>) | null;
  retryInFlight: boolean;
  initialUploadInFlight: boolean;
  failedTargets: { assetId: string; sessionId: string; pending?: boolean }[];
};

export function createUploadRecoveryOwner(projectId: string, aggregate: UploadRecoveryOwner["aggregate"], files: File[] = []): UploadRecoveryOwner {
  return {
    projectId,
    entries: files.map((file) => ({ file, assetId: null, sessionId: null, status: "pending" })),
    aggregate: { ...aggregate },
    closeRetry: null,
    retryInFlight: false,
    initialUploadInFlight: false,
    failedTargets: [],
  };
}

export function runUploadRecovery<T>(owner: UploadRecoveryOwner, run: () => Promise<T>): Promise<T | false> {
  if (owner.retryInFlight) return Promise.resolve(false);
  owner.retryInFlight = true;
  return Promise.resolve().then(run).finally(() => { owner.retryInFlight = false; });
}
