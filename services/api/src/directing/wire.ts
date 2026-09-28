import type { Firestore, DocumentReference } from "firebase-admin/firestore";
import { CADENCES, type CadenceId, type StoryProposal } from "@mosae/contracts";
import { saveProposal, type SaveProposalResult } from "../store/directingStore.js";
import type { Asset } from "../store/finalizeStore.js";
import type { ShotAnalysis } from "../domain/understanding.js";
import type { EmbedContent } from "../understand/embed.js";
import { assembleProposal } from "./assemble.js";
import { createPlanningTools, type PlanningShot } from "./tools.js";
import { runPlan, type PlanJob, type PlanResult, type PlanningModel } from "./runPlan.js";
import { DEFAULT_PLAN_BUDGET_LIMITS, type PlanBudgetLimits } from "./budget.js";
import { validateProposal } from "./validateProposal.js";
import { buildWorkingSet, MustIncludeConflict, type WorkingSet } from "./workingSet.js";
import { cacheKeyFor, constraintShotIds, type ProposalCache } from "./proposalCache.js";
import { z } from "zod";
import { estimateUsd, MODELS, type GenerateDeps } from "../gemini/client.js";
import { createEmbedClient, createGeminiClient, geminiConfigured, recordUsageToLog } from "../gemini/wire.js";
import { ensureCast } from "../cast/ensureCast.js";
import { daySummary, dayTitles, tripDays } from "./days.js";
import { leaveOutShots } from "../cast/leaveOut.js";
import type { PhotoAnalysis } from "../domain/understanding.js";

export const MAX_PLAN_ATTEMPTS = 3;
export const PLAN_LEASE_MS = DEFAULT_PLAN_BUDGET_LIMITS.elapsedMs + 60_000;
export type PlanTask = { projectId: string; jobId: string; generation: string };
export type PlanTaskResult = SaveProposalResult | "skipped" | "failed";

type StoredJob = Pick<PlanJob, "proposalId" | "storyIntentId" | "version" | "parentProposalId"> & {
  id: string;
  projectId: string;
  type: "plan";
  status: string;
  attempts: number;
  pinnedInputs: Pick<PlanJob, "intent" | "constraints">;
  completedResult?: Extract<PlanResult, { ok: true }>;
};

type Publish = (input: Parameters<typeof saveProposal>[1]) => Promise<SaveProposalResult>;

export type PlanConfig = {
  db: Firestore;
  storageBucket?: string;
  geminiApiKey?: string;
  model?: PlanningModel;
  embedContent?: EmbedContent;
  now?: () => number;
  budgetLimits?: Partial<PlanBudgetLimits>;
  publish?: Publish;
  /** Cache of published submissions, keyed by intent + working set. */
  cache?: ProposalCache;
};

/** Joins shots to their current asset generation; old generation analysis is never eligible. */
async function loadCatalog(db: Firestore, projectId: string): Promise<{ shots: PlanningShot[]; assets: Map<string, Asset> }> {
  const project = db.collection("projects").doc(projectId);
  const [shotSnaps, assetSnaps] = await Promise.all([
    project.collection("shots").get(), project.collection("assets").get(),
  ]);
  const assets = new Map(assetSnaps.docs.map((doc) => [doc.id, doc.data() as Asset]));
  const shots: PlanningShot[] = [];
  for (const doc of shotSnaps.docs) {
    const assetId = doc.get("assetId") as string;
    const asset = assets.get(assetId);
    if (!asset || asset.generation !== doc.get("assetGeneration")) continue;
    const analysis = doc.get("analysis") as ShotAnalysis | null | undefined;
    const start = doc.get("sourceStartSec") as number | null;
    const end = doc.get("sourceEndSec") as number | null;
    const vector = doc.get("embedding") as { toArray(): number[] } | null | undefined;
    shots.push({
      id: doc.id, projectId, assetId, assetStatus: asset.status,
      eventId: asset.eventId ?? null, dupOf: asset.dupOf ?? null,
      day: asset.media?.localTime?.slice(0, 10) ?? null,
      localTime: asset.media?.localTime ?? null,
      place: (asset as Asset & { place?: { name: string } | null }).place?.name ?? null,
      durationSec: start != null && end != null ? end - start : null,
      sourceStartSec: start ?? null, sourceEndSec: end ?? null,
      analysis: analysis ?? null, embedding: vector?.toArray() ?? null,
    });
  }
  return { shots, assets };
}

