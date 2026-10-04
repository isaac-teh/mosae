import { describe, expect, it } from "vitest";
import { deriveChat, canConfirmStory } from "../../../../packages/core/src/chat/deriveChat.js";
import type { ChatInput } from "../../../../packages/core/src/chat/types.js";
import { summarise, type SummaryAsset } from "./summary.js";

const asset = (kind: "photo" | "video", localTime: string | null, place?: string): SummaryAsset => ({
  media: { kind, localTime }, place: place ? { name: place, country: "Japan" } : null,
  status: "understood", hasFaces: kind === "photo",
});

describe("summarise", () => {
  it("counts media, distinct days and places in capture order", () => {
    const result = summarise([
      asset("photo", "2026-10-20T10:00:00", "Tokyo"), asset("photo", "2026-10-20T12:00:00", "Tokyo"),
      asset("photo", "2026-10-21T10:00:00", "Kyoto"), asset("video", "2026-10-21T11:00:00", "Kyoto"),
    ], false);
    expect(result).toMatchObject({ total: 4, photos: 3, clips: 1, days: 2, places: ["Tokyo", "Kyoto"], country: "Japan", ready: { summary: true, faces: true, plan: false } });
  });
  it("returns status keyed by asset id for the existing summary poll", () => {
    expect(summarise([{ ...asset("photo", null), id: "photo-a", status: "ingested" }], false).assetStatuses).toEqual([{ assetId: "photo-a", kind: "photo", status: "ingested" }]);
  });
  it("counts undated assets but excludes them from days", () => {
    expect(summarise([asset("photo", null)], false)).toMatchObject({ total: 1, days: 0, dateRange: null });
  });
  it("preserves countries from resolved places in the chat summary", () => {
    const singapore = (localTime: string, name: string): SummaryAsset => ({ media: { kind: "photo", localTime }, place: { name, country: "Singapore" }, status: "understood", hasFaces: true });
    expect(summarise([singapore("2026-06-01T10:00:00", "Telok Blangah"), singapore("2026-06-02T10:00:00", "Siloso Beach")], false)).toMatchObject({ country: "Singapore", places: ["Telok Blangah", "Siloso Beach"], season: "early June" });
  });
  it("is not ready while an asset is still ingesting", () => {
    expect(summarise([{ ...asset("photo", null), status: "uploaded", hasFaces: false }], false)).toMatchObject({ ready: { summary: false, faces: false } });
  });
  it.each([[1, "early"], [10, "early"], [11, "mid"], [19, "mid"], [20, "late"], [31, "late"]])("labels October day %i as %s October", (day, part) => {
    const summary = summarise([asset("photo", `2026-10-${String(day).padStart(2, "0")}T10:00:00`)], false);
    expect(summary.season).toBe(`${part} October`);
  });
});


describe("authoritative story readiness", () => {
  const upload = { expected: 12, settled: 1, failed: 0, cancelled: 0, closed: false };
  it("requires a nonempty understood catalog and planning-ready project", () => {
    expect(summarise([], false).ready.story).toBe(false);
    expect(summarise([asset("photo", null)], false).ready.story).toBe(false);
    expect(summarise([asset("photo", null)], false, { projectStatus: "ready" }).ready.story).toBe(true);
    expect(summarise([asset("photo", null)], false, { projectStatus: "clustering" }).ready.story).toBe(false);
  });
  it("does not count failed assets as ingested or usable", () => {
    expect(summarise([{ ...asset("photo", null), status: "failed" }], false, { projectStatus: "ready" })).toMatchObject({ processed: { ingested: 0 }, upload: { failed: 1 }, ready: { story: false } });
  });
  it("requires closed settled manifests even with an understood asset", () => {
    expect(summarise([asset("photo", null)], false, { projectStatus: "ready", upload, manifestReady: false }).ready.story).toBe(false);
    expect(summarise([asset("photo", null)], false, { projectStatus: "ready", upload: { ...upload, expected: 1, settled: 1, closed: true }, manifestReady: true }).ready.story).toBe(true);
  });
});


it("excludes terminal manifest failures from understood usable media", () => {
  const failed = { ...asset("photo", null), id: "excluded" };
  const context = { projectStatus: "ready", excludedAssetIds: ["excluded"], upload: { expected: 1, settled: 1, failed: 1, cancelled: 0, closed: true }, manifestReady: true };
  expect(summarise([failed], false, context)).toMatchObject({ processed: { ingested: 0, understood: 0, faces: 0 }, ready: { story: false } });
  expect(summarise([failed, { ...asset("photo", null), id: "good" }], false, context)).toMatchObject({ processed: { ingested: 1, understood: 1, faces: 1 }, ready: { story: true } });
});

it.each([true, false])("continues with understood media after acknowledged processing failure (manifest %s)", (manifest) => {
  const result = summarise([
    { ...asset("photo", "2026-06-01T10:00:00", "Tokyo"), id: "good" },
    { ...asset("photo", "2026-10-20T10:00:00", "Kyoto"), id: "failed", status: "failed" },
  ], false, { projectStatus: "ready_with_errors", ...(manifest ? { upload: { expected: 2, settled: 2, failed: 1, cancelled: 0, closed: true }, manifestReady: true } : {}) });
  const input: ChatInput = { summary: result, intent: null, people: [], peopleConfirmed: true, plan: null, momentsConfirmed: false, conflict: null, direction: null, generation: null, notes: [] };
  expect(canConfirmStory(input)).toBe(false);
  expect(result).toMatchObject({ total: 1, photos: 1, days: 1, places: ["Tokyo"], upload: { failed: 1 }, processed: { ingested: 1, understood: 1, faces: 1 }, ready: { summary: true, faces: true, story: true } });
  expect(result.assetStatuses).toContainEqual({ assetId: "failed", kind: "photo", status: "failed" });
  const chat = deriveChat({ ...input, uploadFailuresAcknowledged: true });
  expect(chat.items).toContainEqual({ kind: "occasion", id: "occasion" });
  expect(chat.items.find(item => item.id === "occasion-message")).toMatchObject({ text: expect.stringContaining("all 1") });
});
