import { describe, it, expect } from "vitest";
import { safeParseStoryProposal, StoryProposalSchema } from "./proposal.js";

const valid = {
  schemaVersion: 1,
  id: "proposal1",
  projectId: "project1",
  storyIntentId: "intent1",
  parentProposalId: null,
  state: "draft",
  version: 1,
  title: "Mei's 7th Birthday in Japan",
  moments: [
    { id: "m1", shotId: "shot1", kind: "video", previewInSec: 12, previewOutSec: 18, title: "Birthday song", description: "Mei claps as the cake arrives.", rationale: "The emotional peak the user asked for." },
    { id: "m2", shotId: "shot2", kind: "photo", title: "Strawberry mochi", description: "A market sweet.", rationale: "Food, which the user named." },
  ],
  chapters: [{ id: "c1", title: "Day 4, Kyoto", summary: "The birthday.", momentIds: ["m1", "m2"] }],
  constraints: { excludedShotIds: [], deselectedMomentIds: [], mustIncludeMomentIds: ["m1"], feedback: [] },
  openQuestions: ["Who is the adult carrying Mei?"],
};

describe("StoryProposalSchema", () => {
  it("accepts a draft proposal with video and photo moments", () => {
    const result = safeParseStoryProposal(valid);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.proposal.moments).toHaveLength(2);
  });

  it("rejects a photo moment carrying a preview range", () => {
    const leaky = { ...valid, moments: [{ ...valid.moments[1], previewInSec: 1, previewOutSec: 2 }] };
    expect(safeParseStoryProposal(leaky).ok).toBe(false);
  });

  it("rejects a chapter referencing a moment id that does not exist", () => {
    const dangling = { ...valid, chapters: [{ id: "c1", title: "Day 4", summary: "x", momentIds: ["m1", "ghost"] }] };
    const result = safeParseStoryProposal(dangling);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(" ")).toContain("ghost");
  });

  it("rejects a must-include moment id that does not exist", () => {
    const dangling = { ...valid, constraints: { ...valid.constraints, mustIncludeMomentIds: ["ghost"] } };
    expect(safeParseStoryProposal(dangling).ok).toBe(false);
  });

  it("accepts a proposal with a deselected moment", () => {
    const deselected = { ...valid, constraints: { ...valid.constraints, deselectedMomentIds: ["m2"] } };
    const result = safeParseStoryProposal(deselected);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.proposal.constraints.deselectedMomentIds).toEqual(["m2"]);
  });

  it("rejects a deselected moment id that does not exist", () => {
    const dangling = { ...valid, constraints: { ...valid.constraints, deselectedMomentIds: ["ghost"] } };
    const result = safeParseStoryProposal(dangling);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(" ")).toContain("ghost");
  });

  it("rejects a moment that is both deselected and must-include", () => {
    const contradictory = { ...valid, constraints: { ...valid.constraints, deselectedMomentIds: ["m1"] } };
    const result = safeParseStoryProposal(contradictory);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(" ")).toContain("both deselected and must-include");
  });

  it("rejects duplicate moment ids", () => {
    const duplicated = { ...valid, moments: [valid.moments[0], { ...valid.moments[1], id: "m1" }] };
    expect(safeParseStoryProposal(duplicated).ok).toBe(false);
  });

  it("accepts an accepted proposal that names its parent", () => {
    const accepted = { ...valid, state: "accepted", version: 2, parentProposalId: "proposal1" };
    expect(StoryProposalSchema.safeParse(accepted).success).toBe(true);
  });

  it("rejects an unknown state", () => {
    expect(safeParseStoryProposal({ ...valid, state: "published" }).ok).toBe(false);
  });

  it("accepts an optional cadence recommendation and rejects unknown cadences", () => {
    expect(safeParseStoryProposal({ ...valid, recommendedCadence: "playful", cadenceReason: "kids laughing" }).ok).toBe(true);
    expect(safeParseStoryProposal({ ...valid, recommendedCadence: "sad" }).ok).toBe(false);
    expect(safeParseStoryProposal(valid).ok).toBe(true);
  });

  it("accepts an optional leftOut list while preserving older proposal shapes", () => {
    expect(StoryProposalSchema.safeParse(valid).success).toBe(true);
    expect(StoryProposalSchema.safeParse({ ...valid, leftOut: [{ shotId: "shot-x", reason: "Hidden by you." }] }).success).toBe(true);
  });
});
