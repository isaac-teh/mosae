import { describe, expect, it } from "vitest";
import type { ProposalSubmission } from "./assemble.js";
import type { WorkingSet, WorkingShot } from "./workingSet.js";
import { validateProposal } from "./validateProposal.js";

const photo = (id: string): WorkingShot => ({
  id,
  assetStatus: "understood",
  durationSec: null,
  analysis: {
    kind: "photo",
    caption: id,
    subjects: [],
    setting: "park",
    activities: [],
    mood: "warm",
    shotType: "wide",
    aesthetics: 4,
    keyMomentScore: 4,
    tags: [],
  },
});

const video = (id: string, sourceStartSec = 10, sourceEndSec = 20): WorkingShot => ({
  id,
  assetStatus: "understood",
  durationSec: sourceEndSec - sourceStartSec,
  sourceStartSec,
  sourceEndSec,
  analysis: {
    kind: "video",
    description: id,
    camera: "handheld",
    role: "B_ROLL",
    subjects: [],
    emotion: "happy",
    quality: 4,
    usable: true,
    reason: "clear",
  },
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
    { shotId: "v1", kind: "video", title: "Five", description: "", rationale: "", previewInSec: 10, previewOutSec: 20 },
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

  it("working_set_membership rejects an invented id referenced only by a chapter", () => {
    const proposal: ProposalSubmission = {
      ...validProposal,
      chapters: [
        { ...validProposal.chapters[0], momentIds: ["p1", "p2", "invented-in-chapter"] },
        validProposal.chapters[1],
      ],
    };

    expect(diagnostics(validateProposal(proposal, workingSet, options))).toEqual(expect.arrayContaining([
      expect.stringMatching(/working_set_membership.*invented-in-chapter.*use only.*working set/i),
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

  it("uses catalog kind for capacity and requires a legal preview when a video is claimed as a photo", () => {
    const oneSecondVideoSet: WorkingSet = {
      ...workingSet,
      shots: workingSet.shots.map((shot) => shot.id === "v1" ? video("v1", 10, 11) : shot),
    };
    const proposal: ProposalSubmission = {
      ...validProposal,
      moments: validProposal.moments.map((moment) => moment.shotId === "v1"
        ? { shotId: "v1", kind: "photo" as const, title: "Five", description: "", rationale: "" }
        : moment),
    };

    const result = diagnostics(validateProposal(proposal, oneSecondVideoSet, { ...options, targetSec: 25 }));
    expect(result).toEqual(expect.arrayContaining([
      expect.stringMatching(/catalog_media_kind.*v1.*video.*photo.*set kind/i),
      expect.stringMatching(/video_preview_bounds.*v1.*undefined.*10.*11.*inside/i),
      expect.stringMatching(/duration_coverage.*4 photo-equivalents.*at least 5/i),
    ]));
  });

  it("accepts a legal video preview inside a public nonzero-start shot interval", () => {
    const catalogVideo: WorkingShot = video("v1", 10, 20);
    const intervalWorkingSet: WorkingSet = {
      ...workingSet,
      shots: workingSet.shots.map((shot) => shot.id === "v1" ? catalogVideo : shot),
    };

    expect(validateProposal(validProposal, intervalWorkingSet, options)).toEqual({ ok: true });
  });
  it("counts only the preview range a video actually plays, matching the client estimate", async () => {
    // v1's source interval is 10 seconds, but the proposal previews 2 of them.
    const shortPreview: ProposalSubmission = {
      ...validProposal,
      moments: validProposal.moments.map((moment) => moment.shotId === "v1"
        ? { ...moment, previewInSec: 10, previewOutSec: 12 }
        : moment),
    };

    const diagnostic = diagnostics(validateProposal(shortPreview, workingSet, options))
      .find((item) => item.startsWith("duration_coverage:"));

    expect(diagnostic).toMatch(/4\.4 photo-equivalents.*at least 6.*30 seconds/i);
  });
});
