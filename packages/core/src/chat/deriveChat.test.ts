import { describe, expect, it } from "vitest";
import { deriveChat } from "./deriveChat.js";
import type { ChatInput, ChatItem, ChatState, ProjectSummary } from "./types.js";
import type { Film, StoryPlan } from "../story/types.js";

const summary: ProjectSummary = {
  total: 10, photos: 10, clips: 0, days: 2, dateRange: { from: "2026-10-20", to: "2026-10-21" },
  places: ["Tokyo", "Kyoto"], country: "Japan", season: "late October",
  processed: { ingested: 10, understood: 10, faces: 10 }, ready: { summary: true, faces: true, plan: true },
};
const plan: StoryPlan = {
  planId: "p1", title: "Japan", place: "Japan", dateRange: "Oct 20–21", coverImageKey: "cover",
  intro: { headline: "", body: "" }, archivalMatch: [], timelineIntro: { headline: "", body: "", sequence: "" },
  moments: Array.from({ length: 4 }, (_, i) => ({ id: `m${i + 1}`, title: `Moment ${i + 1}`, meta: "", tag: { emoji: "", label: "" }, imageKey: "", kind: "photo" as const, selected: true, favorite: false })),
  chapters: [], otherPhotoCount: 0, albumName: "", suggestions: [], estimatedFilmLabel: "", totalMomentCount: 4,
  leftOut: [{ shotId: "close-1", thumbnailUrl: "", reason: "Close call" }, { shotId: "close-2", thumbnailUrl: "", reason: "Close call" }],
};
const film: Film = {
  filmId: "f1", planId: "p1", version: 1, title: "Japan", subtitle: "", place: "Japan", dateLabel: "",
  durationSec: 120, posterKey: "", savePosterKey: "", videoKey: "", momentCount: 4, audioLabel: "",
  shortcuts: [], status: "ready", videoUrl: null, rendering: false, reasons: [],
};
const base = (): ChatInput => ({
  summary, intent: { text: "Our Japan trip" }, people: [], peopleConfirmed: true, plan,
  momentsConfirmed: false, conflict: null, direction: null, generation: null, notes: [],
});
const kinds = (items: ChatItem[]) => items.map((item) => item.kind);

