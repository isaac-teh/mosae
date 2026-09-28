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
  it("derives all twelve saved-project states", () => {
    const cases: { name: string; input: ChatInput; step: ChatState["step"]; confirmed: number; kinds: string[] }[] = [
      { name: "fresh summary pending", input: { ...base(), summary: { ...summary, ready: { ...summary.ready, summary: false }, processed: { ...summary.processed, ingested: 3 } }, intent: null, people: null, peopleConfirmed: false, plan: null }, step: "occasion", confirmed: 0, kinds: ["typing"] },
      { name: "summary ready", input: { ...base(), intent: null, people: null, peopleConfirmed: false, plan: null }, step: "occasion", confirmed: 0, kinds: ["mosae", "occasion"] },
      { name: "occasion confirmed, faces pending", input: { ...base(), people: null, peopleConfirmed: false, plan: null }, step: "people", confirmed: 1, kinds: ["you", "typing"] },
      { name: "first unnamed person", input: { ...base(), people: [0, 1, 2].map((n) => ({ personId: `p${n}`, name: null, role: null, skipped: false, momentCount: 3 - n, sampleShotIds: [], days: [] })), peopleConfirmed: false, plan: null }, step: "people", confirmed: 1, kinds: ["you", "person"] },
      { name: "third person after two named", input: { ...base(), people: [0, 1, 2].map((n) => ({ personId: `p${n}`, name: n < 2 ? `Person ${n}` : null, role: n < 2 ? "child" : null, skipped: false, momentCount: 3 - n, sampleShotIds: [], days: [] })), peopleConfirmed: false, plan: null }, step: "people", confirmed: 1, kinds: ["you", "you", "you", "person"] },
      { name: "all people named", input: { ...base(), people: [0, 1, 2].map((n) => ({ personId: `p${n}`, name: `Person ${n}`, role: "child", skipped: false, momentCount: 3 - n, sampleShotIds: [], days: [] })), peopleConfirmed: false, plan: null }, step: "people", confirmed: 1, kinds: ["you", "you", "you", "you", "anyone-else"] },
      { name: "top three by moment count then anyone else", input: { ...base(), people: [0, 1, 2, 3].map((n) => ({ personId: `p${n}`, name: n === 3 ? null : `Person ${n}`, role: "child", skipped: false, momentCount: [4, 40, 30, 1][n], sampleShotIds: [], days: [] })), peopleConfirmed: false, plan: null }, step: "people", confirmed: 1, kinds: ["you", "you", "you", "you", "anyone-else"] },
      { name: "skipped person counts as answered", input: { ...base(), people: [0, 1, 2].map((n) => ({ personId: `p${n}`, name: null, role: null, skipped: n === 0, momentCount: 3 - n, sampleShotIds: [], days: [] })), peopleConfirmed: false, plan: null }, step: "people", confirmed: 1, kinds: ["you", "you", "person"] },
      { name: "no people detected", input: { ...base(), people: [], peopleConfirmed: false, momentsConfirmed: false }, step: "moments", confirmed: 2, kinds: ["you", "set-aside", "moments"] },
      { name: "people confirmed and plan ready", input: { ...base(), people: [{ personId: "p1", name: "Mia", role: "child", skipped: false, momentCount: 3, sampleShotIds: [], days: [] }], peopleConfirmed: true }, step: "moments", confirmed: 2, kinds: ["you", "you", "set-aside", "moments"] },
      { name: "planning conflict", input: { ...base(), conflict: { shotIds: ["m1"], message: "This moment is both kept and left out." } }, step: "moments", confirmed: 2, kinds: ["you", "mosae", "set-aside", "moments"] },
      { name: "moments confirmed", input: { ...base(), momentsConfirmed: true, direction: { confirmed: false, pace: "gentle", lengthSec: 120, focus: "family" } }, step: "direction", confirmed: 3, kinds: ["you", "set-aside", "moments", "you", "direction"] },
      { name: "direction confirmed and generation running", input: { ...base(), momentsConfirmed: true, direction: { confirmed: true, pace: "gentle", lengthSec: 120, focus: "family" }, generation: { status: "running", stepsDone: 2, film: null } }, step: "shaping", confirmed: 4, kinds: ["you", "set-aside", "moments", "you", "you", "shaping"] },
      { name: "generation done", input: { ...base(), momentsConfirmed: true, direction: { confirmed: true, pace: "gentle", lengthSec: 120, focus: "family" }, generation: { status: "done", stepsDone: 3, film } }, step: "ready", confirmed: 4, kinds: ["you", "set-aside", "moments", "you", "you", "film"] },
    ];

    for (const row of cases) {
      const state = deriveChat(row.input);
      expect(state.step, row.name).toBe(row.step);
      expect(state.confirmed, row.name).toBe(row.confirmed);
      expect(kinds(state.items), row.name).toEqual(row.kinds);
    }
  });

  it("uses the flow copy and surfaces summary progress", () => {
    const pending = deriveChat({ ...base(), summary: { ...summary, ready: { ...summary.ready, summary: false }, processed: { ...summary.processed, ingested: 3 } }, intent: null, people: null, peopleConfirmed: false, plan: null });
    expect(pending.items[0]).toMatchObject({ kind: "typing", text: "Reading your photos, 3 of 10" });
    const occasion = deriveChat({ ...base(), intent: null, people: null, peopleConfirmed: false, plan: null });
    expect(occasion.items[0]).toMatchObject({ kind: "mosae", text: "I've looked through all 10. It looks like a trip to Japan in late October: Tokyo, Kyoto. Is that the story?" });
    const singapore = deriveChat({ ...base(), summary: { ...summary, country: "Singapore", season: "early June", places: ["Telok Blangah", "Siloso Beach"] }, intent: null, people: null, peopleConfirmed: false, plan: null });
    expect(singapore.items[0]).toMatchObject({ kind: "mosae", text: "I've looked through all 10. It looks like a trip to Singapore in early June: Telok Blangah, Siloso Beach. Is that the story?" });
  });

  it("asks the three people with the most moments, then offers anyone else", () => {
    const people = [
      { personId: "p0", name: "Four", role: "child", skipped: false, momentCount: 4, sampleShotIds: [], days: [] },
      { personId: "p1", name: "Most", role: "child", skipped: false, momentCount: 40, sampleShotIds: [], days: [] },
      { personId: "p2", name: "Second", role: "child", skipped: false, momentCount: 30, sampleShotIds: [], days: [] },
      { personId: "p3", name: null, role: null, skipped: false, momentCount: 1, sampleShotIds: [], days: [] },
    ];
    const state = deriveChat({ ...base(), people, peopleConfirmed: false, plan: null });
    expect(state.items.map((item) => item.kind === "you" ? item.text : item.kind === "anyone-else" ? "anyone-else" : item.kind)).toEqual(["Our Japan trip", "Most", "Second", "Four", "anyone-else"]);
  });

  it("records Skip as a reply and asks the next person", () => {
    const people = [
      { personId: "p0", name: null, role: null, skipped: true, momentCount: 30, sampleShotIds: [], days: [] },
      { personId: "p1", name: null, role: null, skipped: false, momentCount: 20, sampleShotIds: [], days: [] },
    ];
    const state = deriveChat({ ...base(), people, peopleConfirmed: false, plan: null });
    expect(state.items[1]).toMatchObject({ kind: "you", text: "Skip" });
    expect(state.items[2]).toMatchObject({ kind: "person", personId: "p1" });
  });

  it("carries the person's face previews and bounding boxes to the question item", () => {
    const sampleFaces = [{ shotId: "s1", uri: "https://thumb.test/s1", bbox: [0.1, 0.2, 0.4, 0.5] as [number, number, number, number] }];
    const state = deriveChat({ ...base(), people: [{ personId: "p1", name: null, role: null, skipped: false, momentCount: 12, sampleShotIds: ["s1"], sampleFaces } as any], peopleConfirmed: false, plan: null });
    expect(state.items.find((item) => item.kind === "person")).toMatchObject({ kind: "person", sampleFaces });
  });

  it("uses the person chip label instead of a generic family label", () => {
    const state = deriveChat({ ...base(), people: [{ personId: "p0", name: "Family", role: "child", skipped: false, momentCount: 30, sampleShotIds: [], days: [] }], peopleConfirmed: true });
    expect(state.items.find((item) => item.kind === "you" && item.id === "person-answer-p0")).toMatchObject({ text: "My daughter" });
  });

  it("keeps skipped people represented by the Skip chip", () => {
    const state = deriveChat({ ...base(), people: [{ personId: "p0", name: "Family", role: "parent", skipped: true, momentCount: 30, sampleShotIds: [], days: [] }], peopleConfirmed: true });
    expect(state.items.find((item) => item.kind === "you" && item.id === "person-answer-p0")).toMatchObject({ text: "Skip" });
  });

  it("asks names when people have detected roles but no user supplied names", () => {
    const people = ["child", "parent", "parent"].map((role, index) => ({ personId: `p${index}`, name: null, role, skipped: false, momentCount: 30 - index, sampleShotIds: [], days: [] }));
    const state = deriveChat({ ...base(), people, peopleConfirmed: false, plan: null });
    expect(state.items.map((item) => item.kind)).toEqual(["you", "person"]);
    expect(state.items.at(-1)).toMatchObject({ kind: "person", personId: "p0" });
  });

  it("shows the faces waiting copy and defaults placeholders", () => {
    const state = deriveChat({ ...base(), people: null, peopleConfirmed: false, plan: null });
    expect(state.items.at(-1)).toMatchObject({ kind: "typing", text: "Finding the faces in your trip" });
    expect(state.placeholder).toBe("Tell me anything about the story");
  });

  it("puts close calls before top moments in the six suggestions", () => {
    const state = deriveChat(base());
    const moments = state.items.find((item) => item.kind === "moments");
    expect(moments).toMatchObject({ kind: "moments", suggestedShotIds: ["close-1", "close-2", "m1", "m2", "m3", "m4"] });
  });

  it("names a conflict on the moments step", () => {
    const state = deriveChat({ ...base(), conflict: { shotIds: ["m1"], message: "This moment is both kept and left out." } });
    expect(state.items.find((item) => item.kind === "mosae")).toMatchObject({ text: "This moment is both kept and left out." });
  });

  it("shows film-ready copy and default placeholder", () => {
    const state = deriveChat({ ...base(), momentsConfirmed: true, direction: { confirmed: true, pace: "gentle", lengthSec: 120, focus: "family" }, generation: { status: "done", stepsDone: 3, film } });
    expect(state.placeholder).toBe("Ask for a change");
  });
});
