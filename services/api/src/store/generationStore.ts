import type { Firestore } from "firebase-admin/firestore";
import { GenerationSchema, type Generation } from "@mosae/contracts";
import { stripUndefined } from "./firestoreValue.js";

export class StoreError extends Error {
  constructor(public code: "not_found" | "forbidden" | "validation_error") {
    super(code);
  }
}

const generationsRef = (db: Firestore, projectId: string) =>
  db.collection("projects").doc(projectId).collection("generations");

const generationRef = (db: Firestore, projectId: string, generationId: string) =>
  generationsRef(db, projectId).doc(generationId);

/** Create a new generation in composing state. */
export async function createGeneration(
  db: Firestore,
  input: {
    userId: string;
    projectId: string;
    proposalId: string;
    parentGenerationId: string | null;
    settings: Generation["settings"];
    seed: string;
    now: number;
  },
): Promise<Generation> {
  // Verify ownership
  const projectSnap = await db.collection("projects").doc(input.projectId).get();
  if (!projectSnap.exists || projectSnap.get("userId") !== input.userId) {
    throw new StoreError("forbidden");
  }

  // `.doc("")` is not an auto id — it is an invalid path. `.doc()` is.
  const ref = generationsRef(db, input.projectId).doc();
  const id = ref.id;
  const generation: Generation = {
    schemaVersion: 1,
    id,
    projectId: input.projectId,
    proposalId: input.proposalId,
    parentGenerationId: input.parentGenerationId,
    settings: input.settings,
    seed: input.seed,
    status: "composing",
    timeline: null,
    droppedPicks: [],
    failureReasons: [],
    outputPath: null,
    renderProgress: 0,
  };

  const batch = db.batch();
  batch.set(ref, generation);
  // The request pointer moves the moment a generation is asked for, whatever
  // becomes of it; the playable and saved pointers only move on success.
  batch.update(db.collection("projects").doc(input.projectId), { latestRequestedGenerationId: id });
  await batch.commit();
  return generation;
}

/** Get a generation by ID. Returns null if not found or not owned. */
export async function getGeneration(
  db: Firestore,
  userId: string,
  projectId: string,
  generationId: string,
): Promise<Generation | null> {
  const snap = await generationRef(db, projectId, generationId).get();
  if (!snap.exists) return null;

  // Verify ownership by checking parent project
  const projectSnap = await db.collection("projects").doc(projectId).get();
  if (!projectSnap.exists || projectSnap.get("userId") !== userId) {
    return null;
  }

  return snap.data() as Generation;
}

