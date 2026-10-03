import type { AssetStatus } from "../domain/assetStatus.js";

export type SummaryAsset = {
  id?: string;
  facts?: { kind?: "photo" | "video"; localTime?: string | null };
  media?: { kind?: "photo" | "video"; localTime?: string | null };
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
  ready: { summary: boolean; faces: boolean; plan: boolean; story: boolean };
  assetStatuses: { assetId: string; kind: "photo" | "video"; status: AssetStatus }[];
};

export function summarise(assets: SummaryAsset[], hasPlan: boolean, context: {
  projectStatus?: string; upload?: ProjectSummary["upload"]; manifestReady?: boolean; excludedAssetIds?: string[];
} = {}): ProjectSummary {
  const excluded = new Set(context.excludedAssetIds);
  assets = assets.filter((asset) => !asset.id || !excluded.has(asset.id));
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
  const upload = context.upload ?? { expected: 0, settled: 0, failed: assets.filter((asset) => asset.status === "failed").length, cancelled: 0, closed: true };
  const usable = assets.filter((asset) => asset.status !== "failed");
  const story = usable.length > 0 && usable.every((asset) => asset.status === "understood")
    && upload.closed && upload.settled === upload.expected && (context.manifestReady ?? true)
    && (context.projectStatus === "ready" || context.projectStatus === "ready_with_errors");
  return {
    upload,
    total: assets.length, photos: photos.length, clips: assets.length - photos.length,
    days: uniqueDates.length, dateRange: uniqueDates.length ? { from: uniqueDates[0]!, to: uniqueDates[uniqueDates.length - 1]! } : null,
    places: places.slice(0, 6), country, season,
    processed: { ingested, understood, faces: facePhotos },
    ready: { summary: ingested === assets.length, faces: photos.every((asset) => asset.status === "understood"), plan: hasPlan, story },
    assetStatuses: assets.flatMap((asset) => {
      const kind = (asset.media ?? asset.facts)?.kind;
      return asset.id && (kind === "photo" || kind === "video") ? [{ assetId: asset.id, kind, status: asset.status }] : [];
    }),
  };
}
