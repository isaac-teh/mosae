import type { getStorage } from "firebase-admin/storage";
import { PermanentIngestError } from "./errors.js";

type Bucket = ReturnType<ReturnType<typeof getStorage>["bucket"]>;

export interface ThumbnailUrlStore {
  signedReadUrl(path: string, expiresAt: number): Promise<string>;
}

/** GCS uploads have no Firebase download token; sign reads on the server. */
export function firebaseThumbnailUrlStore(bucket: Bucket): ThumbnailUrlStore {
  return {
    async signedReadUrl(path, expiresAt) {
      const [url] = await bucket.file(path).getSignedUrl({ version: "v4", action: "read", expires: expiresAt });
      return url;
    },
  };
}

export interface ObjectStore {
  download(input: { path: string; generation: string; destination: string }): Promise<void>;
  downloadCurrent(input: { path: string; destination: string }): Promise<void>;
  upload(input: { source: string; path: string; contentType: string }): Promise<void>;
}

/**
 * Downloads pin the object generation, so a task always reads the exact bytes it
 * was queued for even if the path is later overwritten. A missing object will
 * never appear, so it is a permanent failure; anything else may be transient.
 */
export function firebaseObjectStore(bucket: Bucket): ObjectStore {
  return {
    async download({ path, generation, destination }) {
      try {
        await bucket.file(path, { generation }).download({ destination });
      } catch (error) {
        if ((error as { code?: number }).code === 404) throw new PermanentIngestError("source_missing");
        throw error;
      }
    },
    async downloadCurrent({ path, destination }) {
      try {
        await bucket.file(path).download({ destination });
      } catch (error) {
        if ((error as { code?: number }).code === 404) throw new PermanentIngestError("source_missing");
        throw error;
      }
    },
    async upload({ source, path, contentType }) {
      await bucket.upload(source, {
        destination: path,
        resumable: false,
        metadata: { contentType, cacheControl: "private, max-age=31536000" },
      });
    },
  };
}