/** Publish a generation: set timeline, move pointer if newer. */
export async function publishGeneration(
  db: Firestore,
  input: {
    userId: string;
    projectId: string;
    generationId: string;
    timeline: Generation["timeline"];
    droppedPicks: string[];
    leftOut?: { shotId: string; reason: string }[];
    reasons?: string[];
    settings?: Generation["settings"];
    now: number;
  },
): Promise<Generation> {
  const genRef = generationRef(db, input.projectId, input.generationId);

  return db.runTransaction(async (tx) => {
    // Verify ownership
    const projectSnap = await tx.get(db.collection("projects").doc(input.projectId));
    if (!projectSnap.exists || projectSnap.get("userId") !== input.userId) {
      throw new StoreError("forbidden");
    }

    // Get current generation
    const genSnap = await tx.get(genRef);
    if (!genSnap.exists) throw new StoreError("not_found");

    const editsRef = genRef.collection("edits").doc("current");
    const editsSnap = await tx.get(editsRef);

    const existing = genSnap.data() as Generation;

    const proposalRef = db.collection("projects").doc(input.projectId).collection("storyProposals").doc(existing.proposalId);
    const proposalSnap = input.leftOut === undefined ? null : await tx.get(proposalRef);

    // Only allow publishing from composing state
    if (existing.status !== "composing") {
      throw new Error(`cannot publish generation in status ${existing.status}`);
    }

    // Validate timeline against schema
    const parsed = GenerationSchema.safeParse({ ...existing, settings: input.settings ?? existing.settings, timeline: input.timeline, droppedPicks: input.droppedPicks, reasons: input.reasons, status: "playable" });
    if (!parsed.success) {
      throw new Error(`generation validation failed: ${parsed.error.issues.map(i => i.message).join("; ")}`);
    }

    // Update generation
    const updated: Generation = {
      ...existing,
      settings: input.settings ?? existing.settings,
      // Admin Firestore rejects undefined nested values; omit them after
      // schema validation so optional generated fields stay optional.
      timeline: stripUndefined(input.timeline),
      droppedPicks: input.droppedPicks,
      ...(input.reasons ? { reasons: input.reasons } : {}),
      status: "playable",
      composedEditRevision: Number(editsSnap.get("revision") ?? 0),
    };
    tx.set(genRef, updated);
    if (proposalSnap?.exists && input.leftOut !== undefined) {
      const prior = proposalSnap.get("leftOut");
      const retained = Array.isArray(prior) ? prior.filter((entry): entry is { shotId: string; reason: string } =>
        !!entry && typeof entry === "object" && typeof (entry as { shotId?: unknown }).shotId === "string"
        && typeof (entry as { reason?: unknown }).reason === "string" && (entry as { reason: string }).reason !== "didn't fit the length") : [];
      const lengthLeftOut = [...retained, ...input.leftOut.filter((entry) => entry.reason === "didn't fit the length")];
      tx.update(proposalRef, { leftOut: lengthLeftOut });
    }

    // A late-finishing older composition must not displace a newer film. Auto
    // ids do not sort by time, so recency is read from the request pointer the
    // creation wrote, which is the only record of what was asked for last.
    const latestRequestedId = projectSnap.get("latestRequestedGenerationId") as string | null | undefined;
    if (latestRequestedId && latestRequestedId !== input.generationId) {
      return updated;
    }

    tx.update(db.collection("projects").doc(input.projectId), {
      currentPlayableGenerationId: input.generationId,
    });

    return updated;
  });
}

/** Fail a generation permanently. */
export async function failGeneration(
  db: Firestore,
  input: {
    userId: string;
    projectId: string;
    generationId: string;
    reasons: string[];
  },
): Promise<Generation> {
  const genRef = generationRef(db, input.projectId, input.generationId);

  return db.runTransaction(async (tx) => {
    // Verify ownership
    const projectSnap = await tx.get(db.collection("projects").doc(input.projectId));
    if (!projectSnap.exists || projectSnap.get("userId") !== input.userId) {
      throw new StoreError("forbidden");
    }

    const genSnap = await tx.get(genRef);
    if (!genSnap.exists) throw new StoreError("not_found");

    const existing = genSnap.data() as Generation;

    // Only allow failing from composing or rendering state
    if (existing.status !== "composing" && existing.status !== "rendering") {
      throw new Error(`cannot fail generation in status ${existing.status}`);
    }

    const updated: Generation = {
      ...existing,
      status: "failed",
      failureReasons: input.reasons,
    };
    tx.set(genRef, updated);

    return updated;
  });
}

/** Update render progress for a generation. */
export async function setRenderProgress(
  db: Firestore,
  input: {
    userId: string;
    projectId: string;
    generationId: string;
    progress: number; // 0-1
  },
): Promise<Generation> {
  const genRef = generationRef(db, input.projectId, input.generationId);

  return db.runTransaction(async (tx) => {
    // Verify ownership
    const projectSnap = await tx.get(db.collection("projects").doc(input.projectId));
    if (!projectSnap.exists || projectSnap.get("userId") !== input.userId) {
      throw new StoreError("forbidden");
    }

    const genSnap = await tx.get(genRef);
    if (!genSnap.exists) throw new StoreError("not_found");

    const existing = genSnap.data() as Generation;

    // Only allow updating from rendering state
    if (existing.status !== "rendering") {
      throw new Error(`cannot update progress for generation in status ${existing.status}`);
    }

    const clampedProgress = Math.max(0, Math.min(1, input.progress));
    const updated: Generation = {
      ...existing,
      renderProgress: clampedProgress,
    };
    tx.set(genRef, updated);

    return updated;
  });
}

