import { describe, expect, it } from "vitest";
import type { ProposalConstraints } from "@mosae/contracts";
import { assembleProposal } from "./assemble.js";
import { validateProposal } from "./validateProposal.js";
import { buildWorkingSet } from "./workingSet.js";
import { cacheKeyFor, constraintShotIds, MemoryProposalCache, NO_CACHE } from "./proposalCache.js";
import type { PlanJob } from "./runPlan.js";

const photo = (id: string) => ({
  id,
  assetStatus: "understood" as const,
  eventId: "event-1",
  day: "2026-05-03",
  place: "Park",
  durationSec: null,
  sourceStartSec: null,
  sourceEndSec: null,
  analysis: {
    kind: "photo" as const,
    caption: `${id} family picnic`,
    subjects: [{ peopleCount: 4, roles: ["family"], attributes: [] }],
    setting: "park",
    activities: ["picnic"],
    mood: "warm",
    shotType: "wide",
    aesthetics: 4,
    keyMomentScore: 4,
    tags: ["family"],
  },
});

const shots = ["p1", "p2", "p3", "p4", "p5"].map(photo);

const constraints: ProposalConstraints = {
  excludedShotIds: [],
  deselectedMomentIds: [],
  mustIncludeMomentIds: ["p5"],
  feedback: ["Keep the family warmth."],
};

const job: PlanJob = {
  id: "job-1",
  projectId: "project-1",
  proposalId: "proposal-1",
  storyIntentId: "intent-1",
  version: 1,
  parentProposalId: null,
  intent: { text: "Tell the story of our picnic.", focus: ["family"] },
  constraints,
  targetSec: 25,
  shots,
};

const submission = {
  title: "A day together",
  moments: shots.map((shot, index) => ({
    shotId: shot.id,
    kind: "photo" as const,
    title: `Moment ${index + 1}`,
    description: `Description ${index + 1}`,
    rationale: `Reason ${index + 1}`,
  })),
  chapters: [
    { title: "Arrival", summary: "The family gathers.", momentIds: ["p1", "p2", "p3"] },
    { title: "Together", summary: "The day settles.", momentIds: ["p4", "p5"] },
  ],
  openQuestions: [],
};

describe("proposalCache", () => {
  it("keys by intent + working set, so a changed intent or media invalidates the cache", () => {
    const base = cacheKeyFor(job);
    expect(base).toMatch(/^[0-9a-f]{64}$/);

    // Same job -> same key (reproducible across runs for stable shot ids).
    expect(cacheKeyFor({ ...job, proposalId: "different-proposal" })).toBe(base);

    // A different intent text changes the key.
    const otherIntent = cacheKeyFor({ ...job, intent: { text: "End with a surprise.", focus: ["family"] } });
    expect(otherIntent).not.toBe(base);

    // Adding feedback (a constraint that flows into assembly) invalidates it.
    const otherFeedback = cacheKeyFor({
      ...job,
      constraints: { ...constraints, feedback: ["Keep the family warmth.", "Add a quiet moment"] },
    });
    expect(otherFeedback).not.toBe(base);

    // A different working set (different media) invalidates it.
    const otherMedia = cacheKeyFor({ ...job, shots: [...shots.slice(0, 3), photo("p6"), photo("p7")] });
    expect(otherMedia).not.toBe(base);
  });

  it("resolves must-include constraint ids to catalog shot ids", () => {
    const parentProposal = { moments: [{ id: "parent-moment-0", shotId: "p5" }] };
    const withParent: PlanJob = { ...job, parentProposal: parentProposal as never };
    expect(constraintShotIds(withParent)).toEqual(["p5"]);
  });

  it("serves a cached submission that re-assembles into a fresh valid proposal", async () => {
    const cache = new MemoryProposalCache();
    await cache.put(cacheKeyFor(job), job.projectId, submission, Date.now());

    // A second run for the same project/intent/media hits the cache.
    const hit = await cache.get(cacheKeyFor(job), job.projectId);
    expect(hit).not.toBeNull();
    if (!hit) return;

    const workingSet = buildWorkingSet(job.shots, {
      cap: job.workingSetCap,
      excludedShotIds: job.constraints.excludedShotIds,
      mustIncludeMomentIds: constraintShotIds(job),
    });

    // The cached submission is still valid against this run's working set.
    expect(validateProposal(hit.submission, workingSet, {
      targetSec: job.targetSec,
      excludedShotIds: job.constraints.excludedShotIds,
      mustIncludeShotIds: constraintShotIds(job),
    })).toEqual({ ok: true });

    // Re-assembling against a NEW proposal id mints fresh moment/chapter ids.
    const reassembled = assembleProposal(hit.submission, {
      proposalId: "brand-new-proposal",
      projectId: job.projectId,
      storyIntentId: job.storyIntentId,
      version: 2,
      parentProposalId: null,
      constraints: job.constraints,
      parentProposal: null,
    });

    expect(reassembled.id).toBe("brand-new-proposal");
    expect(reassembled.version).toBe(2);
    // Shot references are preserved; only the minted ids changed.
    expect(reassembled.moments.map((m) => m.shotId)).toEqual(["p1", "p2", "p3", "p4", "p5"]);
    expect(reassembled.moments[0].id).toMatch(/^brand-new-proposal-moment-0$/);
  });

  it("returns null for a missing key and NO_CACHE never hits", async () => {
    const cache = new MemoryProposalCache();
    expect(await cache.get("absent", job.projectId)).toBeNull();
    expect(await NO_CACHE.get("absent", job.projectId)).toBeNull();
  });

  it("invalidates the key when a must-include constraint is dropped", () => {
    const withMustInclude = cacheKeyFor(job);
    const withoutMustInclude = cacheKeyFor({ ...job, constraints: { ...constraints, mustIncludeMomentIds: [] } });
    expect(withoutMustInclude).not.toBe(withMustInclude);
  });
});
