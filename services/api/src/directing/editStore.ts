import { randomUUID } from "node:crypto";
import type { Firestore } from "firebase-admin/firestore";
import { EditOpSchema, applyEdits, mergeOps, type EditOp, type Timeline } from "@mosae/contracts";
import { addSourceDimensions } from "../compose/resolveSources.js";
import { loadSourceForShot } from "../store/sourceStore.js";

export type EditDocument = { revision: number; ops: EditOp[]; updatedAt: number | null; sourceDimensions?: Record<string, { width: number; height: number }> };
export class EditInterpretationStaleRevision extends Error {
  constructor(readonly currentRevision: number) { super("stale_revision"); }
}
export const emptyEdits = (): EditDocument => ({ revision: 0, ops: [], updatedAt: null, sourceDimensions: {} });
export const expectedAcknowledgedOps = (priorOps: EditOp[], interpretedOps: EditOp[]): EditOp[] => mergeOps([...priorOps, ...interpretedOps]);

function sourceDimensionsOf(timeline: Timeline): NonNullable<EditDocument["sourceDimensions"]> {
  return Object.fromEntries(timeline.videoClips.flatMap((clip) => "source" in clip
    ? clip.source.width && clip.source.height ? [[clip.source.shotId, { width: clip.source.width, height: clip.source.height }]] : []
    : clip.spec.slots.flatMap((slot) => slot.shotId && slot.width && slot.height ? [[slot.shotId, { width: slot.width, height: slot.height }]] : [])));
}

export type EditValidation =
  | { ok: true; revision: number; ops: EditOp[] }
  | { ok: false; error: string; opIndex: number };

export function validateEditRequest(timeline: Timeline, body: unknown): EditValidation {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, error: "invalid_edit_document", opIndex: -1 };
  const { revision, ops } = body as Record<string, unknown>;
  if (!Number.isSafeInteger(revision) || (revision as number) < 1 || !Array.isArray(ops)) {
    return { ok: false, error: "invalid_edit_document", opIndex: -1 };
  }
  const parsed: EditOp[] = [];
  for (let index = 0; index < ops.length; index++) {
    const result = EditOpSchema.safeParse(ops[index]);
    if (!result.success) return { ok: false, error: result.error.issues.map((issue) => issue.message).join("; "), opIndex: index };
    parsed.push(result.data);
  }
  const applied = applyEdits(timeline, parsed);
  if (!applied.ok) return applied;
  return { ok: true, revision: revision as number, ops: parsed };
}

function asEditDocument(value: FirebaseFirestore.DocumentData | undefined): EditDocument {
  if (!value) return emptyEdits();
  return { revision: value.revision as number, ops: value.ops as EditOp[], updatedAt: value.updatedAt as number, sourceDimensions: (value.sourceDimensions ?? {}) as EditDocument["sourceDimensions"] };
}

export async function getEditDocument(db: Firestore, userId: string, projectId: string, generationId: string): Promise<EditDocument | null> {
  const project = db.collection("projects").doc(projectId);
  const projectSnap = await project.get();
  if (!projectSnap.exists || projectSnap.get("userId") !== userId) return null;
  const generation = project.collection("generations").doc(generationId);
  if (!(await generation.get()).exists) return null;
  const document = asEditDocument((await generation.collection("edits").doc("current").get()).data());
  const timeline = (await generation.get()).get("timeline") as Timeline | undefined;
  if (!timeline) return document;
  const applied = applyEdits(timeline, document.ops);
  if (!applied.ok) return document;
  const normalized = await addSourceDimensions(applied.timeline, (id, shotId) => loadSourceForShot(db, id, shotId), projectId);
  document.sourceDimensions = sourceDimensionsOf(normalized);
  return document;
}

export type SaveEditResult =
  | { status: "saved"; document: EditDocument }
  | { status: "stale"; current: EditDocument }
  | { status: "invalid"; error: string; opIndex: number }
  | { status: "not_found" };

