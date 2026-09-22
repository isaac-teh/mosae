import { analysisSearchText, type ShotAnalysis } from "../domain/understanding.js";
import type { AssetStatus } from "../domain/assetStatus.js";

/** The Phase 2 fields needed to make a deterministic directing catalog. */
export type WorkingShot = {
  id: string;
  assetStatus?: AssetStatus;
  /** `status` is accepted for callers passing the persisted asset shape. */
  status?: AssetStatus;
  asset?: { status?: AssetStatus };
  eventId?: string | null;
  day?: string | null;
  place?: string | null;
  durationSec?: number | null;
  dupOf?: string | null;
  analysis: ShotAnalysis | null;
  /** A moment id is normally the shot id, but assembly may provide an explicit mapping. */
  momentId?: string;
};

export type WorkingSetOptions = {
  cap?: number;
  excludedShotIds?: string[];
  mustIncludeMomentIds?: string[];
  /** Alias useful to callers that have shot ids rather than moment ids. */
  mustIncludeShotIds?: string[];
};

export type WorkingSet = {
  shots: WorkingShot[];
  lines: string[];
};

const DEFAULT_CAP = 180;

function statusOf(shot: WorkingShot): AssetStatus | undefined {
  return shot.assetStatus ?? shot.status ?? shot.asset?.status;
}

function scoreOf(shot: WorkingShot): number {
  if (!shot.analysis) return Number.NEGATIVE_INFINITY;
  return shot.analysis.kind === "photo" ? shot.analysis.keyMomentScore : shot.analysis.quality;
}

function eligible(shot: WorkingShot, excluded: Set<string>): boolean {
  if (statusOf(shot) !== "understood") return false;
  if (!shot.analysis) return false;
  if (shot.analysis.kind === "video" && !shot.analysis.usable) return false;
  if (shot.dupOf) return false;
  if (excluded.has(shot.id)) return false;
  return true;
}

/** Compact the exact catalog shape used by the Phase 2 composer prompt. */
export function compactShotLine(shot: WorkingShot): string {
  if (!shot.analysis) throw new Error(`shot ${shot.id} has no analysis`);
  const day = shot.day ?? "";
  const place = shot.place ?? "";
  const duration = shot.durationSec == null ? "" : String(shot.durationSec);
  return [shot.id, shot.analysis.kind, day, place, duration, analysisSearchText(shot.analysis)].join(" | ");
}

export function buildWorkingSet(shots: WorkingShot[], options: WorkingSetOptions = {}): WorkingSet {
  const excluded = new Set(options.excludedShotIds ?? []);
  const candidates = shots
    .map((shot, index) => ({ shot, index }))
    .filter(({ shot }) => eligible(shot, excluded));

  const ranked = new Map<string, WorkingShot[]>();
  for (const { shot } of candidates) {
    const event = shot.eventId ?? "undated";
    const group = ranked.get(event) ?? [];
    group.push(shot);
    ranked.set(event, group);
  }
  for (const group of ranked.values()) {
    group.sort((a, b) => scoreOf(b) - scoreOf(a));
  }

  const cap = Math.max(0, options.cap ?? DEFAULT_CAP);
  const selected: WorkingShot[] = [];
  const queues = [...ranked.values()];
  for (let index = 0; selected.length < cap; index++) {
    let added = false;
    for (const queue of queues) {
      const next = queue[index];
      if (next) {
        selected.push(next);
        added = true;
        if (selected.length >= cap) break;
      }
    }
    if (!added) break;
  }

  const mustInclude = new Set([...(options.mustIncludeMomentIds ?? []), ...(options.mustIncludeShotIds ?? [])]);
  for (const { shot } of candidates) {
    if (mustInclude.has(shot.id) || (shot.momentId && mustInclude.has(shot.momentId))) {
      if (!selected.includes(shot)) selected.push(shot);
    }
  }

  return { shots: selected, lines: selected.map(compactShotLine) };
}
