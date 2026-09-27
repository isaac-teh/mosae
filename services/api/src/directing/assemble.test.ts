import { describe, expect, it } from "vitest";
import type { StoryProposal } from "@mosae/contracts";
import { assembleProposal, type ProposalSubmission } from "./assemble.js";

const body: ProposalSubmission = {
  title: "A warm weekend",
  moments: [
    { shotId: "shot-a", kind: "photo", title: "Arrival", description: "The family arrives.", rationale: "Opens the story." },
    { shotId: "shot-a", kind: "photo", title: "Arrival again", description: "Duplicate reference.", rationale: "Still the opening." },
    { shotId: "shot-b", kind: "video", title: "Laughter", description: "Everyone laughs.", rationale: "The emotional peak.", previewInSec: 1, previewOutSec: 3 },
  ],
  chapters: [{ title: "The beginning", summary: "Setting out.", momentIds: ["shot-a", "shot-b", "shot-a"] }],
  openQuestions: ["Which day was this?"] ,
};

const context = {
  proposalId: "proposal-7",
  projectId: "project-1",
  storyIntentId: "intent-2",
  version: 3,
  parentProposalId: "proposal-6",
  constraints: { excludedShotIds: ["shot-x"], deselectedMomentIds: ["proposal-6-moment-0"], mustIncludeMomentIds: ["proposal-6-moment-1"], feedback: ["More warmth"] },
  parentProposal: {
    moments: [
      { id: "proposal-6-moment-0", shotId: "shot-a", kind: "photo", title: "Arrival", description: "The family arrives.", rationale: "Opens the story." },
      { id: "proposal-6-moment-1", shotId: "shot-b", kind: "video", title: "Laughter", description: "Everyone laughs.", rationale: "The emotional peak.", previewInSec: 1, previewOutSec: 3 },
    ] as StoryProposal["moments"],
  },
};

describe("assembleProposal", () => {
  it("deduplicates repeated shot references and maps chapter references to minted ids", () => {
    const proposal = assembleProposal(body, context);
    expect(proposal.moments.map((moment) => [moment.id, moment.shotId])).toEqual([
      ["proposal-7-moment-0", "shot-a"],
      ["proposal-7-moment-1", "shot-b"],
    ]);
    expect(proposal.chapters[0]?.momentIds).toEqual(["proposal-7-moment-0", "proposal-7-moment-1"]);
  });

  it("carries runner-owned metadata and constraints forward", () => {
    const proposal = assembleProposal(body, context);
    expect(proposal).toMatchObject({
      schemaVersion: 1, id: "proposal-7", projectId: "project-1", storyIntentId: "intent-2",
      version: 3, parentProposalId: "proposal-6", state: "draft",
    });
    expect(proposal.constraints).toEqual({ ...context.constraints, deselectedMomentIds: ["proposal-7-moment-0"], mustIncludeMomentIds: ["proposal-7-moment-1"] });
  });

  it("drops carried ids that are not present in the parent or current submission", () => {
    const proposal = assembleProposal({ ...body, moments: [body.moments[0]], chapters: [{ ...body.chapters[0], momentIds: ["shot-a"] }] }, {
      ...context,
      constraints: { ...context.constraints, deselectedMomentIds: ["proposal-6-moment-1", "stale-moment"] },
    });
    expect(proposal.constraints.deselectedMomentIds).toEqual([]);
  });

  it("uses stable ids for identical assemblies", () => {
    expect(assembleProposal(body, context)).toEqual(assembleProposal(body, context));
  });

  it("carries the cadence recommendation onto the proposal", () => {
    const proposal = assembleProposal({ ...body, recommendedCadence: "tender", cadenceReason: "quiet sunset" }, context);
    expect(proposal.recommendedCadence).toBe("tender");
    expect(proposal.cadenceReason).toBe("quiet sunset");
  });
});
