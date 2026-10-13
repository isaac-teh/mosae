import type { Firestore, Transaction } from "firebase-admin/firestore";
import {
  applyEntryEvent,
  canAddEntries,
  validateNewEntry,
  type ManifestEntry,
  type UploadSession,
} from "../domain/uploadSession.js";

const ENTRY_WRITE_CHUNK_SIZE = 200;

export type Project = {
  id: string;
  userId: string;
  mode: "memory" | "creator";
  title: string | null;
  status: "collecting" | "processing" | "ready" | "ready_with_errors" | "failed";
  createdAt: number;
  deleting?: boolean;
};

export type NewEntryInput = { fileName: string; contentType: string; sizeBytes: number; replacesAssetId?: string; replacesSessionId?: string };

export class StoreError extends Error {
  constructor(public code: "not_found" | "session_closed" | "invalid_entry" | "too_many_entries" | "invalid_replacement" | "replacement_conflict") {
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
  if (!snap.exists || snap.get("userId") !== userId || snap.get("deleting") === true) return null;
  return snap.data() as Project;
}

function buildEntries(db: Firestore, projectId: string, sessionId: string, inputs: NewEntryInput[]): ManifestEntry[] {
  if (inputs.length === 0) throw new StoreError("too_many_entries");
  return inputs.map((input) => {
    if (validateNewEntry(input)) throw new StoreError("invalid_entry");
    const assetId = db.collection("_ids").doc().id;
    if (Boolean(input.replacesAssetId) !== Boolean(input.replacesSessionId)) throw new StoreError("invalid_replacement");
    return {
      assetId, projectId, sessionId, logicalAssetId: assetId,
      fileName: input.fileName,
      contentType: input.contentType,
      sizeBytes: input.sizeBytes,
      outcome: "pending",
      generation: null,
      failureReason: null,
    };
  });
}

function replacementTargetRef(db: Firestore, projectId: string, entry: NewEntryInput) {
  if (!entry.replacesAssetId || !entry.replacesSessionId) throw new StoreError("invalid_replacement");
  return sessionRef(db, projectId, entry.replacesSessionId).collection("entries").doc(entry.replacesAssetId);
}

async function claimReplacements(tx: Transaction, db: Firestore, projectId: string, entries: ManifestEntry[], inputs: NewEntryInput[]) {
  const replacementIndexes = inputs.flatMap((input, index) => input.replacesAssetId ? [index] : []);
  const refs = replacementIndexes.map((index) => replacementTargetRef(db, projectId, inputs[index]!));
  const targets = await Promise.all(refs.map((ref) => tx.get(ref)));
  const sessionRefs = replacementIndexes.map((index) => sessionRef(db, projectId, inputs[index]!.replacesSessionId!));
  const sessions = await Promise.all(sessionRefs.map((ref) => tx.get(ref)));
  const seen = new Set<string>();
  for (let targetIndex = 0; targetIndex < replacementIndexes.length; targetIndex++) {
    const entryIndex = replacementIndexes[targetIndex]!;
    const targetSnap = targets[targetIndex]!;
    if (!targetSnap.exists) throw new StoreError("invalid_replacement");
    const target = targetSnap.data() as ManifestEntry;
    const identity = `${inputs[entryIndex]!.replacesSessionId}/${target.assetId}`;
    if (seen.has(identity) || (target.projectId && target.projectId !== projectId) || target.assetId !== inputs[entryIndex]!.replacesAssetId || (target.sessionId && target.sessionId !== inputs[entryIndex]!.replacesSessionId)) throw new StoreError("invalid_replacement");
    seen.add(identity);
    const session = sessions[targetIndex];
    const terminal = target.outcome === "failed" || target.outcome === "cancelled";
    const abandonedPending = target.outcome === "pending" && session?.exists && session.get("closed") === true;
    if (!terminal && !abandonedPending) throw new StoreError("invalid_replacement");
    if (target.replacementSuccessorId) throw new StoreError("replacement_conflict");
    entries[entryIndex] = { ...entries[entryIndex]!, logicalAssetId: target.logicalAssetId || target.assetId, replacementOf: target.assetId };
  }
  replacementIndexes.forEach((entryIndex, targetIndex) => tx.update(refs[targetIndex]!, {
    ...(targets[targetIndex]!.get("outcome") === "pending" ? { outcome: "cancelled", failureReason: "replaced_after_closed_session" } : {}),
    replacementSuccessorId: entries[entryIndex]!.assetId,
  }));
}

async function requireOwner(db: Firestore, userId: string, projectId: string): Promise<void> {
  if (!(await getOwnedProject(db, userId, projectId))) throw new StoreError("not_found");
}

async function requireLiveOwner(tx: Transaction, db: Firestore, userId: string, projectId: string): Promise<void> {
  const project = await tx.get(projectRef(db, projectId));
  if (!project.exists || project.get("userId") !== userId || project.get("deleting") === true) throw new StoreError("not_found");
}

export async function openSession(
  db: Firestore,
  input: { userId: string; projectId: string; entries: NewEntryInput[]; now: number },
): Promise<{ session: UploadSession; entries: ManifestEntry[] }> {
  await requireOwner(db, input.userId, input.projectId);
  const ref = projectRef(db, input.projectId).collection("uploadSessions").doc();
  const entries = buildEntries(db, input.projectId, ref.id, input.entries);
  const session: UploadSession = { id: ref.id, projectId: input.projectId, userId: input.userId, closed: false, createdAt: input.now };

  await db.runTransaction(async (tx) => {
    await requireLiveOwner(tx, db, input.userId, input.projectId);
    tx.create(ref, session);
  });

  try {
    for (let offset = 0; offset < entries.length; offset += ENTRY_WRITE_CHUNK_SIZE) {
      const chunk = entries.slice(offset, offset + ENTRY_WRITE_CHUNK_SIZE);
      const inputChunk = input.entries.slice(offset, offset + ENTRY_WRITE_CHUNK_SIZE);
      await db.runTransaction(async (tx) => {
        await requireLiveOwner(tx, db, input.userId, input.projectId);
        await claimReplacements(tx, db, input.projectId, chunk, inputChunk);
        for (const entry of chunk) tx.create(ref.collection("entries").doc(entry.assetId), entry);
      });
      entries.splice(offset, chunk.length, ...chunk);
    }
  } catch (error) {
    // Do not leave a partially-created session available for later processing.
    await db.recursiveDelete(ref).catch(() => undefined);
    throw error;
  }
  return { session, entries };
}

export async function addEntries(
  db: Firestore,
  input: { userId: string; projectId: string; sessionId: string; entries: NewEntryInput[] },
): Promise<ManifestEntry[]> {
  await requireOwner(db, input.userId, input.projectId);
  const ref = sessionRef(db, input.projectId, input.sessionId);
  const entries = buildEntries(db, input.projectId, input.sessionId, input.entries);

  await db.runTransaction(async (tx) => {
    await requireLiveOwner(tx, db, input.userId, input.projectId);
    const snap = await tx.get(ref);
    if (!snap.exists) throw new StoreError("not_found");
    if (!canAddEntries(snap.data() as UploadSession)) throw new StoreError("session_closed");
    await claimReplacements(tx, db, input.projectId, entries, input.entries);
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
    await requireLiveOwner(tx, db, input.userId, input.projectId);
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
    await requireLiveOwner(tx, db, input.userId, input.projectId);
    const snap = await tx.get(ref);
    if (!snap.exists) throw new StoreError("not_found");
    const { entry, changed } = applyEntryEvent(snap.data() as ManifestEntry, input.event);
    if (changed) tx.set(ref, entry);
    return entry;
  });
}
