import type { Firestore } from "firebase-admin/firestore";
import { GenerationSchema, type Generation } from "@mosae/contracts";

export class StoreError extends Error {
  constructor(public code: "not_found" | "forbidden" | "validation_error") {
    super(code);
  }
}

const generationRef = (db: Firestore, projectId: string, generationId: string) =>
  db.collection("projects").doc(projectId).collection("generations").doc(generationId);

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

  const ref = generationRef(db, input.projectId, "");
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

  await ref.set(generation);
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

    const existing = genSnap.data() as Generation;

    // Only allow publishing from composing state
    if (existing.status !== "composing") {
      throw new Error(`cannot publish generation in status ${existing.status}`);
    }

    // Validate timeline against schema
    const parsed = GenerationSchema.safeParse({ ...existing, timeline: input.timeline, droppedPicks: input.droppedPicks, status: "playable" });
    if (!parsed.success) {
      throw new Error(`generation validation failed: ${parsed.error.issues.map(i => i.message).join("; ")}`);
    }

    // Update generation
    const updated: Generation = {
      ...existing,
      timeline: input.timeline,
      droppedPicks: input.droppedPicks,
      status: "playable",
    };
    tx.set(genRef, updated);

    // Conditional pointer write: only if this generation is newer than current
    const projectDoc = await tx.get(db.collection("projects").doc(input.projectId));
    const currentPlayableId = projectDoc.get("currentPlayableGenerationId") as string | null;

    if (currentPlayableId) {
      // Compare timestamps — only update if this generation was created after the current one
      const currentGenSnap = await tx.get(generationRef(db, input.projectId, currentPlayableId));
      if (currentGenSnap.exists) {
        const currentGen = currentGenSnap.data() as Generation;
        // If current is still newer or equal, skip pointer update
        if (existing.id <= currentGen.id) {
          return updated;
        }
      }
    }

    // Move the pointer
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
    };
    tx.set(genRef, updated);

    return updated;
  });
}
