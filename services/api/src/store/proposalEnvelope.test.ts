/**
 * Compose reads the proposal document that directing wrote. Both sides parse
 * it with a STRICT schema, and the stored document carries two fields the
 * schema does not declare, so a reader that forgets to strip them rejects
 * perfectly good data.
 *
 * That is not hypothetical. The first end-to-end run failed with
 * `invalid proposal: Unrecognized keys: "jobId", "createdAt"` after every
 * unit test passed, because those tests fed hand-built proposals rather than
 * a document shaped the way Firestore actually holds one. The fixture below
 * is copied from a real stored proposal for that reason.
 */
import { describe, expect, it } from "vitest";
import { safeParseStoryProposal } from "@mosae/contracts";
import { stripProposalEnvelope } from "./directingStore.js";

/** The proposal itself, exactly as the schema declares it. */
const proposal = {
  schemaVersion: 1,
  id: "proposal-1",
  projectId: "project-1",
  storyIntentId: "intent-1",
  parentProposalId: null,
  version: 1,
  state: "accepted",
  title: "First Family Trip to Japan",
  moments: [
    {
      id: "proposal-1-moment-0",
      shotId: "UYeUWOAoo2q0wR5Bw8Vq_0000",
      kind: "photo",
      title: "Arrival in Tokyo",
      description: "High-angle view of the Shibuya Crossing intersection.",
      rationale: "Opens on the scale of the city.",
    },
    {
      id: "proposal-1-moment-1",
      shotId: "sAoKFei1HiJ7xUL7Ucdi_0000",
      kind: "photo",
      title: "Tokyo Alleyway at Night",
      description: "A lone figure in a rain-slicked alley under neon signs.",
      rationale: "Adds the city at night.",
    },
  ],
  chapters: [
    {
      id: "proposal-1-chapter-0",
      title: "Tokyo Neon",
      summary: "Bustling streets and quiet family moments.",
      momentIds: ["proposal-1-moment-0", "proposal-1-moment-1"],
    },
  ],
  constraints: { excludedShotIds: [], deselectedMomentIds: [], mustIncludeMomentIds: [], feedback: [] },
  openQuestions: [],
};

/** What directingStore actually writes: the proposal plus its envelope. */
const asStored = { ...proposal, jobId: "job-1", createdAt: 1_700_000_000_000 };

describe("stored proposal envelope", () => {
  it("the bare proposal parses, so the fixture itself is sound", () => {
    expect(safeParseStoryProposal(proposal).ok).toBe(true);
  });

  it("rejects the stored document when the envelope is left on", () => {
    const parsed = safeParseStoryProposal(asStored);
    expect(parsed.ok).toBe(false);
  });

  it("accepts the stored document once the envelope is stripped", () => {
    expect(safeParseStoryProposal(stripProposalEnvelope(asStored)).ok).toBe(true);
  });

  it("removes the envelope fields and nothing else", () => {
    const stripped = stripProposalEnvelope(asStored) as Record<string, unknown>;
    expect(stripped).not.toHaveProperty("jobId");
    expect(stripped).not.toHaveProperty("createdAt");
    expect(stripped).toEqual(proposal);
  });

  it("leaves a proposal that never had an envelope untouched", () => {
    expect(stripProposalEnvelope({ ...proposal })).toEqual(proposal);
  });

  it("passes undefined through rather than inventing an empty proposal", () => {
    expect(stripProposalEnvelope(undefined)).toBeUndefined();
  });

  it("strips a null jobId, which is how a revised proposal is stored", () => {
    const revised = { ...proposal, jobId: null, createdAt: 1_700_000_000_000 };
    expect(safeParseStoryProposal(stripProposalEnvelope(revised)).ok).toBe(true);
  });
});
