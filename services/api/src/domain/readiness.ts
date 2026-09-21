import type { AssetStatus } from "./assetStatus.js";

/**
 * The asset status that counts as finished for the current pipeline. Phase 1
 * ends at ingest; phase 2 adds understanding and changes this to "understood".
 */
export const READY_STATUS: AssetStatus = "ingested";

/** What Firestore says about a project right now, gathered by readinessStore. */
export type ProjectFacts = {
  sessions: number;
  openSessions: number;
  pendingEntries: number;
  assets: number;
  ingested: number;
  failed: number;
};

export type ProjectOutcome = "ready" | "ready_with_errors" | "failed";

export type Readiness = { settled: false } | { settled: true; outcome: ProjectOutcome };

/**
 * A project has settled when no upload can still arrive and every asset that
 * did arrive has finished or failed. A settled project with nothing usable is
 * "failed" rather than left processing forever.
 */
export function readinessOf(facts: ProjectFacts): Readiness {
  if (facts.sessions === 0 || facts.openSessions > 0 || facts.pendingEntries > 0) return { settled: false };
  if (facts.ingested + facts.failed !== facts.assets) return { settled: false };
  if (facts.ingested === 0) return { settled: true, outcome: "failed" };
  return { settled: true, outcome: facts.failed > 0 ? "ready_with_errors" : "ready" };
}
