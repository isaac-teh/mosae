import type { AssetStatus } from "../domain/assetStatus.js";

export type SummaryAsset = {
  id?: string;
  facts?: { kind?: "photo" | "video"; localTime?: string | null; width?: number; height?: number };
  media?: { kind?: "photo" | "video"; localTime?: string | null; width?: number; height?: number };
  dupOf?: string | null; quality?: { blurry?: boolean };
  place?: { name?: string; country?: string | null } | null;
  status: AssetStatus;
  hasFaces?: boolean;
};

export type ProjectSummary = {
  total: number; photos: number; clips: number;
  days: number; dateRange: { from: string; to: string } | null;
  places: string[]; country: string | null; season: string | null;
  processed: { ingested: number; understood: number; faces: number };
  upload: { expected: number; settled: number; failed: number; cancelled: number; closed: boolean };
  ready: { summary: boolean; faces: boolean; plan: boolean; story: boolean; film: boolean };
  assetStatuses: { assetId: string; kind: "photo" | "video"; status: AssetStatus }[];
  videoStatuses: { assetId: string; status: "processing" | "ready" | "failed"; progress: number }[];
  orientation: { portrait: number; landscape: number; square: number; suggested: "9:16" | "16:9" | null };
};

export function summarise(assets: SummaryAsset[], hasPlan: boolean, context: {
  projectStatus?: string; upload?: ProjectSummary["upload"]; manifestReady?: boolean; excludedAssetIds?: string[];
} = {}): ProjectSummary {
  const excluded = new Set(context.excludedAssetIds);
  assets = assets.filter((asset) => !asset.id || !excluded.has(asset.id));
  const assetStatuses = assets.flatMap((asset) => {
    const kind = (asset.media ?? asset.facts)?.kind;
    return asset.id && (kind === "photo" || kind === "video") ? [{ assetId: asset.id, kind, status: asset.status }] : [];
  });
  const videoStatuses = assets.flatMap((asset) => {
    const kind = (asset.media ?? asset.facts)?.kind;
    if (!asset.id || kind !== "video") return [];
    const status = asset.status === "failed" ? "failed" as const : asset.status === "understood" ? "ready" as const : "processing" as const;
    return [{ assetId: asset.id, status, progress: status === "processing" ? (asset.status === "ingested" ? 0.5 : 0) : 1 }];
  });
  const oriented = assets.filter((asset) => asset.status === "understood" && !asset.dupOf && !asset.quality?.blurry);
  let portrait = 0, landscape = 0, square = 0;
  for (const asset of oriented) {
    const media = asset.media ?? asset.facts;
    const width = media?.width ?? 0, height = media?.height ?? 0;
    if (!(width > 0 && height > 0)) continue;
    if (height > width * 1.05) portrait++;
    else if (width > height * 1.05) landscape++;
    else square++;
  }
  const nonSquare = portrait + landscape;
  const suggested = nonSquare === 0 || portrait / nonSquare >= 0.7 ? "9:16" : portrait / nonSquare <= 0.3 ? "16:9" : null;
  const upload = context.upload ?? { expected: 0, settled: 0, failed: assets.filter((asset) => asset.status === "failed").length, cancelled: 0, closed: true };
  // Failed processing stays visible for acknowledgement, but is not reviewed media.
  assets = assets.filter((asset) => asset.status !== "failed");
  const dates = assets.map((asset) => (asset.media ?? asset.facts)?.localTime?.slice(0, 10) ?? null)
    .filter((date): date is string => !!date && /^\d{4}-\d{2}-\d{2}$/.test(date));
  const uniqueDates = [...new Set(dates)].sort();
  const photos = assets.filter((asset) => (asset.media ?? asset.facts)?.kind === "photo");
  const places: string[] = [];
  const countries = new Map<string, number>();
  for (const asset of [...assets].sort((a, b) => ((a.media ?? a.facts)?.localTime ?? "").localeCompare((b.media ?? b.facts)?.localTime ?? ""))) {
    const name = asset.place?.name;
    if (name && !places.includes(name)) places.push(name);
    const country = asset.place?.country;
    if (country) countries.set(country, (countries.get(country) ?? 0) + 1);
  }
  const country = [...countries].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  let season: string | null = null;
  if (uniqueDates.length) {
    const month = Number(uniqueDates[Math.floor((uniqueDates.length - 1) / 2)]!.slice(5, 7));
    const day = Number(uniqueDates[Math.floor((uniqueDates.length - 1) / 2)]!.slice(8, 10));
    const monthName = new Date(Date.UTC(2020, month - 1, 1)).toLocaleString("en", { month: "long", timeZone: "UTC" });
    season = `${day <= 10 ? "early" : day >= 20 ? "late" : "mid"} ${monthName}`;
  }
  const ingested = assets.filter((asset) => asset.status === "ingested" || asset.status === "understood").length;
  const understood = assets.filter((asset) => asset.status === "understood").length;
  const facePhotos = photos.filter((asset) => asset.hasFaces).length;
  const usable = assets.filter((asset) => asset.status !== "failed");
  const chatReady = assets.length > 0 && photos.every((asset) => asset.status === "understood" || asset.status === "failed")
    && upload.closed && upload.settled === upload.expected && (context.manifestReady ?? true);
  const story = assets.length > 0 && (context.projectStatus !== undefined || context.upload !== undefined)
    && photos.every((asset) => asset.status === "understood" || asset.status === "failed")
    && upload.closed && upload.settled === upload.expected && (context.manifestReady ?? true);
  return {
    upload, orientation: { portrait, landscape, square, suggested },
    total: assets.length, photos: photos.length, clips: assets.length - photos.length,
    days: uniqueDates.length, dateRange: uniqueDates.length ? { from: uniqueDates[0]!, to: uniqueDates[uniqueDates.length - 1]! } : null,
    places: places.slice(0, 6), country, season,
    processed: { ingested, understood, faces: facePhotos },
    ready: { summary: chatReady, faces: photos.length ? photos.every((asset) => asset.status === "understood") : videoStatuses.some((video) => video.status === "ready"), plan: hasPlan, story, film: videoStatuses.every((video) => video.status !== "processing") },
    assetStatuses, videoStatuses,
  };
}