export async function saveEditDocument(db: Firestore, userId: string, projectId: string, generationId: string, body: unknown, now = Date.now): Promise<SaveEditResult> {
  const project = db.collection("projects").doc(projectId);
  const generation = project.collection("generations").doc(generationId);
  const currentRef = generation.collection("edits").doc("current");
  return db.runTransaction(async (transaction): Promise<SaveEditResult> => {
    const [projectSnap, generationSnap, editSnap] = await Promise.all([
      transaction.get(project), transaction.get(generation), transaction.get(currentRef),
    ]);
    if (!projectSnap.exists || projectSnap.get("userId") !== userId || !generationSnap.exists) return { status: "not_found" };
    const current = asEditDocument(editSnap.data());
    const revision = body && typeof body === "object" ? (body as { revision?: unknown }).revision : undefined;
    if (Number.isSafeInteger(revision) && revision !== current.revision + 1) return { status: "stale", current };
    const timeline = generationSnap.get("timeline") as Timeline | undefined;
    if (!timeline) return { status: "invalid", error: "timeline_unavailable", opIndex: -1 };
    const validated = validateEditRequest(timeline, body);
    if (!validated.ok) return { status: "invalid", error: validated.error, opIndex: validated.opIndex };
    const applied = applyEdits(timeline, validated.ops);
    if (!applied.ok) return { status: "invalid", error: applied.error, opIndex: applied.opIndex };
    const normalized = await addSourceDimensions(applied.timeline, (id, shotId) => loadSourceForShot(db, id, shotId), projectId);
    const sourceDimensions = sourceDimensionsOf(normalized);
    const document: EditDocument = { revision: validated.revision, ops: validated.ops, updatedAt: now(), sourceDimensions };
    transaction.set(currentRef, document);
    transaction.set(currentRef.collection("revisions").doc(String(document.revision)), document);
    return { status: "saved", document };
  });
}

export type EditConversationTurn = {
  requestId: string; user: string; reply: string;
  kind: "edit" | "clarify" | "unsupported";
  revision: number; status: "pending" | "applied" | "answered" | "failed";
  appliedRevision?: number;
};
export type StoredEditInterpretation = { kind: EditConversationTurn["kind"]; reply: string; ops: EditOp[]; requestId: string; baseRevision?: number; [key: string]: unknown };

const requestKey = (requestId: string) => Buffer.from(requestId).toString("base64url");
function conversationRefs(db: Firestore, projectId: string, generationId: string) {
  const project = db.doc(`projects/${projectId}`);
  const generation = project.collection("generations").doc(generationId);
  return { project, generation, current: generation.collection("editConversations").doc("current") };
}
export async function getEditConversation(db: Firestore, userId: string, projectId: string, generationId: string): Promise<EditConversationTurn[] | null> {
  const refs = conversationRefs(db, projectId, generationId);
  const project = await refs.project.get();
  if (!project.exists || project.get("userId") !== userId || !(await refs.generation.get()).exists) return null;
  return ((await refs.current.get()).get("turns") ?? []).slice(-8);
}

export const EDIT_INTERPRETATION_LEASE_MS = 120_000;
export class EditInterpretationLeaseLost extends Error {
  constructor() { super("edit_interpretation_lease_lost"); }
}

/** Extend an active reservation while the model call is still running. */
export async function renewEditInterpretation(db: Firestore, projectId: string, generationId: string, requestId: string, leaseToken: string, now = Date.now): Promise<boolean> {
  const request = conversationRefs(db, projectId, generationId).current.collection("requests").doc(requestKey(requestId));
  return db.runTransaction(async tx => {
    const stored = await tx.get(request);
    const at = now();
    if (!stored.exists || stored.get("result") || stored.get("leaseToken") !== leaseToken || stored.get("leaseUntil") <= at) return false;
    tx.update(request, { leaseUntil: at + EDIT_INTERPRETATION_LEASE_MS });
    return true;
  });
}

