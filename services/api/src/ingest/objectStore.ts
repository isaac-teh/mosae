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
      // v4 signing needs real service-account credentials, which a local
      // emulator run does not have, so every image on every screen fails with
      // "Could not load the default credentials". The emulator serves its
      // objects unsigned, so address them directly when it is the one running.
      // Use the GCS-style download path, not the Firebase `/v0/` one: the
      // latter enforces storage rules, which deny public reads, and answers
      // with JSON that the browser then blocks as a non-image response.
      const emulator = process.env.FIREBASE_STORAGE_EMULATOR_HOST;
      if (emulator) {
        const host = emulator.startsWith("http") ? emulator : `http://${emulator}`;
        return `${host}/download/storage/v1/b/${bucket.name}/o/${encodeURIComponent(path)}?alt=media`;
      }
      const [url] = await bucket.file(path).getSignedUrl({ version: "v4", action: "read", expires: expiresAt });
      return url;
    },
  };
}

/**
 * A download URL for any object, not just thumbnails. The render output is an
 * MP4 the browser must play directly, so it needs the same emulator form as the
 * thumbnail store — a direct GCS-style `/download/storage/v1/...?alt=media`
 * address when the storage emulator is running, because `getSignedUrl` has no
 * credentials there and would fail. The non-emulator path signs a read with v4.
 */
export function firebaseDownloadUrlStore(bucket: Bucket): { signedDownloadUrl(path: string): Promise<string> } {
  return {
    async signedDownloadUrl(path) {
      const emulator = process.env.FIREBASE_STORAGE_EMULATOR_HOST;
      if (emulator) {
        const host = emulator.startsWith("http") ? emulator : `http://${emulator}`;
        return `${host}/download/storage/v1/b/${bucket.name}/o/${encodeURIComponent(path)}?alt=media`;
      }
      const [url] = await bucket.file(path).getSignedUrl({ version: "v4", action: "read", expires: Date.now() + 24 * 60 * 60 * 1000 });
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
