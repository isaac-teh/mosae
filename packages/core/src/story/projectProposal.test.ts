import { describe, expect, it } from "vitest";
import { projectProposal } from "./projectProposal";

const proposal = {
  schemaVersion: 1 as const,
  id: "proposal-1",
  projectId: "project-1",
  storyIntentId: "intent-1",
  parentProposalId: null,
  state: "draft" as const,
  version: 1,
  title: "A weekend together",
  moments: [
    { id: "moment-1", shotId: "shot-1", kind: "photo" as const, title: "Arrival", description: "At the station", rationale: "Opening" },
    { id: "moment-2", shotId: "shot-2", kind: "photo" as const, title: "Dinner", description: "Around the table", rationale: "Togetherness" },
    { id: "moment-3", shotId: "shot-3", kind: "photo" as const, title: "Morning", description: "Walking outside", rationale: "Closing" },
  ],
  chapters: [
    { id: "chapter-1", title: "Coming together", summary: "The first day", momentIds: ["moment-1", "moment-2"] },
    { id: "chapter-2", title: "A new day", summary: "The morning after", momentIds: ["moment-3"] },
  ],
  constraints: {
    excludedShotIds: [],
    deselectedMomentIds: ["moment-2"],
    mustIncludeMomentIds: [],
    feedback: [],
  },
  openQuestions: [],
};

const project = {
  id: "project-1",
  title: "Family weekend",
  place: "Singapore",
  dateRange: "22–23 Sep 2026",
};

const shots = [
  { id: "shot-1", kind: "photo" as const, thumbnailUrl: "https://storage.test/one", eventLabel: "Day 1, afternoon" },
  { id: "shot-2", kind: "photo" as const, thumbnailUrl: "https://storage.test/two", eventLabel: "Day 1, evening" },
  { id: "shot-3", kind: "photo" as const, thumbnailUrl: "https://storage.test/three", eventLabel: "Day 2, morning" },
];

describe("projectProposal", () => {
  it.each([
    { deselected: [], estimate: "~15 sec film" },
    { deselected: ["moment-2"], estimate: "~9 sec film" },
    { deselected: ["moment-1"], estimate: "~12 sec film" },
    { deselected: ["moment-1", "moment-2", "moment-3"], estimate: "~0 sec film" },
  ])("estimates mixed media in selected photo-equivalents: $estimate", ({ deselected, estimate }) => {
    const mixed = {
      ...proposal,
      moments: [
        proposal.moments[0],
        { ...proposal.moments[1], kind: "video" as const, previewInSec: 2, previewOutSec: 12 },
        { ...proposal.moments[2], kind: "video" as const, previewInSec: 5, previewOutSec: 15 },
      ],
      constraints: { ...proposal.constraints, deselectedMomentIds: deselected },
    };
    const plan = projectProposal(mixed, project, shots);
    expect(plan.estimatedFilmLabel).toBe(estimate);
    expect(plan.moments[1].durationLabel).toBe("10 sec");
  });

  it("projects proposal deselections and resolved thumbnail URLs into review moments", () => {
    const plan = projectProposal(proposal, project, shots);

    expect(plan.moments.map(({ id, selected, imageKey }) => ({ id, selected, imageKey }))).toEqual([
      { id: "moment-1", selected: true, imageKey: "https://storage.test/one" },
      { id: "moment-2", selected: false, imageKey: "https://storage.test/two" },
      { id: "moment-3", selected: true, imageKey: "https://storage.test/three" },
    ]);
    expect(plan.chapters.map(({ dayLabel }) => dayLabel)).toEqual(["Day 1, afternoon", "Day 2, morning"]);
    expect(plan.estimatedFilmLabel).toBe("~6 sec film");
  });

  it("keeps a chapter and all its moments when every moment in it is deselected", () => {
    const allDeselected = {
      ...proposal,
      constraints: { ...proposal.constraints, deselectedMomentIds: ["moment-1", "moment-2"] },
    };

    const plan = projectProposal(allDeselected, project, shots);

    expect(plan.chapters[0]).toMatchObject({ id: "chapter-1", momentIds: ["moment-1", "moment-2"] });
    expect(plan.moments.filter(({ id }) => plan.chapters[0].momentIds.includes(id)).map(({ selected }) => selected)).toEqual([false, false]);
  });
  it("counts the project's other photos from the total, not from the proposal's own shots", () => {
    expect(projectProposal(proposal, project, shots).otherPhotoCount).toBe(0);
    expect(projectProposal(proposal, project, shots, { totalShotCount: 12 }).otherPhotoCount).toBe(9);
  });
});

describe("projectProposal — Review edits", () => {
  const base = {
    id: "p1", title: "Trip",
    moments: [
      { id: "m1", shotId: "s1", kind: "photo" as const, title: "One", description: "", rationale: "Opens the day." },
      { id: "m2", shotId: "s2", kind: "photo" as const, title: "Two", description: "", rationale: "" },
      { id: "m3", shotId: "s3", kind: "photo" as const, title: "Three", description: "", rationale: "Best moment." },
    ],
    chapters: [{ id: "c1", title: "Day 1", summary: "", momentIds: ["m1", "m2"] }, { id: "c2", title: "Day 2", summary: "", momentIds: ["m3"] }],
    constraints: { deselectedMomentIds: [] as string[] },
  };
  const shots = ["s1", "s2", "s3", "s9", "sx"].map((id) => ({ id, kind: "photo" as const, thumbnailUrl: `thumb:${id}`, eventLabel: "Day" }));
  const project = { id: "proj" };

  it("carries each moment's reason and fills in empty edits", () => {
    const plan = projectProposal(base, project, shots);
    expect(plan.moments.map((m) => m.reason)).toEqual(["Opens the day.", undefined, "Best moment."]);
    expect(plan.edits).toEqual({ deselectedMomentIds: [], mustIncludeMomentIds: [], hiddenShotIds: [], momentOrder: [], photoSwaps: {} });
  });

  it("shows a swapped photo, ignores a swap to a hidden shot, and takes hidden photos out", () => {
    const plan = projectProposal({ ...base, constraints: { deselectedMomentIds: [], hiddenShotIds: ["s9", "s2"], photoSwaps: { m1: "s9", m3: "sx" } } }, project, shots);
    expect(plan.moments.map((m) => m.imageKey)).toEqual(["thumb:s1", "thumb:s2", "thumb:sx"]);
    expect(plan.moments.map((m) => [m.selected, m.hidden ?? false])).toEqual([[true, false], [false, true], [true, false]]);
  });

  it("orders moments within their chapter only", () => {
    const plan = projectProposal({ ...base, constraints: { deselectedMomentIds: [], momentOrder: ["m3", "m2", "m1"] } }, project, shots);
    expect(plan.chapters.map((c) => c.momentIds)).toEqual([["m2", "m1"], ["m3"]]);
  });

  it("lists left-out photos with their thumbnails and reasons", () => {
    const plan = projectProposal({ ...base, leftOut: [{ shotId: "sx", reason: "Hidden by you." }] }, project, shots);
    expect(plan.leftOut).toEqual([{ shotId: "sx", thumbnailUrl: "thumb:sx", reason: "Hidden by you." }]);
  });
});