/**
 * A successful model result is checkpointed before publication. A retry only
 * publishes that immutable checkpoint, even if the prior publish committed but
 * its acknowledgement was lost. Lease tokens fence every worker-owned write.
 */
export function createPlan(config: PlanConfig): (task: PlanTask) => Promise<PlanTaskResult> {
  const { db } = config;
  const now = config.now ?? Date.now;
  const publish = config.publish ?? ((input) => saveProposal(db, input));
  const leaseMs = Math.max(PLAN_LEASE_MS, (config.budgetLimits?.elapsedMs ?? 0) + 60_000);

  return async (task) => {
    const project = db.collection("projects").doc(task.projectId);
    const ref = project.collection("jobs").doc(task.jobId);
    const owner = crypto.randomUUID();
    const acquired = await db.runTransaction(async (tx) => {
      const [jobSnap, projectSnap] = await Promise.all([tx.get(ref), tx.get(project)]);
      if (!jobSnap.exists || !projectSnap.exists) return "skipped" as const;
      const job = jobSnap.data() as StoredJob;
      if (job.type !== "plan" || job.projectId !== task.projectId || String(job.version) !== task.generation) return "skipped" as const;
      if (job.status === "succeeded" || job.status === "failed") return "skipped" as const;
      const at = now();
      if (Number(jobSnap.get("leaseUntil")) > at) return "lease_busy" as const;
      // A checkpoint can be published without another planning attempt.
      if (!job.completedResult) {
        const status = projectSnap.get("status");
        if (status === "failed") {
          tx.update(ref, { status: "failed", code: "project_failed", reason: "This project has no usable media to plan.", leaseUntil: null, leaseOwner: null, updatedAt: at });
          return "failed" as const;
        }
        if (status !== "ready" && status !== "ready_with_errors") {
          tx.update(ref, { status: "waiting_for_ready", leaseUntil: null, leaseOwner: null, updatedAt: at });
          return "waiting_for_ready" as const;
        }
        if (job.attempts >= MAX_PLAN_ATTEMPTS) {
          tx.update(ref, { status: "failed", code: "retries_exhausted", reason: "Planning could not finish after three attempts. Please try again.", leaseUntil: null, leaseOwner: null, updatedAt: at });
          return "failed" as const;
        }
      }
      const attempts = job.attempts + (job.completedResult ? 0 : 1);
      tx.update(ref, { status: job.completedResult ? "publishing" : "running", attempts, leaseOwner: owner, leaseUntil: at + leaseMs, waitForReady: false, updatedAt: at });
      return { ...job, attempts };
    });
    if (acquired === "skipped" || acquired === "failed") return acquired;
    if (acquired === "lease_busy" || acquired === "waiting_for_ready") throw new Error(acquired);

    const ownedUpdate = async (changes: FirebaseFirestore.UpdateData<FirebaseFirestore.DocumentData>, requireLiveLease = true): Promise<void> => {
      await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (snap.get("leaseOwner") !== owner || (requireLiveLease && Number(snap.get("leaseUntil")) <= now())) throw new Error("lease_lost");
        tx.update(ref, { ...changes, updatedAt: now() });
      });
    };
    const release = async (): Promise<void> => {
      await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (snap.get("leaseOwner") === owner) tx.update(ref, { leaseOwner: null, leaseUntil: null, updatedAt: now() });
      });
    };
    let completed = acquired.completedResult;
    try {
      if (!completed) {
        // The cast first: it writes each face's person, and the leave-out filter
        // below reads those from the catalog. Loaded before, a first plan saw
        // every face as a stranger and left out every family photo.
        const ensured = await ensureCast(db, task.projectId, { storageBucket: config.storageBucket });
        const { shots, assets } = await loadCatalog(db, task.projectId);
        const parent = acquired.parentProposalId
          ? await project.collection("storyProposals").doc(acquired.parentProposalId).get()
          : null;
        const constraints = { ...acquired.pinnedInputs.constraints };
        if ((!constraints.focusCharacterIds || constraints.focusCharacterIds.length === 0) && ensured.cast.focus.length > 0) {
          constraints.focusCharacterIds = ensured.cast.focus;
        }
        const leftOut = leaveOutShots(
          shots.filter((shot) => shot.analysis?.kind === "photo").map((shot) => ({
            shotId: shot.id,
            faces: ((shot.analysis as PhotoAnalysis).faces ?? []).map((face) => ({ bbox: face.bbox, personId: face.characterId ?? null, stranger: face.stranger ?? false })),
          })),
          ensured.cast,
          (constraints as typeof constraints & { hiddenShotIds?: string[] }).hiddenShotIds ?? [],
        );
        const autoExcluded = leftOut.map((item) => item.shotId);
        // Only the photos the planner is actually given, so the day list and
        // the working set name the same shots.
        const days = tripDays(shots
          .filter((shot) => !autoExcluded.includes(shot.id) && !constraints.excludedShotIds.includes(shot.id))
          .map((shot) => ({ id: shot.id, day: shot.day ?? null, localTime: shot.localTime, place: shot.place ?? null })));
        const hasDates = days.some((day) => day.date !== null);
        const job: PlanJob = {
          id: task.jobId, projectId: task.projectId,
          proposalId: acquired.proposalId, storyIntentId: acquired.storyIntentId,
          version: acquired.version, parentProposalId: acquired.parentProposalId,
          ...acquired.pinnedInputs, constraints, shots, castSummary: ensured.summary ?? undefined,
          // Only the photos the planner is actually given, so the day list and
          // the working set name the same shots.
          // Without any capture dates the planner chooses its own chapters, as before v2.
          daySummary: hasDates ? daySummary(days) : undefined,
          dayTitles: hasDates ? dayTitles(days) : undefined,
          parentProposal: parent?.exists ? parent.data() as StoryProposal : null,
          leftOut,
          autoExcludedShotIds: autoExcluded,
        };
        // Build the working set once so the cache key and validation agree on
        // exactly which catalog shots are eligible. A must-include conflict is
        // reported by runPlan; here it only means we skip the cache path.
        let workingSet: WorkingSet | null = null;
        try {
          workingSet = buildWorkingSet(job.shots, {
            cap: job.workingSetCap,
            excludedShotIds: [...new Set([...job.constraints.excludedShotIds, ...autoExcluded])],
            mustIncludeMomentIds: constraintShotIds(job),
            focusCharacterIds: job.constraints.focusCharacterIds,
          });
        } catch (error) {
          if (!(error instanceof MustIncludeConflict)) throw error;
        }
        const cacheKey = workingSet ? cacheKeyFor(job, workingSet) : null;
        const cached = cacheKey && config.cache ? await config.cache.get(cacheKey, task.projectId) : null;
        // A replay run reproduces an existing proposal without driving the model
        // again. The working set is built from Firestore shot doc ids, which are
        // stable across plan runs for a project, so a cached submission whose
        // shot references still match can be re-assembled into a fresh, valid
        // proposal with no model call — sidestepping the recorder's inability to
        // replay a self-correcting conversation turn-for-turn.
        if (cached && workingSet) {
          const validation = validateProposal(cached.submission, workingSet, {
            dayChapters: Boolean(job.daySummary),
            excludedShotIds: [...new Set([...job.constraints.excludedShotIds, ...autoExcluded])],
            mustIncludeShotIds: constraintShotIds(job),
          });
          if (validation.ok) {
            try {
              const proposal = assembleProposal(cached.submission, {
                proposalId: job.proposalId,
                projectId: job.projectId,
                storyIntentId: job.storyIntentId,
                version: job.version,
                parentProposalId: job.parentProposalId,
                constraints: job.constraints,
                parentProposal: job.parentProposal,
                leftOut: job.leftOut,
              });
              const cachedResult = { ok: true as const, proposal, usage: { modelTurns: 0, toolCalls: 0, elapsedMs: 0 }, submission: cached.submission };
              await ownedUpdate({ status: "publishing", completedResult: cachedResult, usage: cachedResult.usage, diagnostics: [] });
              completed = cachedResult;
            } catch {
              // A stale cache entry that no longer assembles falls through to a
              // fresh model run rather than failing the job.
            }
          }
        }
        // Construct the SDK only during work, so a missing API key cannot
        // prevent API boot or publication recovery from a saved result.
        const usable = !config.model && geminiConfigured(config.geminiApiKey);
        const unavailable = async (): Promise<never> => { throw new Error("gemini_api_key_missing"); };
        const model = config.model ?? (usable ? createPlanningModel({
          generateContent: createGeminiClient(config.geminiApiKey), recordUsage: recordUsageToLog(db, { projectId: task.projectId }),
        }, task.jobId) : { runTurn: unavailable });
        const tools = createPlanningTools({
          projectId: task.projectId, excludedShotIds: [...new Set([...job.constraints.excludedShotIds, ...autoExcluded])],
          embedContent: config.embedContent ?? (usable ? createEmbedClient(config.geminiApiKey) : unavailable),
          loadShots: async (projectId) => projectId === task.projectId ? shots : [],
          loadAsset: async (projectId, assetId) => {
            const asset = projectId === task.projectId ? assets.get(assetId) : undefined;
            return asset ? { id: assetId, projectId, kind: asset.media?.kind ?? "photo", transcript: asset.transcript ?? null } : null;
          },
        });
        const result = await runPlan(job, {
          model, tools, now, budgetLimits: config.budgetLimits,
          updateProgress: async (_id, progress) => ownedUpdate({ progress }),
        });
        if (!result.ok) {
          const terminal = !result.retryable || acquired.attempts >= MAX_PLAN_ATTEMPTS;
          await ownedUpdate({
            status: terminal ? "failed" : "queued", code: result.retryable && terminal ? "retries_exhausted" : result.code,
            lastError: result.code, reason: result.reason, diagnostics: result.diagnostics, usage: result.usage,
          });
          if (terminal) return "failed";
          throw new Error(result.code);
        }
        await ownedUpdate({ status: "publishing", completedResult: result, usage: result.usage, diagnostics: [] });
        completed = result;
      }
      const publication = await publish({ jobId: task.jobId, proposal: completed.proposal, createdAt: now() });
      await ownedUpdate({ status: "succeeded", progress: null, publication, code: null, lastError: null, reason: null });
      return publication;
    } catch (error) {
      if (!completed) {
        const exhausted = acquired.attempts >= MAX_PLAN_ATTEMPTS;
        if (await recordRunError(db, ref, owner, now(), exhausted, error)) return "failed";
      }
      throw error;
    } finally {
      await release();
    }
  };
}

