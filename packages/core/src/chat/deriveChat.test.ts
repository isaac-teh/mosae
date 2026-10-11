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
  it("renders each mid-flow question with its own reply and only the latest pending turn as thinking", () => {
    const state = deriveChat({
      ...base(), intent: null,
      summary: { ...summary, ready: { ...summary.ready, summary: false } },
      interpTurns: [
        { question: "What are you looking for?", reply: "I'm finding the people in your photos." },
        { question: "How long will it take?" },
      ],
      interpReplying: true,
    });
    expect(state.items.filter((item) => item.id.startsWith("interp-")).map((item) => ({ kind: item.kind, id: item.id, text: "text" in item ? item.text : undefined }))).toEqual([
      { kind: "you", id: "interp-question-1", text: "What are you looking for?" },
      { kind: "mosae", id: "interp-reply-1", text: "I'm finding the people in your photos." },
      { kind: "you", id: "interp-question-2", text: "How long will it take?" },
      { kind: "typing", id: "interp-typing", text: "Thinking" },
    ]);
  });

  it("offers missed-person tagging after the existing face questions finish", () => {
    const state = deriveChat({ ...base(), people: [{ personId: "p1", name: "Mia", role: "child", skipped: false, momentCount: 3, sampleShotIds: [], days: [] }], peopleConfirmed: false, plan: null });
    expect(state.placeholder).toBe("Type a name");
    expect(state.items.some((item) => item.kind === "anyone-else")).toBe(true);
    const tagging = deriveChat({ ...base(), people: [{ personId: "p1", name: "Mia", role: "child", skipped: false, momentCount: 3, sampleShotIds: [], days: [] }], peopleConfirmed: false, plan: null, missedPeople: [{ personId: "p-missed-1", name: "Grandma", momentCount: 1 }], missedPersonTagging: { personId: "p-missed-2", name: "Uncle Tan" } });
    expect(tagging.items.find((item) => item.kind === "mosae" && item.id === "missed-select-p-missed-2")).toMatchObject({ text: "Help me select 1 photo of Uncle Tan." });
  });

  it("summarizes the named cast and moment counts before continuing", () => {
    const state = deriveChat({ ...base(), peopleConfirmed: true, peopleSummaryConfirmed: false, people: [
      { personId: "p1", name: "Mia", role: "child", skipped: false, momentCount: 3, sampleShotIds: [], days: [] },
      { personId: "p2", name: null, role: "other", skipped: true, momentCount: 2, sampleShotIds: [], days: [] },
    ] });
    expect(state.items.find((item) => item.id === "people-summary-message")).toMatchObject({ text: "Thanks. I've tagged Mia in your moments." });
    expect(state.items.find((item) => item.kind === "people-summary")).toMatchObject({ people: [{ personId: "p1", name: "Mia", momentCount: 3 }] });
  });
  it("asks the story question while uploads are pending and preserves an early answer", () => {
    const early = deriveChat({ ...base(), summary: { ...summary, total: 4, photos: 3, clips: 1, processed: { ingested: 1, understood: 0, faces: 0 }, ready: { summary: false, faces: false, plan: false } }, intent: null, earlyOccasionAnswer: "A birthday celebration" });
    expect(early.items.find(item => item.kind === "upload-status")).toMatchObject({ photos: 3, clips: 1, uploadTotal: 4, uploadDone: 1, understood: 0 });
    expect(early.items.find(item => item.id === "upload-intro")).toMatchObject({ text: "I'm bringing in your 4 photos and clips. Then I'll look through them." });
    expect(early.items.find(item => item.id === "occasion-answer")).toMatchObject({ kind: "you", text: "A birthday celebration" });
    expect(early.items.find(item => item.id === "story-acknowledgement")).toMatchObject({ kind: "mosae", text: "A birthday celebration — lovely! I'm still bringing in your photos and clips — hang on a moment." });
  });

  it("uses server upload and understanding counts for a reopened project", () => {
    const reopened = deriveChat({ ...base(), intent: null, summary: { ...summary, total: 1, photos: 0, clips: 1, upload: { expected: 1, settled: 1, failed: 0, cancelled: 0, closed: true }, processed: { ingested: 1, understood: 0, faces: 0 }, ready: { summary: true, faces: false, plan: false } } });
    expect(reopened.items.find(item => item.kind === "upload-status")).toMatchObject({ clips: 1, uploadDone: 1, uploadComplete: true, understood: 0, understoodTotal: 1, understoodComplete: false });
    expect(reopened.items.find(item => item.kind === "occasion-question")).toBeTruthy();
  });

  it("counts finalized processing failures as uploaded transfers without reporting transfer failure", () => {
    const processedFailure = deriveChat({ ...base(), intent: null, summary: { ...summary, total: 1, photos: 1, clips: 0, upload: { expected: 1, settled: 1, uploaded: 1, failed: 0, processingFailed: 1, cancelled: 0, closed: true }, processed: { ingested: 1, understood: 0, faces: 0 }, ready: { summary: true, faces: false, plan: false } } });
    expect(processedFailure.items.find(item => item.kind === "upload-status")).toMatchObject({ uploadDone: 1, uploadFailed: 0, uploadTotal: 1, uploadComplete: true, understoodComplete: true });
    expect(processedFailure.items.find(item => item.id === "upload-intro")).toMatchObject({ text: "Your 1 photo is uploaded." });
  });

  it("keeps failed files out of uploaded progress while showing the failed count", () => {
    const state = deriveChat({ ...base(), intent: null, localUpload: { total: 16, settled: 11, failed: 5, photos: 16, clips: 0 } });
    expect(state.items.find(item => item.kind === "upload-status")).toMatchObject({ uploadDone: 11, uploadFailed: 5, uploadTotal: 16 });
    expect(state.items.find(item => item.id === "upload-intro")).toMatchObject({ text: "I uploaded 11 of your 16 photos; 5 couldn't upload." });
  });

  it("switches the intro and occasion prompt to their uploaded wording when transfer is complete", () => {
    const complete = deriveChat({ ...base(), intent: null, summary: { ...summary, total: 1, photos: 1, clips: 0, upload: { expected: 1, settled: 1, failed: 0, cancelled: 0, closed: true }, processed: { ingested: 1, understood: 1, faces: 0 }, ready: { summary: true, faces: false, plan: false } } });
    expect(complete.items.find(item => item.id === "upload-intro")).toMatchObject({ text: "Your 1 photo is uploaded." });
    expect(complete.items.find(item => item.kind === "upload-status")).toMatchObject({ uploadComplete: true, understoodComplete: true });
    expect(complete.items.find(item => item.kind === "occasion-question")).toMatchObject({ uploadComplete: true });
  });

  it("does not complete look-through from a partial server summary while the local upload continues", () => {
    const partial = deriveChat({ ...base(), localUpload: { total: 16, settled: 12, failed: 0, photos: 16, clips: 0 }, summary: { ...summary, total: 12, photos: 12, processed: { ingested: 12, understood: 12, faces: 0 }, ready: { summary: true, faces: false, plan: false } } });
    expect(partial.items.find(item => item.kind === "upload-status")).toMatchObject({ uploadDone: 12, uploadTotal: 16, uploadComplete: false, understood: 12, understoodTotal: 16, understoodComplete: false, facesApplicable: true, facesComplete: false });
  });

  it("shows face progress after look-through and skips the face step for videos only", () => {
    const facePending = deriveChat({ ...base(), summary: { ...summary, ready: { ...summary.ready, faces: false } } });
    expect(facePending.items.find(item => item.kind === "upload-status")).toMatchObject({ understoodComplete: true, facesApplicable: true, facesComplete: false });
    const videos = deriveChat({ ...base(), summary: { ...summary, photos: 0, clips: 10, ready: { ...summary.ready, faces: false } } });
    expect(videos.items.find(item => item.kind === "upload-status")).toMatchObject({ facesApplicable: false, facesComplete: false });
  });

  it("never marks face finding complete before all uploaded items have been looked through", () => {
    const state = deriveChat({
      ...base(), intent: null, earlyOccasionAnswer: "A trip",
      localUpload: { total: 16, settled: 15, failed: 0, photos: 16, clips: 0 },
      summary: { ...summary, total: 15, processed: { ingested: 15, understood: 3, faces: 15 }, ready: { summary: true, faces: true, plan: false } },
    });
    expect(state.items.find(item => item.kind === "upload-status")).toMatchObject({
      uploadComplete: false, understoodComplete: false, facesApplicable: true, facesComplete: false,
    });
  });

  it("replies once to each early note with deterministic live preparation status", () => {
    const state = deriveChat({
      ...base(), intent: null, earlyOccasionAnswer: "A trip", notes: ["Still in progress?", "Remember the picnic"],
      localUpload: { total: 16, settled: 15, failed: 0, photos: 16, clips: 0 },
      summary: { ...summary, total: 15, processed: { ingested: 15, understood: 3, faces: 0 }, ready: { summary: false, faces: false, plan: false } },
    });
    expect(state.items.filter(item => item.kind === "you" && item.id.startsWith("note-")).length).toBe(2);
    expect(state.items.filter(item => item.kind === "mosae" && item.id.startsWith("note-reply-")).map(item => item.kind === "mosae" ? item.text : "")).toEqual([
      "Still working on it — 15 of 16 uploaded and 3 of 16 looked through. I'll ask you about the people next.",
      "Got it, I'll keep that in mind for the film. 15 of 16 uploaded and 3 of 16 looked through.",
    ]);
  });

  it("updates the early answer acknowledgement with the current preparation step", () => {
    const uploading = deriveChat({ ...base(), intent: null, earlyOccasionAnswer: "A trip", localUpload: { total: 16, settled: 12, failed: 0, photos: 16, clips: 0 }, summary: { ...summary, total: 12, photos: 12, processed: { ingested: 12, understood: 12, faces: 0 }, ready: { summary: true, faces: false, plan: false } } });
    expect(uploading.items.find(item => item.id === "story-acknowledgement")).toMatchObject({ text: "A trip — lovely! I'm still bringing in your photos — hang on a moment." });
    const lookingThrough = deriveChat({ ...base(), intent: null, earlyOccasionAnswer: "A trip", summary: { ...summary, processed: { ...summary.processed, understood: 4 }, ready: { ...summary.ready, faces: false } } });
    expect(lookingThrough.items.find(item => item.id === "story-acknowledgement")).toMatchObject({ text: "A trip — lovely! I'm looking through them now — almost there." });
    const looking = deriveChat({ ...base(), intent: null, earlyOccasionAnswer: "A trip", summary: { ...summary, ready: { ...summary.ready, faces: false } } });
    expect(looking.items.find(item => item.id === "story-acknowledgement")).toMatchObject({ text: "A trip — lovely! Now I'm finding the people in them." });
  });

  it("keeps the occasion question wording the user saw before answering", () => {
    const historical = deriveChat({ ...base(), intent: null, earlyOccasionQuestionUploadComplete: false, localUpload: { total: 4, settled: 4, failed: 0, photos: 4, clips: 0 } });
    expect(historical.items.find(item => item.id === "occasion-question")).toMatchObject({ uploadComplete: false });
    const afterAnswer = deriveChat({ ...base(), earlyOccasionQuestionUploadComplete: false, localUpload: { total: 4, settled: 4, failed: 0, photos: 4, clips: 0 } });
    expect(afterAnswer.items.find(item => item.id === "occasion-message")).toMatchObject({ text: "While they come in, tell me a little about them. Is it a trip, a birthday celebration, or something else?" });
  });

  it("gates occasion on local transfer, server story readiness and acknowledged failures", () => {
    const input = { ...base(), intent: null };
    for (const pending of [
      { ...input, localMediaPending: true },
      { ...input, summary: { ...summary, ready: { ...summary.ready, story: false } } },
      { ...input, summary: { ...summary, processed: { ...summary.processed, understood: 0 } } },
      { ...input, summary: { ...summary, upload: { expected: 11, settled: 11, failed: 1, cancelled: 0, closed: true } } },
    ]) expect(deriveChat(pending).items.some(item => item.kind === "occasion-question")).toBe(true);
  });

  it("derives a compact upload status card without per-asset status", () => {
    const pending = deriveChat({ ...base(), summary: { ...summary, ready: { ...summary.ready, summary: false }, assetStatuses: [
      { assetId: "a1", kind: "photo", status: "understood" },
      { assetId: "a2", kind: "photo", status: "ingested" },
      { assetId: "a3", kind: "video", status: "uploaded" },
    ] } });
    expect(pending.items.find(item => item.kind === "upload-status")).toMatchObject({ uploadTotal: 10, uploadDone: 10, understood: 10 });
    expect(pending.items.some(item => item.kind === "typing" && item.id === "summary-wait")).toBe(false);
  });

  it("shows video preparation progress without requesting more input", () => {
    const state = deriveChat({ ...base(), filmWait: { elapsedSec: 4, videoCount: 2 }, summary: { ...summary, videoStatuses: [
      { assetId: "v1", status: "ready", progress: 1 }, { assetId: "v2", status: "processing", progress: 0.5 },
    ] } });
    expect(state.items.slice(-1)).toEqual([{ kind: "preparing-videos", id: "preparing-videos", text: "Preparing 2 videos…", progress: 0.75 }]);
    expect(state.items.find(item => item.kind === "upload-status")).toMatchObject({ uploadComplete: true, understoodComplete: true });
  });

  it("shows failed videos as unreadable chat notes", () => {
    const state = deriveChat({ ...base(), summary: { ...summary, videoStatuses: [{ assetId: "v1", status: "failed", progress: 1 }] } });
    expect(state.items).toContainEqual({ kind: "mosae", id: "video-failed-v1", text: "Couldn't read this video" });
  });

  it("waits for the first photos instead of claiming there are zero", () => {
    const pending = deriveChat({ ...base(), summary: { ...summary, total: 0, photos: 0, clips: 0, ready: { ...summary.ready, summary: false } }, intent: null, people: null, peopleConfirmed: false, plan: null });
    expect(pending.items.find(item => item.kind === "upload-status")).toMatchObject({ uploadTotal: 0 });
  });

  it("keeps the photo reading grid through asset understanding after ingest completes", () => {
    const pending = deriveChat({ ...base(), summary: { ...summary, ready: { ...summary.ready, faces: false }, assetStatuses: [
      { assetId: "a1", kind: "photo", status: "understood" },
      { assetId: "a2", kind: "photo", status: "ingested" },
    ] } });
    expect(pending.items.find(item => item.kind === "upload-status")).toMatchObject({ understood: 10 });
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
      { name: "fresh summary pending", input: { ...base(), summary: { ...summary, ready: { ...summary.ready, summary: false }, processed: { ...summary.processed, ingested: 3 } }, intent: null, people: null, peopleConfirmed: false, plan: null }, step: "occasion", confirmed: 0, kinds: [] },
      { name: "summary ready", input: { ...base(), intent: null, people: null, peopleConfirmed: false, plan: null }, step: "occasion", confirmed: 0, kinds: [] },
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
      expect(kinds(state.items).filter((kind) => kind !== "mosae" && kind !== "upload-status" && kind !== "occasion-question"), row.name).toEqual(row.kinds);
    }
  });

  it("opens with a counted question when there is no meaningful suggestion", () => {
    const state = deriveChat({ ...base(), summary: { ...summary, country: null, season: null, places: [] }, intent: null, people: null, peopleConfirmed: false, plan: null });
    expect(state.items.find(item => item.kind === "occasion-question")).toBeTruthy();
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
    expect(pending.items.find(item => item.kind === "upload-status")).toMatchObject({ uploadDone: 3, uploadTotal: 10 });
    const occasion = deriveChat({ ...base(), intent: null, people: null, peopleConfirmed: false, plan: null });
    expect(occasion.items.find(item => item.kind === "occasion-question")).toBeTruthy();
    const singapore = deriveChat({ ...base(), summary: { ...summary, country: "Singapore", season: "early June", places: ["Telok Blangah", "Siloso Beach"] }, intent: null, people: null, peopleConfirmed: false, plan: null });
    expect(singapore.items.find(item => item.kind === "occasion-question")).toBeTruthy();
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
    expect(state.items.filter((item) => item.kind !== "mosae" && item.kind !== "upload-status").map((item) => item.kind === "you" ? item.text : item.kind === "anyone-else" ? "anyone-else" : item.kind)).toEqual(["Our Japan trip", "Most", "Second", "Four", "anyone-else"]);
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
      direction: { confirmed: true, aspect: "16:9", pace: "lively", lengthSec: 30, focus: "family", collageAmount: "few", motionFeel: "calm" },
    });
    expect(state.items.filter((item) => item.kind === "you" && item.id === "direction-answer")).toEqual([
      { kind: "you", id: "direction-answer", text: "Format: YouTube style\nPace: Lively\nLength: 30 sec\nFocus: Everyone\nCollages: A few\nMotion: Calm" },
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
    expect(state.items.filter((item) => item.kind !== "mosae" && item.kind !== "upload-status").map((item) => item.kind)).toEqual(["you", "person"]);
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
  it.each([
    [{ assetId: "a1", shotId: "s1", label: "beach", status: "added" as const, sourceInSec: 1, sourceOutSec: 4, afterClipId: "p1", previousOps: [] }, "Added your beach video 🎬"],
    [{ assetId: "a2", shotId: "s2", label: "cake", status: "offered" as const, sourceInSec: 1, sourceOutSec: 4, afterClipId: null }, "Add your cake video?"],
  ])("shows late-video chat copy %s", (event, text) => {
    const state = deriveChat({ ...base(), momentsConfirmed: true, direction: { confirmed: true, pace: "gentle", lengthSec: 120, focus: "family" }, generation: { status: "done", stage: "playable", progress: 1, stepsDone: 3, film: { ...film, lateVideoEvents: [event] } } });
    expect(state.items.find((item) => item.kind === "late-video")).toMatchObject({ kind: "late-video", text });
  });
});