describe("deriveChat state table", () => {
  it("gates occasion on local transfer, server story readiness and acknowledged failures", () => {
    const input = { ...base(), intent: null };
    for (const pending of [
      { ...input, localMediaPending: true },
      { ...input, summary: { ...summary, ready: { ...summary.ready, story: false } } },
      { ...input, summary: { ...summary, processed: { ...summary.processed, understood: 0 } } },
      { ...input, summary: { ...summary, upload: { expected: 11, settled: 11, failed: 1, cancelled: 0, closed: true } } },
    ]) expect(deriveChat(pending).items.some(item => item.kind === "occasion")).toBe(false);
  });

  it("attaches individual asset statuses to the existing reading progress item", () => {
    const pending = deriveChat({ ...base(), summary: { ...summary, ready: { ...summary.ready, summary: false }, assetStatuses: [
      { assetId: "a1", kind: "photo", status: "understood" },
      { assetId: "a2", kind: "photo", status: "ingested" },
      { assetId: "a3", kind: "video", status: "uploaded" },
    ] } });
    expect(pending.items[0]).toMatchObject({ kind: "typing", text: "Reading your photos, 10 of 10", photoProgress: [
      { assetId: "a1", kind: "photo", status: "understood" },
      { assetId: "a2", kind: "photo", status: "ingested" },
      { assetId: "a3", kind: "video", status: "uploaded" },
    ] });
  });

  it("waits for the first photos instead of claiming there are zero", () => {
    const pending = deriveChat({ ...base(), summary: { ...summary, total: 0, photos: 0, clips: 0, ready: { ...summary.ready, summary: false } }, intent: null, people: null, peopleConfirmed: false, plan: null });
    expect(pending.items[0]).toMatchObject({ kind: "typing", text: "Waiting for your photos to arrive…" });
  });

  it("keeps the photo reading grid through asset understanding after ingest completes", () => {
    const pending = deriveChat({ ...base(), summary: { ...summary, ready: { ...summary.ready, faces: false }, assetStatuses: [
      { assetId: "a1", kind: "photo", status: "understood" },
      { assetId: "a2", kind: "photo", status: "ingested" },
    ] } });
    expect(pending.items[0]).toMatchObject({ kind: "typing", text: "Reading your photos, 10 of 10", photoProgress: [{ assetId: "a1", status: "understood" }, { assetId: "a2", status: "ingested" }] });
    expect(pending.items.some((item) => item.kind === "you" && item.text === "Our Japan trip")).toBe(true);
  });

  it("skips person identification for three ready photos with no repeat face", () => {
    const state = deriveChat({
      ...base(),
      summary: { ...summary, total: 3, photos: 3, clips: 0, processed: { ingested: 3, understood: 3, faces: 1 }, ready: { summary: true, faces: true, plan: false } },
      people: [], peopleConfirmed: false, plan: null,
    });

    expect(state.items.some((item) => item.id === "faces-wait")).toBe(false);
    expect(state.step).toBe("moments");
    expect(state.items.some((item) => item.id === "plan-wait")).toBe(true);
  });

  it("skips the keep/leave step when no blurry or duplicate photos were filtered", () => {
    const state = deriveChat({ ...base(), plan: { ...plan, leftOut: [] } });
    expect(state.step).toBe("direction");
    expect(state.items.some((item) => item.kind === "set-aside" || item.kind === "moments")).toBe(false);
    expect(state.items.at(-1)).toMatchObject({ kind: "typing", text: "Putting together a direction for your film" });
  });

  it("shows filtered photo groups without the old moment picker", () => {
    const state = deriveChat({ ...base(), plan: { ...plan, leftOut: [
      { shotId: "blur-1", thumbnailUrl: "https://thumb/blur-1.jpg", reason: "Blurry" },
      { shotId: "dup-1", thumbnailUrl: "https://thumb/dup-1.jpg", reason: "Near duplicate" },
    ] } });
    expect(state.step).toBe("moments");
    expect(state.items.filter((item) => item.kind === "set-aside" || item.kind === "moments")).toHaveLength(1);
    expect(state.items.find((item) => item.kind === "set-aside")).toMatchObject({
      blurry: 1, duplicates: 1,
      blurryPhotos: [{ shotId: "blur-1", uri: "https://thumb/blur-1.jpg" }],
      duplicatePhotos: [{ shotId: "dup-1", uri: "https://thumb/dup-1.jpg" }],
    });
  });

  it("derives all twelve saved-project states", () => {
    const cases: { name: string; input: ChatInput; step: ChatState["step"]; confirmed: number; kinds: string[] }[] = [
      { name: "fresh summary pending", input: { ...base(), summary: { ...summary, ready: { ...summary.ready, summary: false }, processed: { ...summary.processed, ingested: 3 } }, intent: null, people: null, peopleConfirmed: false, plan: null }, step: "occasion", confirmed: 0, kinds: ["typing"] },
      { name: "summary ready", input: { ...base(), intent: null, people: null, peopleConfirmed: false, plan: null }, step: "occasion", confirmed: 0, kinds: ["occasion"] },
      { name: "occasion confirmed, faces pending", input: { ...base(), people: null, peopleConfirmed: false, plan: null }, step: "people", confirmed: 1, kinds: ["you", "typing"] },
      { name: "first unnamed person", input: { ...base(), people: [0, 1, 2].map((n) => ({ personId: `p${n}`, name: null, role: null, skipped: false, momentCount: 3 - n, sampleShotIds: [], days: [] })), peopleConfirmed: false, plan: null }, step: "people", confirmed: 1, kinds: ["you", "person"] },
      { name: "third person after two named", input: { ...base(), people: [0, 1, 2].map((n) => ({ personId: `p${n}`, name: n < 2 ? `Person ${n}` : null, role: n < 2 ? "child" : null, skipped: false, momentCount: 3 - n, sampleShotIds: [], days: [] })), peopleConfirmed: false, plan: null }, step: "people", confirmed: 1, kinds: ["you", "you", "you", "person"] },
      { name: "all people named", input: { ...base(), people: [0, 1, 2].map((n) => ({ personId: `p${n}`, name: `Person ${n}`, role: "child", skipped: false, momentCount: 3 - n, sampleShotIds: [], days: [] })), peopleConfirmed: false, plan: null }, step: "people", confirmed: 1, kinds: ["you", "you", "you", "you", "anyone-else"] },
      { name: "top three by moment count then anyone else", input: { ...base(), people: [0, 1, 2, 3].map((n) => ({ personId: `p${n}`, name: n === 3 ? null : `Person ${n}`, role: "child", skipped: false, momentCount: [4, 40, 30, 1][n], sampleShotIds: [], days: [] })), peopleConfirmed: false, plan: null }, step: "people", confirmed: 1, kinds: ["you", "you", "you", "you", "anyone-else"] },
      { name: "skipped person counts as answered", input: { ...base(), people: [0, 1, 2].map((n) => ({ personId: `p${n}`, name: null, role: null, skipped: n === 0, momentCount: 3 - n, sampleShotIds: [], days: [] })), peopleConfirmed: false, plan: null }, step: "people", confirmed: 1, kinds: ["you", "you", "person"] },
      { name: "no people detected", input: { ...base(), people: [], peopleConfirmed: false, momentsConfirmed: false }, step: "direction", confirmed: 3, kinds: ["you", "typing"] },
      { name: "people confirmed and plan ready", input: { ...base(), people: [{ personId: "p1", name: "Mia", role: "child", skipped: false, momentCount: 3, sampleShotIds: [], days: [] }], peopleConfirmed: true }, step: "direction", confirmed: 3, kinds: ["you", "you", "typing"] },
      { name: "planning conflict", input: { ...base(), conflict: { shotIds: ["m1"], message: "This moment is both kept and left out." } }, step: "direction", confirmed: 3, kinds: ["you", "typing"] },
      { name: "direction options ready", input: { ...base(), momentsConfirmed: true, direction: { confirmed: false, pace: "gentle", lengthSec: 120, focus: "family" } }, step: "direction", confirmed: 3, kinds: ["you", "direction"] },
      { name: "direction confirmed and generation running", input: { ...base(), momentsConfirmed: true, direction: { confirmed: true, pace: "gentle", lengthSec: 120, focus: "family" }, generation: { status: "running", stage: "rendering", progress: 0.7, stepsDone: 2, film: null } }, step: "shaping", confirmed: 4, kinds: ["you", "you", "shaping"] },
      { name: "generation done", input: { ...base(), momentsConfirmed: true, direction: { confirmed: true, pace: "gentle", lengthSec: 120, focus: "family" }, generation: { status: "done", stage: "saved", progress: 1, stepsDone: 3, film } }, step: "ready", confirmed: 4, kinds: ["you", "you", "film"] },
    ];

    for (const row of cases) {
      const state = deriveChat(row.input);
      expect(state.step, row.name).toBe(row.step);
      expect(state.confirmed, row.name).toBe(row.confirmed);
      expect(kinds(state.items).filter((kind) => kind !== "mosae"), row.name).toEqual(row.kinds);
    }
  });

  it("opens with a counted question when there is no meaningful suggestion", () => {
    const state = deriveChat({ ...base(), summary: { ...summary, country: null, season: null, places: [] }, intent: null, people: null, peopleConfirmed: false, plan: null });
    expect(state.items[0]).toMatchObject({ kind: "mosae", text: "What were these 10 moments about?" });
  });

  it("acknowledges the story answer and confirms a mentioned relationship against the top face cluster", () => {
    const sampleFaces = [{ shotId: "face-a", uri: "https://faces.test/a", bbox: [0.1, 0.2, 0.4, 0.5] as [number, number, number, number] }];
    const state = deriveChat({ ...base(), intent: { text: "My son children day celebration" }, people: [
      { personId: "son", name: null, role: null, skipped: false, momentCount: 4, sampleShotIds: [], sampleFaces, days: [] },
      { personId: "other", name: null, role: null, skipped: false, momentCount: 2, sampleShotIds: [], days: [] },
    ], peopleConfirmed: false, plan: null });
    expect(state.items.find((item) => item.id === "story-acknowledgement")).toMatchObject({ kind: "mosae", text: "A Children's Day celebration for your son — lovely!" });
    expect(state.items.find((item) => item.kind === "person-confirm")).toMatchObject({ personId: "son", label: "My son", text: "Is this your son?", sampleFaces });
  });

  it("uses a warm question when the story answer does not mention a person", () => {
    const state = deriveChat({ ...base(), intent: { text: "A day at the beach" }, people: [{ personId: "p1", name: null, role: null, skipped: false, momentCount: 4, sampleShotIds: [], days: [] }], peopleConfirmed: false, plan: null });
    expect(state.items.find((item) => item.kind === "person")).toMatchObject({ personId: "p1", momentCount: 4, questionText: "Who's this? They're in 4 of your moments." });
  });

  it("uses a normalized interpret summary and named person when both are available", () => {
    const state = deriveChat({ ...base(), intent: { text: "Mia's Children's Day party" }, storySummary: "Children's Day celebration", mentionedPeople: ["Mia"], people: [{ personId: "p1", name: null, role: null, skipped: false, momentCount: 4, sampleShotIds: [], days: [] }], peopleConfirmed: false, plan: null });
    expect(state.items.find((item) => item.id === "story-acknowledgement")).toMatchObject({ text: "A Children's Day celebration for Mia — lovely!" });
    expect(state.items.find((item) => item.kind === "person-confirm")).toMatchObject({ text: "Is this Mia?", label: "Mia" });
  });

  it("uses the flow copy and surfaces summary progress", () => {
    const pending = deriveChat({ ...base(), summary: { ...summary, ready: { ...summary.ready, summary: false }, processed: { ...summary.processed, ingested: 3 } }, intent: null, people: null, peopleConfirmed: false, plan: null });
    expect(pending.items[0]).toMatchObject({ kind: "typing", text: "Reading your photos, 3 of 10" });
    const occasion = deriveChat({ ...base(), intent: null, people: null, peopleConfirmed: false, plan: null });
    expect(occasion.items[0]).toMatchObject({ kind: "mosae", text: "I've looked through all 10. It looks like a trip to Japan in late October: Tokyo, Kyoto. Is that the story?" });
    const singapore = deriveChat({ ...base(), summary: { ...summary, country: "Singapore", season: "early June", places: ["Telok Blangah", "Siloso Beach"] }, intent: null, people: null, peopleConfirmed: false, plan: null });
    expect(singapore.items[0]).toMatchObject({ kind: "mosae", text: "I've looked through all 10. It looks like a trip to Singapore in early June: Telok Blangah, Siloso Beach. Is that the story?" });
  });

  it("keeps answered AI questions immediately before their replies", () => {
    const state = deriveChat({ ...base(), people: [{ personId: "p1", name: "Mia", role: null, skipped: false, momentCount: 12, sampleShotIds: ["s1"], sampleFaces: [{ shotId: "s1", uri: "face.jpg", bbox: [0, 0, 1, 1] }], days: [] }], peopleConfirmed: true, momentsConfirmed: true, direction: { confirmed: true, pace: "gentle", lengthSec: 60, focus: "family" } });
    const items = state.items;
    expect(items.findIndex((item) => item.id === "occasion-message")).toBeLessThan(items.findIndex((item) => item.id === "occasion-answer"));
    expect(items.findIndex((item) => item.id === "person-question-p1")).toBeLessThan(items.findIndex((item) => item.id === "person-answer-p1"));
    expect(items.find((item) => item.id === "person-question-p1")).toMatchObject({ kind: "mosae", text: "Who's this? They're in 12 of your moments.", photos: ["face.jpg"] });
    expect(items.findIndex((item) => item.id === "direction-question")).toBeLessThan(items.findIndex((item) => item.id === "direction-answer"));
  });

  it("keeps merge follow-up questions, sample faces, and answers in the chat history", () => {
    const state = deriveChat({ ...base(), people: [
      { personId: "p1", name: "My daughter", role: "child", skipped: false, momentCount: 4, sampleShotIds: [], sampleFaces: [{ shotId: "s1", uri: "face-1", bbox: [0, 0, 1, 1] }], days: [] },
      { personId: "p2", name: "My daughter", role: "child", skipped: false, momentCount: 3, sampleShotIds: [], sampleFaces: [{ shotId: "s2", uri: "face-2", bbox: [0, 0, 1, 1] }], days: [] },
    ], peopleConfirmed: false, plan: null, mergeEvents: [{ id: "merge-p2", personId: "p2", targetPersonId: "p1", answer: "My daughter", targetName: "My daughter", sampleFaces: ["face-1"], momentCount: 3, response: "Yes, same person" }] });
    expect(state.items.find((item) => item.kind === "merge-followup")).toMatchObject({ text: "Same daughter as before?", photos: ["face-1"], answer: "My daughter", response: "Yes, same person" });
    expect(state.items.findIndex((item) => item.id === "merge-p2")).toBeGreaterThan(state.items.findIndex((item) => item.id === "person-answer-p2"));
  });

  it("retains the answered merge exchange after its source person is merged out of the refreshed cast", () => {
    const state = deriveChat({ ...base(), people: [{ personId: "p1", name: "My daughter", role: "child", skipped: false, momentCount: 7, sampleShotIds: [], days: [] }], peopleConfirmed: false, plan: null, mergeEvents: [{ id: "merge-p2", personId: "p2", targetPersonId: "p1", answer: "My daughter", targetName: "My daughter", sampleFaces: ["face-1"], momentCount: 3, response: "Yes, same person" }] });
    expect(state.items).toContainEqual({ kind: "you", id: "person-answer-p2", text: "My daughter" });
    expect(state.items.find((item) => item.id === "merge-p2")).toMatchObject({ response: "Yes, same person" });
  });

  it("asks the three people with the most moments, then offers anyone else", () => {
    const people = [
      { personId: "p0", name: "Four", role: "child", skipped: false, momentCount: 4, sampleShotIds: [], days: [] },
      { personId: "p1", name: "Most", role: "child", skipped: false, momentCount: 40, sampleShotIds: [], days: [] },
      { personId: "p2", name: "Second", role: "child", skipped: false, momentCount: 30, sampleShotIds: [], days: [] },
      { personId: "p3", name: null, role: null, skipped: false, momentCount: 1, sampleShotIds: [], days: [] },
    ];
    const state = deriveChat({ ...base(), people, peopleConfirmed: false, plan: null });
    expect(state.items.filter((item) => item.kind !== "mosae").map((item) => item.kind === "you" ? item.text : item.kind === "anyone-else" ? "anyone-else" : item.kind)).toEqual(["Our Japan trip", "Most", "Second", "Four", "anyone-else"]);
  });

  it("records Skip as a reply and asks the next person", () => {
    const people = [
      { personId: "p0", name: null, role: null, skipped: true, momentCount: 30, sampleShotIds: [], days: [] },
      { personId: "p1", name: null, role: null, skipped: false, momentCount: 20, sampleShotIds: [], days: [] },
    ];
    const state = deriveChat({ ...base(), people, peopleConfirmed: false, plan: null });
    expect(state.items.find((item) => item.kind === "you" && item.text === "Skip")).toMatchObject({ kind: "you", text: "Skip" });
    expect(state.items.find((item) => item.kind === "person")).toMatchObject({ kind: "person", personId: "p1" });
  });

  it("carries the person's face previews and bounding boxes to the question item", () => {
    const sampleFaces = [{ shotId: "s1", uri: "https://thumb.test/s1", bbox: [0.1, 0.2, 0.4, 0.5] as [number, number, number, number] }];
    const state = deriveChat({ ...base(), people: [{ personId: "p1", name: null, role: null, skipped: false, momentCount: 12, sampleShotIds: ["s1"], sampleFaces } as any], peopleConfirmed: false, plan: null });
    expect(state.items.find((item) => item.kind === "person")).toMatchObject({ kind: "person", sampleFaces });
  });

  it("shows a person's saved answer without inferring a relationship from role", () => {
    const state = deriveChat({ ...base(), people: [{ personId: "p0", name: "Family", role: "child", skipped: false, momentCount: 30, sampleShotIds: [], days: [] }], peopleConfirmed: true });
    expect(state.items.find((item) => item.kind === "you" && item.id === "person-answer-p0")).toMatchObject({ text: "Family" });
  });

  it("summarizes all selected direction settings in one user reply", () => {
    const state = deriveChat({
      ...base(),
      people: [{ personId: "p1", name: "Mia", role: "child", skipped: false, momentCount: 3, sampleShotIds: [], days: [] }],
      momentsConfirmed: true,
      direction: { confirmed: true, pace: "lively", lengthSec: 30, focus: "family", collageAmount: "few", motionFeel: "calm" },
    });
    expect(state.items.filter((item) => item.kind === "you" && item.id === "direction-answer")).toEqual([
      { kind: "you", id: "direction-answer", text: "Pace: Lively\nLength: 30 sec\nFocus: Everyone\nCollages: A few\nMotion: Calm" },
    ]);
  });

  it("only shows settings rows present on the direction card", () => {
    const state = deriveChat({ ...base(), momentsConfirmed: true, direction: { confirmed: true, pace: "gentle", lengthSec: 60, focus: "family" } });
    expect(state.items.find((item) => item.kind === "you" && item.id === "direction-answer")).toMatchObject({
      text: "Pace: Gentle\nLength: 60 sec\nFocus: The moments",
    });
  });

  it("includes newly added direction fields in the saved answer", () => {
    const state = deriveChat({ ...base(), momentsConfirmed: true, direction: {
      confirmed: true, pace: "gentle", lengthSec: 60, focus: "family", visualStyle: "film grain",
    } as ChatInput["direction"] });
    expect(state.items.find((item) => item.kind === "you" && item.id === "direction-answer")).toMatchObject({
      text: "Pace: Gentle\nLength: 60 sec\nFocus: The moments\nVisual Style: Film grain",
    });
  });

  it("does not invent an answer from an automatically assigned parent role", () => {
    const state = deriveChat({ ...base(), people: [{ personId: "p0", name: null, role: "parent", skipped: false, momentCount: 30, sampleShotIds: [], days: [] }], peopleConfirmed: true });
    expect(state.items.some((item) => item.kind === "you" && item.id === "person-answer-p0")).toBe(false);
  });

  it("keeps skipped people represented by the Skip chip", () => {
    const state = deriveChat({ ...base(), people: [{ personId: "p0", name: "Family", role: "parent", skipped: true, momentCount: 30, sampleShotIds: [], days: [] }], peopleConfirmed: true });
    expect(state.items.find((item) => item.kind === "you" && item.id === "person-answer-p0")).toMatchObject({ text: "Skip" });
  });

  it("asks names when people have detected roles but no user supplied names", () => {
    const people = ["child", "parent", "parent"].map((role, index) => ({ personId: `p${index}`, name: null, role, skipped: false, momentCount: 30 - index, sampleShotIds: [], days: [] }));
    const state = deriveChat({ ...base(), people, peopleConfirmed: false, plan: null });
    expect(state.items.filter((item) => item.kind !== "mosae").map((item) => item.kind)).toEqual(["you", "person"]);
    expect(state.items.at(-1)).toMatchObject({ kind: "person", personId: "p0" });
  });

  it("shows the faces waiting copy and defaults placeholders", () => {
    const state = deriveChat({ ...base(), people: null, peopleConfirmed: false, plan: null });
    expect(state.items.at(-1)).toMatchObject({ kind: "typing", text: "Finding the faces in your trip" });
    expect(state.placeholder).toBe("Tell me anything about the story");
  });

  it("includes up to four actual thumbnails and a remaining count in each filtered photo group", () => {
    const leftOut = Array.from({ length: 6 }, (_, index) => ({ shotId: `blur-${index}`, thumbnailUrl: `https://thumb/${index}`, reason: "Blurry" }));
    const summary = deriveChat({ ...base(), plan: { ...plan, leftOut } }).items.find((item) => item.kind === "set-aside");
    expect(summary).toMatchObject({ kind: "set-aside", blurry: 6, blurryMore: 2, blurryPhotos: leftOut.slice(0, 4).map(({ shotId, thumbnailUrl }) => ({ shotId, uri: thumbnailUrl })) });
  });

  it("names a conflict on the moments step", () => {
    const state = deriveChat({ ...base(), conflict: { shotIds: ["m1"], message: "This moment is both kept and left out." } });
    expect(state.items.find((item) => item.id === "moments-conflict")).toMatchObject({ text: "This moment is both kept and left out." });
  });

  it("shows film-ready copy and default placeholder", () => {
    const state = deriveChat({ ...base(), momentsConfirmed: true, direction: { confirmed: true, pace: "gentle", lengthSec: 120, focus: "family" }, generation: { status: "done", stage: "saved", progress: 1, stepsDone: 3, film } });
    expect(state.placeholder).toBe("Ask for a change");
  });
});

describe("contextual direction copy", () => {
  it.each([undefined, "For these portraits, I’d suggest a gentle pace.", "For this celebration, I’d suggest a lively rhythm."])("renders the recommendation once with neutral legacy fallback", (copy) => {
    const state = deriveChat({ ...base(), momentsConfirmed: true, directionNote: copy, direction: { confirmed: false, pace: "gentle", lengthSec: 120, focus: "family" } });
    const questions = state.items.filter(item => item.id === "direction-question");
    expect(questions).toHaveLength(1);
    expect(questions[0]).toMatchObject({ text: copy ?? "For these moments, I’d suggest this." });
  });
});