async function recordRunError(db: Firestore, ref: DocumentReference, owner: string, now: number, exhausted: boolean, error: unknown): Promise<boolean> {
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (snap.get("leaseOwner") !== owner) throw new Error("lease_lost");
    // Preserve structured runPlan diagnostics already written above.
    if (snap.get("status") !== "running") return snap.get("status") === "failed";
    tx.update(ref, {
      status: exhausted ? "failed" : "queued", code: exhausted ? "retries_exhausted" : "plan_failed",
      lastError: error instanceof Error ? error.message : String(error),
      reason: exhausted ? "Planning could not finish after three attempts. Please try again." : "Planning was interrupted. Retrying.", updatedAt: now,
    });
    return exhausted;
  });
}

const SubmissionSchema = z.object({
  title: z.string(),
  moments: z.array(z.object({
    shotId: z.string(), kind: z.enum(["photo", "video"]), title: z.string(), description: z.string(), rationale: z.string(),
    previewInSec: z.number().optional(), previewOutSec: z.number().optional(),
  })),
  chapters: z.array(z.object({ title: z.string(), summary: z.string(), momentIds: z.array(z.string()) })),
  openQuestions: z.array(z.string()),
  recommendedCadence: z.enum(CADENCES.map((c) => c.id) as [CadenceId, ...CadenceId[]]).optional(),
  cadenceReason: z.string().optional(),
});
/**
 * Written out by hand rather than taken from `z.toJSONSchema(ActionSchema)`.
 * A Zod discriminated union becomes `anyOf` + `const`, and Gemini honours
 * neither: it answered `"type": "submission"` against a `const: "submit"`
 * and the whole plan failed to parse. A flat object with a real `enum` is a
 * shape structured output does respect. ActionSchema below stays the
 * gatekeeper, so a wrong answer is still rejected — it just stops being the
 * default one.
 */
