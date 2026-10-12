import { DirectorFlowSchema, type DirectorFlow, type FlowAction } from "@mosae/contracts";
import type { Firestore } from "firebase-admin/firestore";

const emptyFlow = (): DirectorFlow => ({ revision: 0, story: { answer: null, storySummary: null, mentionedPeople: [] }, people: [], peopleSummaryConfirmed: false });
const flowRef = (db: Firestore, projectId: string) => db.collection("projects").doc(projectId);
const personDefaults = (personId: string, value: Record<string, unknown> = {}) => ({
  personId,
  name: typeof value.name === "string" ? value.name : null,
  role: typeof value.role === "string" ? value.role : null,
  confirmed: value.confirmed === true,
  skipped: value.skipped === true || value.excluded === true,
  manualShotAdds: Array.isArray(value.manualShots) ? value.manualShots.filter((x): x is string => typeof x === "string") : [],
  manualShotRemoves: Array.isArray(value.removedShots) ? value.removedShots.filter((x): x is string => typeof x === "string") : [],
  faceIds: Array.isArray(value.faceIds) ? value.faceIds.filter((x): x is string => typeof x === "string") : [],
  mergedInto: typeof value.mergedInto === "string" ? value.mergedInto : null,
});

async function migrateFlow(db: Firestore, projectId: string, projectData: FirebaseFirestore.DocumentData): Promise<DirectorFlow> {
  const project = db.collection("projects").doc(projectId);
  const [cast, intents] = await Promise.all([
    project.collection("cast").doc("current").get(),
    project.collection("storyIntents").orderBy("version", "desc").limit(1).get(),
  ]);
  const castPeople = cast.data()?.people;
  const people = Array.isArray(castPeople) ? castPeople.flatMap((person: Record<string, unknown>) => typeof person.personId === "string" ? [personDefaults(person.personId, { ...person, confirmed: cast.get("confirmed") === true })] : []) : [];
  let answer: string | null = null;
  let storySummary: string | null = null;
  let mentionedPeople: string[] = [];
  if (!intents.empty) {
    answer = typeof intents.docs[0]!.get("text") === "string" ? intents.docs[0]!.get("text") as string : null;
    mentionedPeople = Array.isArray(intents.docs[0]!.get("focus")) ? (intents.docs[0]!.get("focus") as unknown[]).filter((value): value is string => typeof value === "string") : [];
  }
  const proposalId = projectData.currentProposalId;
  if (typeof proposalId === "string") {
    const proposal = await project.collection("storyProposals").doc(proposalId).get();
    storySummary = typeof proposal.get("title") === "string" ? proposal.get("title") as string : null;
    const intentId = proposal.get("storyIntentId");
    if (!answer && typeof intentId === "string") {
      const intent = await project.collection("storyIntents").doc(intentId).get();
      answer = typeof intent.get("text") === "string" ? intent.get("text") as string : null;
    }
  }
  return DirectorFlowSchema.parse({ ...emptyFlow(), story: { answer, storySummary, mentionedPeople }, people });
}

export class FlowStoreError extends Error {
  constructor(public readonly code: "not_found" | "invalid_action") { super(code); }
}

/** Reads a stored flow, migrating projects created before the flow record existed. */
export async function readFlow(db: Firestore, userId: string, projectId: string): Promise<DirectorFlow> {
  const project = flowRef(db, projectId);
  const snapshot = await project.get();
  if (!snapshot.exists || snapshot.get("userId") !== userId) throw new FlowStoreError("not_found");
  const stored = DirectorFlowSchema.safeParse(snapshot.get("flow"));
  if (stored.success) return stored.data;
  const migrated = await migrateFlow(db, projectId, snapshot.data()!);
  return db.runTransaction(async (transaction) => {
    const current = await transaction.get(project);
    if (!current.exists || current.get("userId") !== userId) throw new FlowStoreError("not_found");
    const latest = DirectorFlowSchema.safeParse(current.get("flow"));
    if (latest.success) return latest.data;
    transaction.update(project, { flow: migrated });
    return migrated;
  });
}

