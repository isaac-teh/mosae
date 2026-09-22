import {
  StoryIntentSchema,
  StoryProposalSchema,
  type ProposalConstraints,
  type StoryIntent,
  type StoryProposal,
} from "@mosae/contracts";
import type { Firestore } from "firebase-admin/firestore";

export type DirectingStoreErrorCode =
  | "invalid_intent"
  | "invalid_job"
  | "invalid_proposal"
  | "not_found"
  | "stale_proposal";

export class DirectingStoreError extends Error {
  constructor(public readonly code: DirectingStoreErrorCode) {
    super(code);
  }
}

const projectRef = (db: Firestore, projectId: string) => db.collection("projects").doc(projectId);
const proposalRef = (db: Firestore, projectId: string, proposalId: string) =>
  projectRef(db, projectId).collection("storyProposals").doc(proposalId);

function parseStoredProposal(value: FirebaseFirestore.DocumentData | undefined): StoryProposal | null {
  if (!value) return null;
  const { jobId: _jobId, createdAt: _createdAt, ...candidate } = value;
  const parsed = StoryProposalSchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}

export async function saveIntent(
  db: Firestore,
  input: { userId: string; intent: StoryIntent; createdAt: number },
): Promise<StoryIntent> {
  const parsed = StoryIntentSchema.safeParse(input.intent);
  if (!parsed.success) throw new DirectingStoreError("invalid_intent");

  const intent = parsed.data;
  const project = projectRef(db, intent.projectId);
  const intentRef = project.collection("storyIntents").doc(intent.id);
  return db.runTransaction(async (transaction) => {
    const projectSnap = await transaction.get(project);
    if (!projectSnap.exists || projectSnap.get("userId") !== input.userId) {
      throw new DirectingStoreError("not_found");
    }

    transaction.set(intentRef, { ...intent, createdAt: input.createdAt });
    transaction.update(project, {
      currentProposalId: projectSnap.get("currentProposalId") ?? null,
      acceptedProposalId: projectSnap.get("acceptedProposalId") ?? null,
    });
    return intent;
  });
}

export type SaveProposalResult = "published" | "stale";

/**
 * Persists a completed job's proposal and conditionally advances the project
 * pointer. The job record, rather than caller-supplied version metadata, is the
 * authority used to prevent an older worker from replacing a newer result.
 */
export async function saveProposal(
  db: Firestore,
  input: { jobId: string; proposal: StoryProposal; createdAt: number },
): Promise<SaveProposalResult> {
  const parsed = StoryProposalSchema.safeParse(input.proposal);
  if (!parsed.success) throw new DirectingStoreError("invalid_proposal");

  const proposal = parsed.data;
  const project = projectRef(db, proposal.projectId);
  const job = project.collection("jobs").doc(input.jobId);
  const destination = proposalRef(db, proposal.projectId, proposal.id);

  return db.runTransaction(async (transaction) => {
    const [projectSnap, jobSnap] = await Promise.all([transaction.get(project), transaction.get(job)]);
    if (!projectSnap.exists) throw new DirectingStoreError("not_found");
    if (
      !jobSnap.exists
      || jobSnap.get("proposalId") !== proposal.id
      || jobSnap.get("version") !== proposal.version
    ) {
      throw new DirectingStoreError("invalid_job");
    }

    const currentProposalId = projectSnap.get("currentProposalId") as string | null | undefined;
    let publish = currentProposalId === undefined || currentProposalId === null || currentProposalId === proposal.id;
    if (!publish && currentProposalId) {
      const currentSnap = await transaction.get(proposalRef(db, proposal.projectId, currentProposalId));
      const current = parseStoredProposal(currentSnap.data());
      if (!current) throw new DirectingStoreError("invalid_proposal");
      publish = (jobSnap.get("version") as number) > current.version;
    }

    transaction.set(destination, { ...proposal, jobId: input.jobId, createdAt: input.createdAt });
    if (publish) {
      transaction.update(project, {
        currentProposalId: proposal.id,
        acceptedProposalId: projectSnap.get("acceptedProposalId") ?? null,
      });
    }
    return publish ? "published" : "stale";
  });
}

/**
 * Clones the current proposal inside Firestore. This path deliberately has no
 * model dependency: selection changes are deterministic record revisions.
 */
export async function reviseConstraints(
  db: Firestore,
  input: {
    userId: string;
    projectId: string;
    proposalId: string;
    constraints: ProposalConstraints;
    createdAt: number;
  },
): Promise<StoryProposal> {
  const project = projectRef(db, input.projectId);
  const sourceRef = proposalRef(db, input.projectId, input.proposalId);
  const destination = project.collection("storyProposals").doc();

  return db.runTransaction(async (transaction) => {
    const [projectSnap, sourceSnap] = await Promise.all([
      transaction.get(project),
      transaction.get(sourceRef),
    ]);
    if (!projectSnap.exists || projectSnap.get("userId") !== input.userId || !sourceSnap.exists) {
      throw new DirectingStoreError("not_found");
    }
    if (projectSnap.get("currentProposalId") !== input.proposalId) {
      throw new DirectingStoreError("stale_proposal");
    }

    const source = parseStoredProposal(sourceSnap.data());
    if (!source || source.projectId !== input.projectId) {
      throw new DirectingStoreError("invalid_proposal");
    }
    const candidate = StoryProposalSchema.safeParse({
      ...source,
      id: destination.id,
      parentProposalId: source.id,
      state: "draft",
      version: source.version + 1,
      constraints: input.constraints,
    });
    if (!candidate.success) throw new DirectingStoreError("invalid_proposal");

    transaction.set(destination, { ...candidate.data, jobId: null, createdAt: input.createdAt });
    transaction.update(project, { currentProposalId: destination.id });
    return candidate.data;
  });
}

export async function acceptProposal(
  db: Firestore,
  input: { userId: string; projectId: string; proposalId: string },
): Promise<StoryProposal> {
  const project = projectRef(db, input.projectId);
  const proposalDocument = proposalRef(db, input.projectId, input.proposalId);
  return db.runTransaction(async (transaction) => {
    const [projectSnap, proposalSnap] = await Promise.all([
      transaction.get(project),
      transaction.get(proposalDocument),
    ]);
    if (!projectSnap.exists || projectSnap.get("userId") !== input.userId || !proposalSnap.exists) {
      throw new DirectingStoreError("not_found");
    }
    if (projectSnap.get("currentProposalId") !== input.proposalId) {
      throw new DirectingStoreError("stale_proposal");
    }

    const proposal = parseStoredProposal(proposalSnap.data());
    if (!proposal || proposal.projectId !== input.projectId) {
      throw new DirectingStoreError("invalid_proposal");
    }
    const accepted: StoryProposal = { ...proposal, state: "accepted" };
    if (proposal.state !== "accepted") transaction.update(proposalDocument, { state: "accepted" });
    if (projectSnap.get("acceptedProposalId") !== input.proposalId) {
      transaction.update(project, { acceptedProposalId: input.proposalId });
    }
    return accepted;
  });
}

export async function readProposal(
  db: Firestore,
  input: { userId: string; projectId: string; proposalId: string },
): Promise<StoryProposal | null> {
  const [projectSnap, proposalSnap] = await db.getAll(
    projectRef(db, input.projectId),
    proposalRef(db, input.projectId, input.proposalId),
  );
  if (!projectSnap.exists || projectSnap.get("userId") !== input.userId || !proposalSnap.exists) return null;
  const proposal = parseStoredProposal(proposalSnap.data());
  return proposal?.projectId === input.projectId ? proposal : null;
}
