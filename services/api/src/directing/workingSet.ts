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
  localTime: string | null;
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
  /**
   * Person ids (from the picker) whose faces should be kept in the film. Each
   * qualifying shot — one whose stored analysis carries at least one face whose
   * `characterId` is listed here — is folded into `mustIncludeMomentIds`, so a
   * focus character gets the same "explicit choice outranks ranking" behaviour
   * as any other must-include. Resolved against the working set's own shots, so
   * an id that names no face simply contributes nothing rather than failing.
   */
  focusCharacterIds?: string[];
};

export type WorkingSet = {
  shots: WorkingShot[];
  lines: string[];
};

const DEFAULT_CAP = 180;

/**
 * A must-include the catalog cannot honour. The user named the shot
 * explicitly, so it is never silently dropped: either the choice wins over
 * eligibility ranking, or planning stops here with something the user can act
 * on. Reaching validation instead would fail the proposal non-retryably with
 * no escape but a new story.
 */
export class MustIncludeConflict extends Error {
  constructor(message: string, readonly shotIds: string[], readonly diagnostics: string[]) {
    super(message);
    this.name = "MustIncludeConflict";
  }
}

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

/**
 * Resolve focus character ids to shot ids: a shot qualifies when its stored
 * analysis carries at least one face whose `characterId` is in the list. Only
 * photo analyses carry faces, so video shots never qualify. An id that matches
 * no face contributes nothing — it does not throw, because a stale or empty
 * focus list must degrade gracefully rather than block planning.
 */
export function resolveFocusShots(shots: WorkingShot[], focusCharacterIds: string[]): string[] {
  if (focusCharacterIds.length === 0) return [];
  const wanted = new Set(focusCharacterIds);
  const shotIds = new Set<string>();
  for (const shot of shots) {
    const faces = shot.analysis?.kind === "photo" ? shot.analysis.faces : undefined;
    if (!faces) continue;
    if (faces.some((face) => face.characterId && wanted.has(face.characterId))) {
      shotIds.add(shot.id);
    }
  }
  return [...shotIds];
}

export function buildWorkingSet(shots: WorkingShot[], options: WorkingSetOptions = {}): WorkingSet {
  const excluded = new Set(options.excludedShotIds ?? []);
  // Focus characters are resolved to shot ids against the working set's own
  // shots, then folded into mustInclude so they behave exactly like any other
  // explicit choice. Resolving here (rather than at plan time) keeps the join
  // in one place and lets a focus id that names no face contribute nothing.
  // A focus photo that is left out stops being required: the focus is a
  // preference, and must never force back a photo the leave-out rules removed.
  const focusShotIds = resolveFocusShots(shots, options.focusCharacterIds ?? []).filter((id) => !excluded.has(id));
  const mustIncludeMomentIds = [...new Set([...(options.mustIncludeMomentIds ?? []), ...focusShotIds])];

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

  const mustInclude = new Set([...mustIncludeMomentIds, ...(options.mustIncludeShotIds ?? [])]);
  if (mustInclude.size > 0) {
    // Match against every shot, not only the eligible candidates: an explicit
    // choice outranks our eligibility ranking.
    const required = shots.filter((shot) => mustInclude.has(shot.id) || (shot.momentId && mustInclude.has(shot.momentId)));

    // Kept and left out at once is a contradiction only the user can settle.
    const contradicted = required.filter((shot) => excluded.has(shot.id)).map((shot) => shot.id);
    if (contradicted.length > 0) {
      throw new MustIncludeConflict(
        `You asked to keep ${contradicted.join(", ")} and to leave the same ${contradicted.length === 1 ? "moment" : "moments"} out. Choose one and try again.`,
        contradicted,
        [`must_include_conflict: shot ids ${contradicted.join(", ")} are required and excluded at the same time.`],
      );
    }

    // Without analysis there is nothing to describe to the planner, so the
    // shot cannot enter the catalog however explicitly it was asked for.
    const undescribed = required.filter((shot) => !shot.analysis).map((shot) => shot.id);
    if (undescribed.length > 0) {
      throw new MustIncludeConflict(
        `${undescribed.join(", ")} ${undescribed.length === 1 ? "is" : "are"} still being processed, so we can't keep ${undescribed.length === 1 ? "it" : "them"} yet. Try again once your memories are ready.`,
        undescribed,
        [`must_include_unavailable: shot ids ${undescribed.join(", ")} have no analysis and cannot be described to the planner.`],
      );
    }

    // A duplicate, an unusable video or a shot whose asset is not yet marked
    // understood loses to ranking, but not to the user naming it.
    for (const shot of required) if (!selected.includes(shot)) selected.push(shot);
  }

  return { shots: selected, lines: selected.map(compactShotLine) };
}
