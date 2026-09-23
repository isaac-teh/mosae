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
