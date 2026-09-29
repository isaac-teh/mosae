import type { Firestore } from "firebase-admin/firestore";
import type { Timeline } from "@mosae/contracts";
import { collageShotIds } from "@mosae/contracts";

export type UnusedProjectMedia = {
  shotId: string;
  kind: "photo" | "video";
  thumbnailUrl: string;
  previewUrl: string;
  date: string;
  eventLabel: string;
  sourceInSec?: number;
  sourceOutSec?: number;
};

export async function loadUnusedProjectMedia(
  db: Firestore,
  projectId: string,
  timeline: Timeline,
  signReadUrl: (path: string, expiresAt: number) => Promise<string>,
  now: () => number = Date.now,
): Promise<UnusedProjectMedia[]> {
  const project = db.collection("projects").doc(projectId);
  const [shotsSnapshot, assetsSnapshot, eventsSnapshot] = await Promise.all([
    project.collection("shots").get(), project.collection("assets").get(), project.collection("events").get(),
  ]);
  const usedShotIds = new Set([
    ...timeline.videoClips.flatMap((clip) => "source" in clip ? [clip.source.shotId] : []),
    ...collageShotIds(timeline),
  ]);
  const assets = new Map(assetsSnapshot.docs.map((doc) => [doc.id, doc.data() as Record<string, unknown>]));
  const events = new Map(eventsSnapshot.docs.map((doc) => [doc.id, doc.data() as Record<string, unknown>]));
  const expiresAt = now() + 6 * 60 * 60 * 1000;
  const media = await Promise.all(shotsSnapshot.docs.flatMap((shotDoc) => {
    const shot = shotDoc.data() as Record<string, unknown>;
    const shotId = typeof shot.id === "string" ? shot.id : shotDoc.id;
    if (usedShotIds.has(shotId) || typeof shot.assetId !== "string") return [];
    const asset = assets.get(shot.assetId);
    if (!asset) return [];
    const derivatives = asset.derivatives && typeof asset.derivatives === "object" ? asset.derivatives as Record<string, unknown> : {};
    const storagePath = typeof asset.storagePath === "string" ? asset.storagePath : null;
    const thumbnailPath = typeof derivatives.thumbPath === "string" ? derivatives.thumbPath : storagePath;
    if (!thumbnailPath) return [];
    const kind = shot.mediaType === "video" ? "video" as const : "photo" as const;
    const previewPath = kind === "video" && typeof derivatives.proxyPath === "string" ? derivatives.proxyPath : thumbnailPath;
    const event = typeof asset.eventId === "string" ? events.get(asset.eventId) : undefined;
    const eventDate = event && typeof event.date === "string" ? event.date : "";
    const createdAt = typeof asset.createdAt === "number" ? new Date(asset.createdAt).toISOString().slice(0, 10) : "";
    const date = eventDate || createdAt;
    const eventLabel = event && typeof event.label === "string" ? event.label : date || "Other day";
    const sourceInSec = typeof shot.sourceStartSec === "number" ? shot.sourceStartSec : undefined;
    const sourceOutSec = typeof shot.sourceEndSec === "number" ? shot.sourceEndSec : undefined;
    return [Promise.all([signReadUrl(thumbnailPath, expiresAt), signReadUrl(previewPath, expiresAt)]).then(([thumbnailUrl, previewUrl]) => ({
      shotId, kind, thumbnailUrl, previewUrl, date, eventLabel,
      ...(sourceInSec !== undefined ? { sourceInSec } : {}),
      ...(sourceOutSec !== undefined ? { sourceOutSec } : {}),
      index: typeof shot.index === "number" ? shot.index : 0,
    })).catch(() => null)];
  }));
  return media.filter((item): item is NonNullable<typeof item> => item !== null)
    .sort((a, b) => b.date.localeCompare(a.date) || a.index - b.index)
    .map(({ index: _index, ...item }) => item);
}