/** Reserve request IDs before model work. Payload mismatches never replay another request. */
export async function beginEditInterpretation(db: Firestore, userId: string, projectId: string, generationId: string, requestId: string, fingerprint: string, now = Date.now) {
  const refs = conversationRefs(db, projectId, generationId);
  const request = refs.current.collection("requests").doc(requestKey(requestId));
  const edits = refs.generation.collection("edits").doc("current");
  return db.runTransaction(async tx => {
    const [project, generation, stored, saved] = await Promise.all([tx.get(refs.project), tx.get(refs.generation), tx.get(request), tx.get(edits)]);
    if (!project.exists || project.get("userId") !== userId || !generation.exists) return { status: "not_found" as const };
    if (stored.exists) {
      if (stored.get("fingerprint") !== fingerprint) return { status: "conflict" as const };
      const result = stored.get("result") as StoredEditInterpretation | undefined;
      if (result) {
        tx.update(request, { lastReplayAt: now() });
        return { status: "complete" as const, result, currentRevision: saved.exists ? Number(saved.get("revision") ?? 0) : 0 };
      }
      // Legacy reservations use createdAt; orphaned records without timestamps can recover immediately.
      const leaseUntil = stored.get("leaseUntil") ?? ((stored.get("createdAt") ?? 0) + EDIT_INTERPRETATION_LEASE_MS);
      if (leaseUntil > now()) return { status: "processing" as const };
    }
    const leaseToken = randomUUID();
    const at = now();
    tx.set(request, { fingerprint, createdAt: at, leaseUntil: at + EDIT_INTERPRETATION_LEASE_MS, leaseToken });
    return { status: "started" as const, leaseToken };
  });
}
export async function finishEditInterpretation(db: Firestore, userId: string, projectId: string, generationId: string, user: string, revision: number, priorOps: EditOp[], result: StoredEditInterpretation, leaseToken: string, now = Date.now): Promise<void> {
  const refs = conversationRefs(db, projectId, generationId);
  const request = refs.current.collection("requests").doc(requestKey(result.requestId));
  const edits = refs.generation.collection("edits").doc("current");
  await db.runTransaction(async tx => {
    const [owner, generation, stored, history, saved] = await Promise.all([tx.get(refs.project), tx.get(refs.generation), tx.get(request), tx.get(refs.current), tx.get(edits)]);
    if (owner.get("userId") !== userId || !generation.exists || !stored.exists) throw new Error("not_found");
    if (stored.get("leaseToken") !== leaseToken || stored.get("leaseUntil") <= now()) throw new EditInterpretationLeaseLost();
    if (stored.get("result")) return;
    const currentRevision = saved.exists ? Number(saved.get("revision") ?? 0) : 0;
    const currentOps = saved.exists ? (saved.get("ops") ?? []) as EditOp[] : [];
    if (currentRevision !== revision || JSON.stringify(currentOps) !== JSON.stringify(priorOps)) throw new EditInterpretationStaleRevision(currentRevision);
    const turn: EditConversationTurn = { requestId: result.requestId, user: user.slice(0, 2000), reply: result.reply.slice(0, 2000), kind: result.kind, revision, status: result.kind === "edit" ? "pending" : "answered" };
    tx.set(request, { result, priorOps, revision, turn }, { merge: true });
    const turns = (history.get("turns") ?? []) as EditConversationTurn[];
    tx.set(refs.current, { turns: [...turns.filter(turn => turn.requestId !== result.requestId), turn].slice(-8) });
  });
}
export async function acknowledgeEditInterpretation(db: Firestore, userId: string, projectId: string, generationId: string, requestId: string, revision: number) {
  const refs = conversationRefs(db, projectId, generationId);
  const request = refs.current.collection("requests").doc(requestKey(requestId));
  const edits = refs.generation.collection("edits").doc("current");
  return db.runTransaction(async tx => {
    const [owner, generation, stored, saved, history] = await Promise.all([tx.get(refs.project), tx.get(refs.generation), tx.get(request), tx.get(edits), tx.get(refs.current)]);
    if (owner.get("userId") !== userId || !generation.exists || !stored.exists) return "not_found" as const;
    const turn = stored.get("turn") as EditConversationTurn | undefined;
    const result = stored.get("result") as StoredEditInterpretation | undefined;
    if (!turn || result?.kind !== "edit") return "invalid" as const;
    if (turn.status === "applied") return turn.appliedRevision === revision ? "applied" as const : "conflict" as const;
    const expected = expectedAcknowledgedOps((stored.get("priorOps") ?? []) as EditOp[], result.ops);
    if (revision !== turn.revision + 1 || saved.get("revision") !== revision || JSON.stringify(saved.get("ops")) !== JSON.stringify(expected)) return "conflict" as const;
    const applied = { ...turn, status: "applied" as const, appliedRevision: revision };
    tx.update(request, { turn: applied });
    tx.set(refs.current, { turns: ((history.get("turns") ?? []) as EditConversationTurn[]).map(item => item.requestId === requestId ? applied : item).slice(-8) });
    return "applied" as const;
  });
}

export async function abandonEditInterpretation(db: Firestore, projectId: string, generationId: string, requestId: string, leaseToken: string): Promise<void> {
  const request = conversationRefs(db, projectId, generationId).current.collection("requests").doc(requestKey(requestId));
  await db.runTransaction(async tx => { const stored = await tx.get(request); if (stored.exists && !stored.get("result") && stored.get("leaseToken") === leaseToken) tx.update(request, { leaseUntil: 0 }); });
}