export function applyFlowAction(flow: DirectorFlow, action: FlowAction): DirectorFlow {
  if (action.type === "batch") return action.actions.reduce((current, item) => applyFlowAction(current, item), flow);
  if (action.type === "story-answer") return { ...flow, story: { answer: action.answer, storySummary: action.storySummary ?? flow.story.storySummary, mentionedPeople: action.mentionedPeople ?? flow.story.mentionedPeople } };
  if (action.type === "person") {
    const prior = flow.people.find((person) => person.personId === action.personId) ?? personDefaults(action.personId);
    const next = { ...prior, ...(action.name !== undefined ? { name: action.name } : {}), ...(action.role !== undefined ? { role: action.role } : {}), ...(action.confirmed !== undefined ? { confirmed: action.confirmed } : {}), ...(action.skipped !== undefined ? { skipped: action.skipped } : {}) };
    return { ...flow, people: [...flow.people.filter((person) => person.personId !== action.personId), next] };
  }
  if (action.type === "manual-shot") {
    const prior = flow.people.find((person) => person.personId === action.personId) ?? personDefaults(action.personId);
    const adds = new Set(prior.manualShotAdds), removes = new Set(prior.manualShotRemoves);
    (action.included ? adds : removes).add(action.shotId);
    (action.included ? removes : adds).delete(action.shotId);
    return { ...flow, people: [...flow.people.filter((person) => person.personId !== action.personId), { ...prior, manualShotAdds: [...adds], manualShotRemoves: [...removes] }] };
  }
  if (action.type === "move-photo") {
    if (action.personId !== null && !flow.people.some((person) => person.personId === action.personId)) throw new FlowStoreError("invalid_action");
    return { ...flow, people: flow.people.map((person) => ({ ...person, faceIds: action.personId === person.personId
      ? [...new Set([...person.faceIds, action.faceId])]
      : person.faceIds.filter((faceId) => faceId !== action.faceId) })) };
  }
  if (action.type === "merge") {
    if (action.personId === action.targetPersonId) throw new FlowStoreError("invalid_action");
    const source = flow.people.find((person) => person.personId === action.personId);
    if (!source || !flow.people.some((person) => person.personId === action.targetPersonId)) throw new FlowStoreError("invalid_action");
    return { ...flow, people: flow.people.map((person) => person.personId === action.personId ? { ...person, mergedInto: action.targetPersonId, skipped: true } : person) };
  }
  if (action.type === "people-summary-confirmed") return { ...flow, peopleSummaryConfirmed: action.confirmed };
  return flow;
}

// Firestore may reorder map keys and omit undefined values when storing actions.
// Canonicalize object keys recursively and omit undefined fields so genuine
// retries compare equal regardless of serialization order.
function canonicalStringify(value: unknown): string {
  const canonicalize = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map((entry) => entry === undefined ? null : canonicalize(entry));
    if (item !== null && typeof item === "object") {
      return Object.fromEntries(Object.keys(item as Record<string, unknown>).sort()
        .filter((key) => (item as Record<string, unknown>)[key] !== undefined)
        .map((key) => [key, canonicalize((item as Record<string, unknown>)[key])]));
    }
    return item;
  };
  return JSON.stringify(canonicalize(value));
}

/** Applies one action once per client action id and advances revision atomically. */
export async function mutateFlow(db: Firestore, input: { userId: string; projectId: string; actionId: string; action: FlowAction }): Promise<DirectorFlow> {
  const project = flowRef(db, input.projectId);
  const actionRef = project.collection("flowActions").doc(input.actionId);
  const readinessRef = project.collection("readiness").doc("summary");
  const latestActionQuery = project.collection("flowActions").orderBy("revision", "desc").limit(1);
  const seeded = await readFlow(db, input.userId, input.projectId);
  return db.runTransaction(async (transaction) => {
    const [projectSnap, actionSnap, latestActions] = await Promise.all([transaction.get(project), transaction.get(actionRef), transaction.get(latestActionQuery)]);
    if (!projectSnap.exists || projectSnap.get("userId") !== input.userId) throw new FlowStoreError("not_found");
    if (actionSnap.exists) {
      if (canonicalStringify(actionSnap.get("action")) !== canonicalStringify(input.action)) throw new FlowStoreError("invalid_action");
      return DirectorFlowSchema.parse(actionSnap.get("result"));
    }
    const parsed = DirectorFlowSchema.safeParse(projectSnap.get("flow"));
    const before = parsed.success ? parsed.data : seeded;
    let candidate = applyFlowAction(before, input.action);
    if (input.action.type === "undo") {
      const last = latestActions.docs[0];
      const previous = DirectorFlowSchema.safeParse(last?.get("previous"));
      if (!last || !previous.success) throw new FlowStoreError("invalid_action");
      candidate = previous.data;
    }
    const next = DirectorFlowSchema.parse({ ...candidate, revision: before.revision + 1 });
    transaction.update(project, { flow: next });
    transaction.set(readinessRef, { flowRevision: next.revision }, { merge: true });
    transaction.create(actionRef, { result: next, previous: before, action: JSON.parse(canonicalStringify(input.action)), actionType: input.action.type, revision: next.revision, createdAt: Date.now() });
    return next;
  });
}
