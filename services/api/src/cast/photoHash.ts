import { createHash } from "node:crypto";
import type { Firestore } from "firebase-admin/firestore";
import type { getStorage } from "firebase-admin/storage";

type Bucket = ReturnType<ReturnType<typeof getStorage>["bucket"]>;

/** SHA-256 of the original bytes, as a lowercase hex string. */
export function sha256Hex(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export interface PhotoDeps {
  /** Every photo asset in the project (id + storage path). */
  listAssets(projectId: string): Promise<{ id: string; storagePath: string }[]>;
  /** The raw bytes stored at a bucket path. */
  readBytes(storagePath: string): Promise<Buffer>;
}

/**
 * Map each photo asset in the project to the SHA-256 of its original bytes, so
 * faces can be keyed by "which photo" rather than by storage path or generation.
 */
export async function projectPhotoHashes(
  deps: PhotoDeps,
  projectId: string,
): Promise<Map<string, string>> {
  const hashes = new Map<string, string>();
  const assets = await deps.listAssets(projectId);

  for (const asset of assets) {
    const bytes = await deps.readBytes(asset.storagePath);
    hashes.set(asset.id, sha256Hex(bytes));
  }

  return hashes;
}

interface PhotoAssetDoc {
  id: string;
  storagePath: string;
  mediaType?: "photo" | "video";
}

/**
 * Build the deps that read photo assets from Firestore and their bytes from a
 * Firebase Storage bucket. `listAssets` reads `projects/{id}/assets`; when an
 * asset carries a `mediaType` field it is filtered to photos only, so video
 * assets are skipped without needing to hash them.
 */
export function firestorePhotoHashDeps(
  db: Firestore,
  bucket: Bucket,
): PhotoDeps {
  return {
    async listAssets(projectId) {
      const snap = await db
        .collection("projects")
        .doc(projectId)
        .collection("assets")
        .get();
      const assets: PhotoAssetDoc[] = snap.docs.map((doc) => doc.data() as PhotoAssetDoc);

      return assets
        .filter((asset) => {
          // Only keep photos when the field is present; a missing mediaType is
          // treated as "unknown", so we keep it rather than drop it.
          if (asset.mediaType === undefined || asset.mediaType === null) return true;
          return asset.mediaType === "photo";
        })
        .map((asset) => ({ id: asset.id, storagePath: asset.storagePath }));
    },
    async readBytes(storagePath) {
      const [bytes] = await bucket.file(storagePath).download();
      return bytes;
    },
  };
}
