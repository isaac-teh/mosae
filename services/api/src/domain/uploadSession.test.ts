import { describe, it, expect } from "vitest";
import {
  applyEntryEvent,
  canAddEntries,
  sessionSettled,
  validateNewEntry,
  MAX_UPLOAD_BYTES,
  type ManifestEntry,
  type UploadSession,
} from "./uploadSession.js";

const session: UploadSession = { id: "s1", projectId: "p1", userId: "u1", closed: false, createdAt: 0 };
const entry: ManifestEntry = {
  assetId: "a1",
  fileName: "IMG_1.HEIC",
  contentType: "image/heic",
  sizeBytes: 1000,
  outcome: "pending",
  generation: null,
  failureReason: null,
};

describe("validateNewEntry", () => {
  it("accepts images and videos within the size limit", () => {
    expect(validateNewEntry({ fileName: "a.mov", contentType: "video/quicktime", sizeBytes: 5 })).toBeNull();
  });
  it("rejects other types, empty files, and oversized files", () => {
    expect(validateNewEntry({ fileName: "a.pdf", contentType: "application/pdf", sizeBytes: 5 })).toBe("unsupported_type");
    expect(validateNewEntry({ fileName: "a.jpg", contentType: "image/jpeg", sizeBytes: 0 })).toBe("invalid_size");
    expect(validateNewEntry({ fileName: "a.mp4", contentType: "video/mp4", sizeBytes: MAX_UPLOAD_BYTES + 1 })).toBe("too_large");
  });
});

describe("session lifecycle", () => {
  it("blocks new entries once closed", () => {
    expect(canAddEntries(session)).toBe(true);
    expect(canAddEntries({ ...session, closed: true })).toBe(false);
  });

  it("is settled only when closed with no pending entries", () => {
    const done = { ...entry, outcome: "finalized" as const };
    expect(sessionSettled(session, [done])).toBe(false);
    expect(sessionSettled({ ...session, closed: true }, [done, entry])).toBe(false);
    expect(sessionSettled({ ...session, closed: true }, [done, { ...entry, outcome: "cancelled" }])).toBe(true);
  });
});

describe("applyEntryEvent", () => {
  it("finalizes a pending entry with its generation", () => {
    const r = applyEntryEvent(entry, { kind: "finalized", generation: "42" });
    expect(r.changed).toBe(true);
    expect(r.entry).toMatchObject({ outcome: "finalized", generation: "42" });
  });

  it("treats a duplicate finalize with the same generation as a no-op", () => {
    const once = applyEntryEvent(entry, { kind: "finalized", generation: "42" }).entry;
    expect(applyEntryEvent(once, { kind: "finalized", generation: "42" }).changed).toBe(false);
  });

  it("accepts a re-upload with a newer generation", () => {
    const once = applyEntryEvent(entry, { kind: "finalized", generation: "42" }).entry;
    const r = applyEntryEvent(once, { kind: "finalized", generation: "43" });
    expect(r.changed).toBe(true);
    expect(r.entry.generation).toBe("43");
  });

  it("never regresses cancelled or failed entries", () => {
    const cancelled = { ...entry, outcome: "cancelled" as const };
    expect(applyEntryEvent(cancelled, { kind: "finalized", generation: "1" }).changed).toBe(false);
    const failed = applyEntryEvent(entry, { kind: "failed", reason: "client_error" }).entry;
    expect(failed.failureReason).toBe("client_error");
    expect(applyEntryEvent(failed, { kind: "cancelled" }).changed).toBe(false);
  });

  it("does not cancel an already finalized entry", () => {
    const done = applyEntryEvent(entry, { kind: "finalized", generation: "7" }).entry;
    expect(applyEntryEvent(done, { kind: "cancelled" }).changed).toBe(false);
  });
});
