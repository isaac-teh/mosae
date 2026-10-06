import type { Firestore } from "firebase-admin/firestore";

export type ResolvedShot = { storagePath: string; width?: number; height?: number; sourceDurationSec?: number; derivatives?: { proxyPath?: string | null; renderPath?: string | null; thumbPath: string } };

/** Resolve a timeline shot to its asset, tolerating uploads whose shot record has not been written yet. */
export async function loadSourceForShot(db: Firestore, projectId: string, shotId: string): Promise<ResolvedShot | null> {
  const project = db.collection("projects").doc(projectId);
  const shot = await project.collection("shots").doc(shotId).get();
  const assetIds = shot.exists
    ? [shot.get("assetId") as string]
    : [shotId, ...(shotId.endsWith("_0000") ? [shotId.slice(0, -5)] : [])];
  for (const assetId of assetIds) {
    const asset = await project.collection("assets").doc(assetId).get();
    if (!asset.exists) continue;
    const media = asset.get("media") as { durationSec?: unknown; width?: unknown; height?: unknown } | undefined;
    return {
      storagePath: asset.get("storagePath") as string,
      ...(typeof media?.durationSec === "number" && media.durationSec > 0 ? { sourceDurationSec: media.durationSec } : {}),
      ...(typeof media?.width === "number" && media.width > 0 ? { width: media.width } : {}),
      ...(typeof media?.height === "number" && media.height > 0 ? { height: media.height } : {}),
      derivatives: asset.get("derivatives"),
    };
  }
  return null;
}
