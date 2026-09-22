import { describe, expect, it } from "vitest";
import type { ProposalSubmission } from "./assemble.js";
import type { WorkingSet, WorkingShot } from "./workingSet.js";
import { validateProposal } from "./validateProposal.js";

type ValidationShot = WorkingShot & {
  sourceStartSec?: number | null;
  sourceEndSec?: number | null;
};

const photo = (id: string): ValidationShot => ({
  id,
  assetStatus: "understood",
  durationSec: null,
  analysis: null,
});

const video = (id: string, sourceStartSec = 10, sourceEndSec = 20): ValidationShot => ({
  id,
  assetStatus: "understood",
  durationSec: sourceEndSec - sourceStartSec,
  sourceStartSec,
  sourceEndSec,
  analysis: null,
});

const workingSet: WorkingSet = {
  shots: [photo("p1"), photo("p2"), photo("p3"), photo("p4"), video("v1")],
  lines: [],
};

const validProposal: ProposalSubmission = {
  title: "A day together",
  moments: [
    { shotId: "p1", kind: "photo", title: "One", description: "", rationale: "" },
    { shotId: "p2", kind: "photo", title: "Two", description: "", rationale: "" },
    { shotId: "p3", kind: "photo", title: "Three", description: "", rationale: "" },
    { shotId: "p4", kind: "photo", title: "Four", description: "", rationale: "" },
    { shotId: "v1", kind: "video", title: "Five", description: "", rationale: "", previewInSec: 12, previewOutSec: 18 },
  ],
  chapters: [
    { title: "Arrival", summary: "", momentIds: ["p1", "p2", "v1"] },
    { title: "Together", summary: "", momentIds: ["p3", "p4"] },
  ],
  openQuestions: [],
};

const options = {
  targetSec: 30,
  excludedShotIds: [] as string[],
  mustIncludeShotIds: [] as string[],
};

function diagnostics(result: ReturnType<typeof validateProposal>): string[] {
  expect(result.ok).toBe(false);
  return result.ok ? [] : result.diagnostics;
}

describe("validateProposal", () => {
  it("passes a proposal satisfying every semantic rule", () => {
    expect(validateProposal(validProposal, workingSet, options)).toEqual({ ok: true });
  });

  it("working_set_membership names shot ids outside the working set and how to fix them", () => {
    const proposal = {
      ...validProposal,
      moments: [...validProposal.moments, { shotId: "invented", kind: "photo" as const, title: "No", description: "", rationale: "" }],
    };

    expect(diagnostics(validateProposal(proposal, workingSet, options))).toEqual(expect.arrayContaining([
      expect.stringMatching(/working_set_membership.*invented.*use only.*working set/i),
    ]));
  });

  it("excluded_shots names excluded moments and tells the model to remove them", () => {
    expect(diagnostics(validateProposal(validProposal, workingSet, {
      ...options,
      excludedShotIds: ["p2"],
    }))).toEqual(expect.arrayContaining([
      expect.stringMatching(/excluded_shots.*p2.*remove/i),
    ]));
  });

  it("must_include_shots names missing required shots and tells the model to add them", () => {
    const withRequiredShot = { shots: [...workingSet.shots, photo("required")], lines: [] };

    expect(diagnostics(validateProposal(validProposal, withRequiredShot, {
      ...options,
      mustIncludeShotIds: ["required"],
    }))).toEqual(expect.arrayContaining([
      expect.stringMatching(/must_include_shots.*required.*add/i),
    ]));
  });

  it("chapter_minimum_distinct names a thin chapter and its distinct shot ids", () => {
    const proposal = {
      ...validProposal,
      chapters: [{ title: "Arrival", summary: "", momentIds: ["p1", "p1"] }, validProposal.chapters[1]],
    };

    expect(diagnostics(validateProposal(proposal, workingSet, options))).toEqual(expect.arrayContaining([
      expect.stringMatching(/chapter_minimum_distinct.*Arrival.*p1.*at least 2/i),
    ]));
  });

  it("proposal_minimum_distinct rejects a story built from too few files", () => {
    const proposal: ProposalSubmission = {
      ...validProposal,
      moments: validProposal.moments.slice(0, 3),
      chapters: [
        { title: "Arrival", summary: "", momentIds: ["p1", "p2"] },
        { title: "Together", summary: "", momentIds: ["p2", "p3"] },
      ],
    };

    expect(diagnostics(validateProposal(proposal, workingSet, { ...options, targetSec: 15 }))).toEqual(expect.arrayContaining([
      expect.stringMatching(/proposal_minimum_distinct.*p1.*p2.*p3.*3 distinct.*at least 4/i),
    ]));
  });

  it("duration_coverage rejects a proposal too thin for the target duration", () => {
    const result = diagnostics(validateProposal(validProposal, workingSet, {
      ...options,
      targetSec: 31,
    }));
    const diagnostic = result.find((item) => item.startsWith("duration_coverage:"));
    expect(diagnostic).toMatch(/6 photo-equivalents.*at least 6\.2.*31 seconds.*add/i);
    for (const shotId of ["p1", "p2", "p3", "p4", "v1"]) expect(diagnostic).toContain(shotId);
  });

  it("video_preview_bounds names a video preview outside its own shot interval", () => {
    const proposal: ProposalSubmission = {
      ...validProposal,
      moments: validProposal.moments.map((moment) => moment.shotId === "v1"
        ? { ...moment, kind: "video" as const, previewInSec: 9, previewOutSec: 18 }
        : moment),
    };

    expect(diagnostics(validateProposal(proposal, workingSet, options))).toEqual(expect.arrayContaining([
      expect.stringMatching(/video_preview_bounds.*v1.*9.*18.*10.*20.*inside/i),
    ]));
  });
});
