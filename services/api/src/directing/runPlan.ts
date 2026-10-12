import type { ProposalConstraints, StoryProposal } from "@mosae/contracts";
import { assembleProposal, type ProposalSubmission } from "./assemble.js";
import {
  Budget,
  BudgetExhausted,
  type PlanBudgetKind,
  type PlanBudgetLimits,
  type PlanBudgetUsage,
} from "./budget.js";
import { createPlanningTools, planningToolDeclarations } from "./tools.js";
import { validateProposal } from "./validateProposal.js";
import { buildWorkingSet, MustIncludeConflict, resolveFocusShots, type WorkingSet, type WorkingShot } from "./workingSet.js";

export type PlanningProgress = "searching" | "inspecting" | "organizing";
export type PlanningTools = ReturnType<typeof createPlanningTools>;
export type PlanningToolName = "searchShots" | "getShotDetails" | "getTranscript";
export type DeadlineOperation = "progress" | "model" | "tool";

export type DeadlineScheduler = {
  set(callback: () => void, delayMs: number, operation: DeadlineOperation): unknown;
  clear(handle: unknown): void;
};

export type PlanJob = {
  id: string;
  projectId: string;
  proposalId: string;
  storyIntentId: string;
  version: number;
  parentProposalId: string | null;
  intent: { text: string; focus: string[] };
  constraints: ProposalConstraints;
  shots: WorkingShot[];
  parentProposal?: Pick<StoryProposal, "moments"> | null;
  workingSetCap?: number;
  castSummary?: string;
  daySummary?: string;
  /** shotId → day title, so chapters are named by day in code. */
  dayTitles?: Map<string, string>;
  leftOut?: { shotId: string; reason: string }[];
  autoExcludedShotIds?: string[];
};

export type PlanMessage = {
  role: "user" | "assistant" | "tool";
  content: string;
  toolCallId?: string;
  isError?: boolean;
};

export type PlanToolCall = {
  id?: string;
  name: PlanningToolName;
  input: unknown;
};

export type PlanModelOutput =
  | { type: "tool_calls"; calls: PlanToolCall[] }
  | { type: "submit"; submission: ProposalSubmission };

export type PlanModelInput = {
  messages: PlanMessage[];
  toolDeclarations: typeof planningToolDeclarations;
};

export type PlanningModel = {
  runTurn(input: PlanModelInput): Promise<PlanModelOutput>;
};

export type RunPlanDeps = {
  model: PlanningModel;
  tools: PlanningTools;
  updateProgress?: (jobId: string, progress: PlanningProgress) => void | Promise<void>;
  budgetLimits?: Partial<PlanBudgetLimits>;
  now?: () => number;
  deadlineScheduler?: DeadlineScheduler;
};

export type PlanResult =
  | { ok: true; proposal: StoryProposal; usage: PlanBudgetUsage; submission?: ProposalSubmission }
  | {
    ok: false;
    code: "validation_failed";
    retryable: true;
    reason: string;
    diagnostics: string[];
    usage: PlanBudgetUsage;
  }
  | {
    ok: false;
    code: "constraints_conflict";
    retryable: false;
    reason: string;
    diagnostics: string[];
    usage: PlanBudgetUsage;
  }
  | {
    ok: false;
    code: "budget_exhausted";
    retryable: true;
    reason: string;
    budget: PlanBudgetKind;
    diagnostics: string[];
    usage: PlanBudgetUsage;
  };

function constraintShotIds(job: PlanJob): string[] {
  const parentShots = new Map((job.parentProposal?.moments ?? []).map((moment) => [moment.id, moment.shotId]));
  return job.constraints.mustIncludeMomentIds.map((reference) => parentShots.get(reference) ?? reference);
}

