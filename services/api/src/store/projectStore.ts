import type { Firestore } from "firebase-admin/firestore";
import {
  applyEntryEvent,
  canAddEntries,
  validateNewEntry,
  type ManifestEntry,
  type UploadSession,
} from "../domain/uploadSession.js";

export const MAX_ENTRIES_PER_REQUEST = 500;

export type Project = {
  id: string;
  userId: string;
  mode: "memory" | "creator";
  title: string | null;
  status: "collecting" | "processing" | "ready" | "ready_with_errors" | "failed";
  createdAt: number;
};

export type NewEntryInput = { fileName: string; contentType: string; sizeBytes: number };

export class StoreError extends Error {
  constructor(public code: "not_found" | "session_closed" | "invalid_entry" | "too_many_entries") {
    super(code);
  }
}

const projectRef = (db: Firestore, projectId: string) => db.collection("projects").doc(projectId);
const sessionRef = (db: Firestore, projectId: string, sessionId: string) =>
  projectRef(db, projectId).collection("uploadSessions").doc(sessionId);

export async function createProject(
  db: Firestore,
  input: { userId: string; mode: "memory" | "creator"; now: number },
): Promise<Project> {
  const ref = db.collection("projects").doc();
  const project: Project = { id: ref.id, userId: input.userId, mode: input.mode, title: null, status: "collecting", createdAt: input.now };
  await ref.set(project);
  return project;
}

export async function getOwnedProject(db: Firestore, userId: string, projectId: string): Promise<Project | null> {
  const snap = await projectRef(db, projectId).get();
  if (!snap.exists || snap.get("userId") !== userId) return null;
  return snap.data() as Project;
}

function buildEntries(db: Firestore, inputs: NewEntryInput[]): ManifestEntry[] {
  if (inputs.length === 0 || inputs.length > MAX_ENTRIES_PER_REQUEST) throw new StoreError("too_many_entries");
  return inputs.map((input) => {
    if (validateNewEntry(input)) throw new StoreError("invalid_entry");
    return {
      assetId: db.collection("_ids").doc().id,
      fileName: input.fileName,
      contentType: input.contentType,
      sizeBytes: input.sizeBytes,
      outcome: "pending",
      generation: null,
      failureReason: null,
    };
  });
}

async function requireOwner(db: Firestore, userId: string, projectId: string): Promise<void> {
  if (!(await getOwnedProject(db, userId, projectId))) throw new StoreError("not_found");
}

export async function openSession(
  db: Firestore,
  input: { userId: string; projectId: string; entries: NewEntryInput[]; now: number },
): Promise<{ session: UploadSession; entries: ManifestEntry[] }> {
  await requireOwner(db, input.userId, input.projectId);
  const entries = buildEntries(db, input.entries);
  const ref = projectRef(db, input.projectId).collection("uploadSessions").doc();
  const session: UploadSession = { id: ref.id, projectId: input.projectId, userId: input.userId, closed: false, createdAt: input.now };

  const batch = db.batch();
  batch.set(ref, session);
  for (const entry of entries) batch.set(ref.collection("entries").doc(entry.assetId), entry);
  await batch.commit();
  return { session, entries };
}

export async function addEntries(
  db: Firestore,
  input: { userId: string; projectId: string; sessionId: string; entries: NewEntryInput[] },
): Promise<ManifestEntry[]> {
  await requireOwner(db, input.userId, input.projectId);
  const entries = buildEntries(db, input.entries);
  const ref = sessionRef(db, input.projectId, input.sessionId);

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new StoreError("not_found");
    if (!canAddEntries(snap.data() as UploadSession)) throw new StoreError("session_closed");
    for (const entry of entries) tx.create(ref.collection("entries").doc(entry.assetId), entry);
  });
  return entries;
}

export async function closeSession(
  db: Firestore,
  input: { userId: string; projectId: string; sessionId: string },
): Promise<UploadSession> {
  await requireOwner(db, input.userId, input.projectId);
  const ref = sessionRef(db, input.projectId, input.sessionId);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new StoreError("not_found");
    const session = { ...(snap.data() as UploadSession), closed: true };
    tx.update(ref, { closed: true });
    return session;
  });
}

export async function recordClientOutcome(
  db: Firestore,
  input: {
    userId: string;
    projectId: string;
    sessionId: string;
    assetId: string;
    event: { kind: "cancelled" } | { kind: "failed"; reason: string };
  },
): Promise<ManifestEntry> {
  await requireOwner(db, input.userId, input.projectId);
  const ref = sessionRef(db, input.projectId, input.sessionId).collection("entries").doc(input.assetId);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new StoreError("not_found");
    const { entry, changed } = applyEntryEvent(snap.data() as ManifestEntry, input.event);
    if (changed) tx.set(ref, entry);
    return entry;
  });
}
