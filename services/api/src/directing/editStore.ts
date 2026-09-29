import type { Firestore } from "firebase-admin/firestore";
import { EditOpSchema, applyEdits, type EditOp, type Timeline } from "@mosae/contracts";

export type EditDocument = { revision: number; ops: EditOp[]; updatedAt: number | null };
export const emptyEdits = (): EditDocument => ({ revision: 0, ops: [], updatedAt: null });

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
  return { revision: value.revision as number, ops: value.ops as EditOp[], updatedAt: value.updatedAt as number };
}

export async function getEditDocument(db: Firestore, userId: string, projectId: string, generationId: string): Promise<EditDocument | null> {
  const project = db.collection("projects").doc(projectId);
  const projectSnap = await project.get();
  if (!projectSnap.exists || projectSnap.get("userId") !== userId) return null;
  const generation = project.collection("generations").doc(generationId);
  if (!(await generation.get()).exists) return null;
  return asEditDocument((await generation.collection("edits").doc("current").get()).data());
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
    const document: EditDocument = { revision: validated.revision, ops: validated.ops, updatedAt: now() };
    transaction.set(currentRef, document);
    transaction.set(currentRef.collection("revisions").doc(String(document.revision)), document);
    return { status: "saved", document };
  });
}