function initialPrompt(job: PlanJob, catalog: string[]): string {
  return [
    "Build a story proposal using only literal shot ids from the working set.",
    `Intent: ${job.intent.text}`,
    `Focus: ${JSON.stringify(job.intent.focus)}`,
    ...(job.castSummary ? [`Cast: ${job.castSummary}`] : []),
    ...(job.daySummary ? [job.daySummary] : []),
    "Keep every moment worth keeping; the film's length is chosen later.",
    "Also recommend the film's cadence (one of tender, reflective, playful, energetic, celebratory) from the photos' mood, with a short reason.",
    "Supply directionRecommendation: one short recommendation (1–300 characters) grounded in the user's stated story and observed media, suggesting the direction's mood or pace.",
    "Do not guess occasions, relationships, locations, or the duration of an occasion. Dates are factual context only and cannot establish a trip. Use neutral wording when evidence is weak: For these moments, I’d suggest this.",
    `Carried constraints: ${JSON.stringify(job.constraints)}`,
    `Prior feedback: ${JSON.stringify(job.constraints.feedback)}`,
    "Working set:",
    ...catalog,
  ].join("\n");
}

function serialized(value: unknown): string {
  try {
    const json = JSON.stringify(value);
    return json === undefined ? String(value) : json;
  } catch {
    return String(value);
  }
}

async function executeTool(tools: PlanningTools, call: PlanToolCall): Promise<unknown> {
  switch (call.name) {
    case "searchShots":
      return tools.searchShots(call.input as Parameters<PlanningTools["searchShots"]>[0]);
    case "getShotDetails":
      return tools.getShotDetails(call.input as Parameters<PlanningTools["getShotDetails"]>[0]);
    case "getTranscript":
      return tools.getTranscript(call.input as Parameters<PlanningTools["getTranscript"]>[0]);
    default:
      throw new Error(`unknown planning tool ${String(call.name)}`);
  }
}

/**
 * The working set is capped, but the tools search the whole project, so a
 * correct search result can fall outside it. Validating against the working set
 * alone would reject that shot and spend the single repair undoing a correct
 * answer. Admit the union instead: tool results are project-scoped and
 * eligibility-filtered inside the tool, so the model still cannot invent a
 * shot. Working-set entries win on id collision.
 */
function admissibleSet(workingSet: WorkingSet, tools: PlanningTools): WorkingSet {
  const shots = new Map<string, WorkingShot>();
  for (const shot of workingSet.shots) shots.set(shot.id, shot);
  for (const shot of tools.returnedShots()) if (!shots.has(shot.id)) shots.set(shot.id, shot);
  return { shots: [...shots.values()], lines: workingSet.lines };
}

/** Ensure every eligible catalog asset is represented after Gemini has supplied the story structure. */
function completeSubmission(submission: ProposalSubmission, shots: WorkingShot[], excludedShotIds: string[]): ProposalSubmission {
  const excluded = new Set(excludedShotIds);
  const moments = submission.moments.filter((moment) => !excluded.has(moment.shotId));
  const known = new Set(moments.map((moment) => moment.shotId));
  const shotById = new Map(shots.map((shot) => [shot.id, shot]));
  const chapters = submission.chapters.map((chapter) => ({ ...chapter, momentIds: chapter.momentIds.filter((id) => !excluded.has(id)) }));
  for (const shot of shots) {
    if (known.has(shot.id) || !shot.analysis || shot.dupOf || shot.analysis.kind === "video" && !shot.analysis.usable) continue;
    let chapter = chapters.find((candidate) => candidate.momentIds.some((id) => {
      const peer = shotById.get(id);
      return peer && ((shot.eventId && peer.eventId === shot.eventId) || (shot.day && peer.day === shot.day));
    }));
    if (!chapter && chapters.length) {
      const timestamp = shot.localTime ? Date.parse(shot.localTime) : NaN;
      const ranked = chapters.map((candidate, index) => {
        const peerTimes = candidate.momentIds.map((id) => shotById.get(id)?.localTime).filter((value): value is string => Boolean(value)).map(Date.parse).filter(Number.isFinite);
        const distance = Number.isFinite(timestamp) && peerTimes.length ? Math.min(...peerTimes.map((peerTime) => Math.abs(peerTime - timestamp))) : Infinity;
        return { candidate, index, distance };
      }).sort((a, b) => a.distance - b.distance || a.index - b.index);
      chapter = ranked[0]?.candidate;
    }
    chapter ??= chapters[0];
    if (!chapter) continue;
    const isVideo = shot.analysis.kind === "video";
    const start = shot.sourceStartSec ?? 0;
    const end = shot.sourceEndSec ?? (shot.durationSec ?? 0);
    moments.push({ shotId: shot.id, kind: shot.analysis.kind, title: isVideo ? "A moment" : "A photo", description: "", rationale: "Included to keep every usable memory in the film.", ...(isVideo && end > start ? { previewInSec: start, previewOutSec: end } : {}) });
    chapter.momentIds.push(shot.id);
    known.add(shot.id);
  }
  return { ...submission, moments, chapters };
}

