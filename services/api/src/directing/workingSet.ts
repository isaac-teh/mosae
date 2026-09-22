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
  /** Original-media interval for a video shot; photos carry null bounds. */
  sourceStartSec?: number | null;
  sourceEndSec?: number | null;
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

  /**
   * Event order is independent of shot arrival order: use the earliest
   * chronological day carried by an event, then eventId as a stable tie-break.
   * Events without day metadata sort by eventId alone.
   */
  const queues = [...ranked.entries()]
    .sort(([eventA, shotsA], [eventB, shotsB]) => {
      const dayA = shotsA.map((shot) => shot.day).filter((day): day is string => Boolean(day)).sort()[0];
      const dayB = shotsB.map((shot) => shot.day).filter((day): day is string => Boolean(day)).sort()[0];
      if (dayA && dayB && dayA !== dayB) return dayA.localeCompare(dayB);
      if (dayA && !dayB) return -1;
      if (!dayA && dayB) return 1;
      return eventA.localeCompare(eventB);
    })
    .map(([, queue]) => queue);

  const cap = Math.max(0, options.cap ?? DEFAULT_CAP);
  const selected: WorkingShot[] = [];
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
