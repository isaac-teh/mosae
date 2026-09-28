/**
 * Publish-cache for directing, so a replay run reproduces an existing proposal
 * without driving the model conversation again.
 *
 * The recorder replays Gemini calls positionally, but directing is a
 * self-correcting conversation: turn two's prompt embeds shot ids the model
 * invented in turn one, and those never repeat exactly on replay. Replaying the
 * wrong turn silently produces an invalid proposal.
 *
 * Instead we cache the *published submission* — the model's judgment about
 * which catalog shots to use — keyed by (intent, working set). The working set
 * is built from Firestore shot doc ids, which are stable across plan runs for a
 * project; only the minted proposal/moment/chapter ids change. So a cached
 * submission whose shot references still match this run's working set can be
 * re-assembled into a fresh, valid proposal with no model call at all.
 */
import { createHash } from "node:crypto";
import type { Firestore } from "firebase-admin/firestore";
import type { ProposalSubmission } from "./assemble.js";
import type { PlanJob } from "./runPlan.js";
import { buildWorkingSet, type WorkingSet } from "./workingSet.js";

export type CachedProposal = {
  key: string;
  submission: ProposalSubmission;
  recordedAt: number;
};

export interface ProposalCache {
  get(key: string, projectId: string): Promise<CachedProposal | null>;
  put(key: string, projectId: string, submission: ProposalSubmission, recordedAt: number): Promise<void>;
}

const sha = (value: string): string => createHash("sha256").update(value).digest("hex");

/** The must-include constraint ids resolved to catalog shot ids. */
export function constraintShotIds(job: PlanJob): string[] {
  const parentShots = new Map((job.parentProposal?.moments ?? []).map((moment) => [moment.id, moment.shotId]));
  return job.constraints.mustIncludeMomentIds.map((reference) => parentShots.get(reference) ?? reference);
}

/**
 * A key that is identical for the same intent on the same media. The working
 * set's ordered shot ids are what make a proposal reproducible, so they anchor
 * the key; feedback and exclusions change the working set (or the constraints
 * carried into assembly) and therefore must invalidate it — a revised plan
 * should never be served from an old cache.
 */
export function cacheKeyFor(job: PlanJob, workingSet?: WorkingSet): string {
  const shots = workingSet?.shots ?? buildWorkingSet(job.shots, {
    cap: job.workingSetCap,
    excludedShotIds: job.constraints.excludedShotIds,
    mustIncludeMomentIds: constraintShotIds(job),
  }).shots;
  const parts = [
    job.projectId,
    job.intent.text,
    JSON.stringify(job.intent.focus),
    job.daySummary ?? "",
    JSON.stringify(job.constraints),
    shots.map((shot) => shot.id).join(","),
  ];
  return sha(parts.join("\u0000"));
}

/** In-memory cache for tests and the in-process dev runner. */
export class MemoryProposalCache implements ProposalCache {
  private readonly store = new Map<string, CachedProposal>();
  async get(key: string, _projectId: string): Promise<CachedProposal | null> {
    return this.store.get(key) ?? null;
  }
  async put(key: string, _projectId: string, submission: ProposalSubmission, recordedAt: number): Promise<void> {
    this.store.set(key, { key, submission, recordedAt });
  }
}

/** Firestore-backed cache namespaced per project under directingCache. */
export class FirestoreProposalCache implements ProposalCache {
  constructor(private readonly db: Firestore) {}
  async get(key: string, projectId: string): Promise<CachedProposal | null> {
    const snap = await this.db
      .collection("projects")
      .doc(projectId)
      .collection("directingCache")
      .doc(key)
      .get();
    if (!snap.exists) return null;
    const data = snap.data() as { submission: ProposalSubmission; recordedAt?: unknown } | undefined;
    if (!data || !data.submission) return null;
    return { key, submission: data.submission, recordedAt: Number(data.recordedAt ?? 0) };
  }
  async put(key: string, projectId: string, submission: ProposalSubmission, recordedAt: number): Promise<void> {
    await this.db
      .collection("projects")
      .doc(projectId)
      .collection("directingCache")
      .doc(key)
      .set({ submission, recordedAt });
  }
}

/** A cache that never hits — the default when none is supplied. */
export const NO_CACHE: ProposalCache = {
  get: async () => null,
  put: async () => {},
};