function budgetReason(kind: PlanBudgetKind): string {
  const resource = kind === "model_turns" ? "model turns" : kind === "tool_calls" ? "tool calls" : "time";
  return `Planning used its available ${resource}. Please try again.`;
}

const defaultDeadlineScheduler: DeadlineScheduler = {
  set: (callback, delayMs) => setTimeout(callback, delayMs),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

async function withinDeadline<T>(
  budget: Budget,
  scheduler: DeadlineScheduler,
  operation: DeadlineOperation,
  run: () => Promise<T> | T,
): Promise<T> {
  budget.assertWithinLimits();
  const pending = Promise.resolve().then(run);
  let handle: unknown;
  const expired = new Promise<never>((_resolve, reject) => {
    handle = scheduler.set(
      () => reject(new BudgetExhausted("elapsed_time", budget.limits.elapsedMs)),
      budget.remainingElapsedMs(),
      operation,
    );
  });
  try {
    const result = await Promise.race([pending, expired]);
    budget.assertWithinLimits();
    return result;
  } finally {
    scheduler.clear(handle);
  }
}

/** Run a bounded planning conversation without granting repair a second allowance. */
export async function runPlan(job: PlanJob, deps: RunPlanDeps): Promise<PlanResult> {
  const budget = new Budget(deps.budgetLimits, deps.now);
  const deadlineScheduler = deps.deadlineScheduler ?? defaultDeadlineScheduler;
  const excludedShotIds = [...new Set([...job.constraints.excludedShotIds, ...(job.autoExcludedShotIds ?? [])])];
  const mustIncludeShotIds = [
    ...constraintShotIds(job),
    // Focus characters are resolved to shot ids against the working set's own
    // shots and forced into mustInclude, so a model-driven plan cannot omit a
    // focus character's shot any more than it could omit an explicit one —
    // except a photo already left out: the focus never forces one back.
    ...resolveFocusShots(job.shots, job.constraints.focusCharacterIds ?? []).filter((id) => !excludedShotIds.includes(id)),
  ];
  let workingSet: WorkingSet;
  try {
    workingSet = buildWorkingSet(job.shots, {
      cap: job.workingSetCap ?? job.shots.length,
      excludedShotIds,
      mustIncludeShotIds,
    });
  } catch (error) {
    // The constraints contradict each other, so no model turn can help. Fail
    // before spending one, with a reason the user can act on.
    if (!(error instanceof MustIncludeConflict)) throw error;
    return {
      ok: false,
      code: "constraints_conflict",
      retryable: false,
      reason: error.message,
      diagnostics: error.diagnostics,
      usage: budget.snapshot(),
    };
  }
  const messages: PlanMessage[] = [{ role: "user", content: initialPrompt(job, workingSet.lines) }];
  let repairCount = 0;
  let diagnostics: string[] = [];

  const progress = async (value: PlanningProgress): Promise<void> => {
    if (!deps.updateProgress) {
      budget.assertWithinLimits();
      return;
    }
    await withinDeadline(budget, deadlineScheduler, "progress", () => deps.updateProgress!(job.id, value));
  };

  const repairOrFailure = (output: PlanModelOutput, nextDiagnostics: string[]): PlanResult | undefined => {
    diagnostics = nextDiagnostics;
    budget.assertWithinLimits();
    if (repairCount === 1) {
      return {
        ok: false,
        code: "validation_failed",
        retryable: true,
        reason: "We couldn't build a valid story plan after one repair. Please try again.",
        diagnostics,
        usage: budget.snapshot(),
      };
    }
    repairCount += 1;
    messages.push({ role: "assistant", content: serialized(output) });
    messages.push({
      role: "user",
      content: `Your proposal failed validation. Repair every issue and submit again:\n${diagnostics.join("\n")}`,
    });
    return undefined;
  };

  try {
    await progress("searching");
    while (true) {
      budget.spendModelTurn();
      const output = await withinDeadline(
        budget,
        deadlineScheduler,
        "model",
        () => deps.model.runTurn({ messages: [...messages], toolDeclarations: planningToolDeclarations }),
      );

      if (output.type === "tool_calls") {
        messages.push({ role: "assistant", content: serialized(output) });
        for (const [index, call] of output.calls.entries()) {
          budget.spendToolCall();
          await progress(call.name === "searchShots" ? "searching" : "inspecting");
          const toolCallId = call.id ?? `turn-${budget.snapshot().modelTurns}-tool-${index + 1}`;
          try {
            const result = await withinDeadline(
              budget,
              deadlineScheduler,
              "tool",
              () => executeTool(deps.tools, call),
            );
            messages.push({ role: "tool", toolCallId, content: serialized(result) });
          } catch (error) {
            if (error instanceof BudgetExhausted) throw error;
            messages.push({
              role: "tool",
              toolCallId,
              isError: true,
              content: error instanceof Error ? error.message : String(error),
            });
          }
        }
        continue;
      }

      await progress("organizing");
      // The model may prioritize scenes; fill eligible catalog shots before
      // checking minimum coverage so small albums don't fail for omissions.
      const admissible = admissibleSet(workingSet, deps.tools);
      const completedSubmission = completeSubmission(output.submission, admissible.shots, excludedShotIds);
      const validation = validateProposal(completedSubmission, admissible, {
        excludedShotIds,
        mustIncludeShotIds,
        dayChapters: Boolean(job.daySummary),
      });
      if (!validation.ok) {
        console.warn("story plan validation failed", { jobId: job.id, proposalId: job.proposalId, diagnostics: validation.diagnostics });
        const failure = repairOrFailure(output, validation.diagnostics);
        if (failure) return failure;
        continue;
      }

      let proposal: StoryProposal;
      try {
        proposal = assembleProposal(completedSubmission, {
          proposalId: job.proposalId,
          projectId: job.projectId,
          storyIntentId: job.storyIntentId,
          version: job.version,
          parentProposalId: job.parentProposalId,
          constraints: job.constraints,
          parentProposal: job.parentProposal,
          leftOut: job.leftOut,
          dayTitles: job.dayTitles,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const failure = repairOrFailure(output, [
          `schema_submission: ${message}. Correct the submission so every required field and reference satisfies the proposal schema.`,
        ]);
        if (failure) return failure;
        continue;
      }
      budget.assertWithinLimits();
      return { ok: true, proposal, usage: budget.snapshot(), submission: output.submission };
    }
  } catch (error) {
    if (!(error instanceof BudgetExhausted)) throw error;
    return {
      ok: false,
      code: "budget_exhausted",
      retryable: true,
      reason: budgetReason(error.budget),
      budget: error.budget,
      diagnostics,
      usage: budget.snapshot(),
    };
  }
}