describe("contextual direction copy", () => {
  it.each<[ProjectSummary["orientation"], "9:16" | "16:9"]>([
    [{ portrait: 8, landscape: 2, square: 0, suggested: "9:16" }, "9:16"],
    [{ portrait: 2, landscape: 8, square: 0, suggested: "16:9" }, "16:9"],
    [{ portrait: 5, landscape: 5, square: 0, suggested: null }, "9:16"],
  ])("keeps the suggested aspect in direction data for %j", (orientation, aspect) => {
    const state = deriveChat({ ...base(), summary: { ...summary, orientation }, momentsConfirmed: true, direction: { confirmed: false, pace: "gentle", lengthSec: 120, focus: "family", aspect } });
    expect(state.items.find((item) => item.kind === "direction")).toMatchObject({ aspect, orientation });
  });
  it.each([undefined, "For these portraits, I’d suggest a gentle pace.", "For this celebration, I’d suggest a lively rhythm."])("renders the recommendation once with neutral legacy fallback", (copy) => {
    const state = deriveChat({ ...base(), momentsConfirmed: true, directionNote: copy, direction: { confirmed: false, pace: "gentle", lengthSec: 120, focus: "family" } });
    const questions = state.items.filter(item => item.id === "direction-question");
    expect(questions).toHaveLength(1);
    expect(questions[0]).toMatchObject({ text: copy ?? "For these moments, I’d suggest this." });
  });
});