/** Mark a generation as saved (render complete). */
export async function markSaved(
  db: Firestore,
  input: {
    userId: string;
    projectId: string;
    generationId: string;
    outputPath: string;
  },
): Promise<Generation> {
  const genRef = generationRef(db, input.projectId, input.generationId);

  return db.runTransaction(async (tx) => {
    // Verify ownership
    const projectSnap = await tx.get(db.collection("projects").doc(input.projectId));
    if (!projectSnap.exists || projectSnap.get("userId") !== input.userId) {
      throw new StoreError("forbidden");
    }

    const genSnap = await tx.get(genRef);
    if (!genSnap.exists) throw new StoreError("not_found");

    const existing = genSnap.data() as Generation;

    // Only allow marking saved from rendering state with progress 1
    if (existing.status !== "rendering" || existing.renderProgress < 1) {
      throw new Error(`cannot mark saved: status=${existing.status}, progress=${existing.renderProgress}`);
    }

    const updated: Generation = {
      ...existing,
      status: "saved",
      outputPath: input.outputPath,
      renderProgress: 1,
      savedAt: Date.now(),
    };
    tx.set(genRef, updated);
    tx.update(db.collection("projects").doc(input.projectId), {
      savedGenerationId: input.generationId,
    });

    return updated;
  });
}

/**
 * Give a film back after a render that did not finish.
 *
 * `startRender` accepts only a `playable` generation, so a generation left in
 * `rendering` can never be rendered again and never be retried — pressing Save
 * once would brick the film permanently, with `/download` refusing forever.
 * This is the way out: the status goes back to `playable`, the progress resets,
 * and the reason is recorded on the generation. No pointer moves, because the
 * film itself never stopped working.
 */
export async function resetRender(
  db: Firestore,
  input: { userId: string; projectId: string; generationId: string; reasons: string[] },
): Promise<Generation> {
  const genRef = generationRef(db, input.projectId, input.generationId);

  return db.runTransaction(async (tx) => {
    const projectSnap = await tx.get(db.collection("projects").doc(input.projectId));
    if (!projectSnap.exists || projectSnap.get("userId") !== input.userId) {
      throw new StoreError("forbidden");
    }

    const genSnap = await tx.get(genRef);
    if (!genSnap.exists) throw new StoreError("not_found");

    const existing = genSnap.data() as Generation;
    if (existing.status !== "rendering") {
      throw new Error(`cannot reset a render in status ${existing.status}`);
    }

    const updated: Generation = {
      ...existing,
      status: "playable",
      renderProgress: 0,
      failureReasons: input.reasons,
    };
    tx.set(genRef, updated);
    return updated;
  });
}

/** Begin a render. Only a playable film can be rendered, and only once at a time. */
export async function startRender(
  db: Firestore,
  input: { userId: string; projectId: string; generationId: string },
): Promise<Generation> {
  const genRef = generationRef(db, input.projectId, input.generationId);

  return db.runTransaction(async (tx) => {
    const projectSnap = await tx.get(db.collection("projects").doc(input.projectId));
    if (!projectSnap.exists || projectSnap.get("userId") !== input.userId) {
      throw new StoreError("forbidden");
    }

    const genSnap = await tx.get(genRef);
    if (!genSnap.exists) throw new StoreError("not_found");

    const existing = genSnap.data() as Generation;
    if (existing.status !== "playable") {
      throw new Error(`cannot render generation in status ${existing.status}`);
    }

    // A retry starts clean: the reasons a previous render gave back with are
    // not this render's.
    const updated: Generation = { ...existing, status: "rendering", renderProgress: 0, failureReasons: [] };
    tx.set(genRef, updated);
    return updated;
  });
}