const actionResponseSchema = {
  type: "object",
  properties: {
    type: { type: "string", enum: ["submit", "tool_calls"] },
    submission: {
      type: "object",
      properties: {
        title: { type: "string" },
        moments: {
          type: "array",
          items: {
            type: "object",
            properties: {
              shotId: { type: "string" },
              kind: { type: "string", enum: ["photo", "video"] },
              title: { type: "string" },
              description: { type: "string" },
              rationale: { type: "string" },
              previewInSec: { type: "number" },
              previewOutSec: { type: "number" },
            },
            required: ["shotId", "kind", "title", "description", "rationale"],
          },
        },
        chapters: {
          type: "array",
          items: {
            type: "object",
            properties: {
              title: { type: "string" },
              summary: { type: "string" },
              momentIds: { type: "array", items: { type: "string" } },
            },
            required: ["title", "summary", "momentIds"],
          },
        },
        openQuestions: { type: "array", items: { type: "string" } },
        recommendedCadence: { type: "string", enum: CADENCES.map((c) => c.id) },
        cadenceReason: { type: "string" },
      },
      required: ["title", "moments", "chapters", "openQuestions"],
    },
    calls: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          name: { type: "string", enum: ["searchShots", "getShotDetails", "getTranscript"] },
          input: {
            type: "object",
            properties: {
              query: { type: "string" },
              shotIds: { type: "array", items: { type: "string" } },
              assetId: { type: "string" },
              fromSec: { type: "number" },
              toSec: { type: "number" },
              limit: { type: "number" },
            },
          },
        },
        required: ["name", "input"],
      },
    },
  },
  required: ["type"],
};

const ActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("submit"), submission: SubmissionSchema }),
  z.object({ type: z.literal("tool_calls"), calls: z.array(z.object({
    id: z.string().optional(), name: z.enum(["searchShots", "getShotDetails", "getTranscript"]),
    input: z.object({
      query: z.string().optional(), shotIds: z.array(z.string()).optional(), assetId: z.string().optional(),
      fromSec: z.number().optional(), toSec: z.number().optional(), limit: z.number().optional(),
      filters: z.object({ day: z.string().optional(), place: z.string().optional(), eventId: z.string().optional(), kind: z.enum(["photo", "video"]).optional() }).optional(),
    }),
  })) }),
]);

/** One SDK request per runner turn; retries and repairs share runPlan's budget. */
export function createPlanningModel(deps: Pick<GenerateDeps, "generateContent" | "recordUsage">, jobId: string): PlanningModel {
  let turn = 0;
  return { async runTurn(input) {
    turn += 1;
    const started = Date.now();
    let tokens = { promptTokens: 0, candidatesTokens: 0, thoughtsTokens: 0, totalTokens: 0 };
    let failure: string | undefined;
    try {
      const response = await deps.generateContent({
        model: MODELS.story,
        contents: [
          "You are a story director. Return either tool_calls to inspect the catalog or submit with a complete proposal.",
          "Tools only read project data. Use only supplied shot IDs for moments and chapter momentIds; do not invent application IDs.",
          `Available tools: ${JSON.stringify(input.toolDeclarations)}`,
          `Conversation: ${JSON.stringify(input.messages)}`,
        ].join("\n"),
        config: { responseMimeType: "application/json", responseJsonSchema: actionResponseSchema },
      }) as { text?: string; usageMetadata?: Record<string, number> };
      const meta = response.usageMetadata ?? {};
      tokens = { promptTokens: meta.promptTokenCount ?? 0, candidatesTokens: meta.candidatesTokenCount ?? 0, thoughtsTokens: meta.thoughtsTokenCount ?? 0, totalTokens: meta.totalTokenCount ?? 0 };
      return ActionSchema.parse(JSON.parse(response.text ?? ""));
    } catch (error) {
      failure = error instanceof Error ? error.message : String(error);
      throw error;
    } finally {
      await deps.recordUsage({
        stage: "plan", subjectId: jobId, model: MODELS.story, ...tokens,
        latencyMs: Date.now() - started, estimatedUsd: estimateUsd(MODELS.story, tokens), attempt: turn,
        ...(failure ? { error: failure } : {}),
      });
    }
  } };
}
