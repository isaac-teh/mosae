import { describe, it, expect } from "vitest";
import { adminDb } from "../firebase/admin.js";
import {
  addEntries,
  closeSession,
  createProject,
  getOwnedProject,
  openSession,
  recordClientOutcome,
  StoreError,
} from "./projectStore.js";

const photo = { fileName: "IMG_1.jpg", contentType: "image/jpeg", sizeBytes: 2048 };
const video = { fileName: "clip.mov", contentType: "video/quicktime", sizeBytes: 9000 };

async function newProject(userId = `u-${crypto.randomUUID()}`) {
  return createProject(adminDb, { userId, mode: "memory", now: 1 });
}

describe("projectStore (emulator)", () => {
  it("creates a project readable only by its owner", async () => {
    const project = await newProject("owner-1");
    expect(await getOwnedProject(adminDb, "owner-1", project.id)).toMatchObject({ userId: "owner-1", status: "collecting" });
    expect(await getOwnedProject(adminDb, "someone-else", project.id)).toBeNull();
  });

  it("opens a session with pending manifest entries", async () => {
    const project = await newProject();
    const { session, entries } = await openSession(adminDb, {
      userId: project.userId,
      projectId: project.id,
      entries: [photo, video],
      now: 5,
    });
    expect(session.closed).toBe(false);
    expect(entries).toHaveLength(2);
    expect(entries.every((e) => e.outcome === "pending" && e.generation === null)).toBe(true);
    const stored = await adminDb.collection(`projects/${project.id}/uploadSessions/${session.id}/entries`).get();
    expect(stored.size).toBe(2);
  });

  it("rejects invalid entries and foreign projects", async () => {
    const project = await newProject();
    await expect(
      openSession(adminDb, { userId: project.userId, projectId: project.id, entries: [{ ...photo, contentType: "text/plain" }], now: 1 }),
    ).rejects.toMatchObject({ code: "invalid_entry" });
    await expect(
      openSession(adminDb, { userId: "intruder", projectId: project.id, entries: [photo], now: 1 }),
    ).rejects.toMatchObject({ code: "not_found" });
  });

  it("blocks new entries after close without finalizing pending ones", async () => {
    const project = await newProject();
    const { session } = await openSession(adminDb, { userId: project.userId, projectId: project.id, entries: [photo], now: 1 });
    const closed = await closeSession(adminDb, { userId: project.userId, projectId: project.id, sessionId: session.id });
    expect(closed.closed).toBe(true);
    await expect(
      addEntries(adminDb, { userId: project.userId, projectId: project.id, sessionId: session.id, entries: [video] }),
    ).rejects.toBeInstanceOf(StoreError);
    const entries = await adminDb.collection(`projects/${project.id}/uploadSessions/${session.id}/entries`).get();
    expect(entries.docs.map((d) => d.get("outcome"))).toEqual(["pending"]);
  });

  it("records client cancellation and failure without regressing", async () => {
    const project = await newProject();
    const { session, entries } = await openSession(adminDb, {
      userId: project.userId,
      projectId: project.id,
      entries: [photo, video],
      now: 1,
    });
    const ref = { userId: project.userId, projectId: project.id, sessionId: session.id };
    const cancelled = await recordClientOutcome(adminDb, { ...ref, assetId: entries[0].assetId, event: { kind: "cancelled" } });
    expect(cancelled.outcome).toBe("cancelled");
    const failed = await recordClientOutcome(adminDb, { ...ref, assetId: entries[1].assetId, event: { kind: "failed", reason: "network" } });
    expect(failed).toMatchObject({ outcome: "failed", failureReason: "network" });
    const still = await recordClientOutcome(adminDb, { ...ref, assetId: entries[1].assetId, event: { kind: "cancelled" } });
    expect(still.outcome).toBe("failed");
  });
});
