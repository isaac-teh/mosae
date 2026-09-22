import { describe, expect, it } from "vitest";
import type { ProposalConstraints } from "@mosae/contracts";
import { Budget, BudgetExhausted, DEFAULT_PLAN_BUDGET_LIMITS } from "./budget.js";
import {
  runPlan,
  type PlanJob,
  type PlanModelInput,
  type PlanModelOutput,
  type PlanningProgress,
  type PlanningTools,
} from "./runPlan.js";
import type { ProposalSubmission } from "./assemble.js";
import type { WorkingShot } from "./workingSet.js";

const photo = (id: string): WorkingShot => ({
  id,
  assetStatus: "understood",
  eventId: "event-1",
  day: "2026-05-03",
  place: "Park",
  durationSec: null,
  sourceStartSec: null,
  sourceEndSec: null,
  analysis: {
    kind: "photo",
    caption: `${id} family picnic`,
    subjects: [{ peopleCount: 4, roles: ["family"], attributes: [] }],
    setting: "park",
    activities: ["picnic"],
    mood: "warm",
    shotType: "wide",
    aesthetics: 4,
    keyMomentScore: 4,
    tags: ["family"],
  },
});

const shots = ["p1", "p2", "p3", "p4", "p5"].map(photo);

const validSubmission: ProposalSubmission = {
  title: "A day together",
  moments: shots.map((shot, index) => ({
    shotId: shot.id,
    kind: "photo" as const,
    title: `Moment ${index + 1}`,
    description: `Description ${index + 1}`,
    rationale: `Reason ${index + 1}`,
  })),
  chapters: [
    { title: "Arrival", summary: "The family gathers.", momentIds: ["p1", "p2", "p3"] },
    { title: "Together", summary: "The day settles.", momentIds: ["p4", "p5"] },
  ],
  openQuestions: [],
};

const constraints: ProposalConstraints = {
  excludedShotIds: [],
  deselectedMomentIds: [],
  mustIncludeMomentIds: ["p5"],
  feedback: ["Keep the family warmth."],
};

const job: PlanJob = {
  id: "job-1",
  projectId: "project-1",
  proposalId: "proposal-1",
  storyIntentId: "intent-1",
  version: 1,
  parentProposalId: null,
  intent: { text: "Tell the story of our picnic.", focus: ["family"] },
  constraints,
  targetSec: 25,
  shots,
};

function tools(overrides: Partial<PlanningTools> = {}): PlanningTools {
  return {
    searchShots: async () => ["p1 | photo | 2026-05-03 | Park | | p1 family picnic"],
    getShotDetails: async () => [],
    getTranscript: async () => [],
    ...overrides,
  };
}

function scripted(outputs: PlanModelOutput[]) {
  const inputs: PlanModelInput[] = [];
  return {
    inputs,
    model: {
      async runTurn(input: PlanModelInput): Promise<PlanModelOutput> {
        inputs.push(input);
        const output = outputs[inputs.length - 1];
        if (!output) throw new Error("scripted model ran out of responses");
        return output;
      },
    },
  };
}

function progressRecorder() {
  const progress: PlanningProgress[] = [];
  return {
    progress,
    updateProgress: async (_jobId: string, value: PlanningProgress) => { progress.push(value); },
  };
}

describe("runPlan", () => {
  it("builds context, executes read-only tools, reports coarse progress and returns an assembled proposal", async () => {
    const script = scripted([
      {
        type: "tool_calls",
        calls: [
          { id: "search", name: "searchShots", input: { query: "family picnic" } },
          { id: "details", name: "getShotDetails", input: { shotIds: ["p1"] } },
          { id: "transcript", name: "getTranscript", input: { assetId: "asset-p1" } },
        ],
      },
      { type: "submit", submission: validSubmission },
    ]);
    const recorder = progressRecorder();

    const result = await runPlan(job, { model: script.model, tools: tools(), updateProgress: recorder.updateProgress });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.proposal).toMatchObject({
      id: "proposal-1",
      projectId: "project-1",
      storyIntentId: "intent-1",
      version: 1,
      parentProposalId: null,
      state: "draft",
      title: "A day together",
    });
    expect(result.proposal.moments.map((moment) => moment.shotId)).toEqual(["p1", "p2", "p3", "p4", "p5"]);
    expect(result.usage).toMatchObject({ modelTurns: 2, toolCalls: 3 });
    expect(recorder.progress).toEqual(["searching", "searching", "inspecting", "inspecting", "organizing"]);

    const initial = script.inputs[0];
    expect(initial.messages[0]?.content).toContain("Tell the story of our picnic.");
    expect(initial.messages[0]?.content).toContain("p1 | photo");
    expect(initial.messages[0]?.content).toContain("p5");
    expect(initial.messages[0]?.content).toContain("Keep the family warmth.");
    expect(initial.toolDeclarations.map((tool) => tool.name)).toEqual(["searchShots", "getShotDetails", "getTranscript"]);
  });

  it("appends actionable diagnostics and accepts one repaired submission inside the same budget", async () => {
    const thinSubmission: ProposalSubmission = {
      ...validSubmission,
      moments: validSubmission.moments.slice(0, 4),
      chapters: [
        validSubmission.chapters[0],
        { ...validSubmission.chapters[1], momentIds: ["p3", "p4"] },
      ],
    };
    const script = scripted([
      { type: "submit", submission: thinSubmission },
      { type: "submit", submission: validSubmission },
    ]);

    const result = await runPlan(job, { model: script.model, tools: tools() });

    expect(result.ok).toBe(true);
    expect(script.inputs[1]?.messages.at(-1)?.content).toMatch(/must_include_shots.*p5.*add/i);
    expect(script.inputs[1]?.messages.at(-1)?.content).toMatch(/duration_coverage/i);
    if (result.ok) expect(result.usage.modelTurns).toBe(2);
  });

  it("returns a user-visible non-retryable failure when the one repair is still invalid", async () => {
    const invalid: ProposalSubmission = {
      ...validSubmission,
      moments: validSubmission.moments.slice(0, 2),
      chapters: [{ title: "Thin", summary: "", momentIds: ["p1", "p2"] }],
    };
    const script = scripted([
      { type: "submit", submission: invalid },
      { type: "submit", submission: invalid },
    ]);

    const result = await runPlan(job, { model: script.model, tools: tools() });

    expect(result).toMatchObject({
      ok: false,
      code: "validation_failed",
      retryable: false,
    });
    if (!result.ok) {
      expect(result.reason).toMatch(/couldn't build a valid story plan.*try again/i);
      expect(result.diagnostics.length).toBeGreaterThan(0);
      expect(result.usage.modelTurns).toBe(2);
    }
  });

  it("stops at the default eight model turns and returns a retryable budget failure", async () => {
    const toolTurn: PlanModelOutput = {
      type: "tool_calls",
      calls: [{ name: "searchShots", input: { query: "more" } }],
    };
    const script = scripted(Array.from({ length: 9 }, () => toolTurn));

    const result = await runPlan(job, { model: script.model, tools: tools() });

    expect(result).toMatchObject({ ok: false, code: "budget_exhausted", retryable: true, budget: "model_turns" });
    expect(script.inputs).toHaveLength(DEFAULT_PLAN_BUDGET_LIMITS.modelTurns);
    if (!result.ok) expect(result.usage.modelTurns).toBe(8);
  });

  it("executes only the default 24 tool calls before exhausting the shared tool budget", async () => {
    let executions = 0;
    const script = scripted([{
      type: "tool_calls",
      calls: Array.from({ length: 25 }, (_, index) => ({
        id: `call-${index}`,
        name: "searchShots" as const,
        input: { query: `query ${index}` },
      })),
    }]);

    const result = await runPlan(job, {
      model: script.model,
      tools: tools({ searchShots: async () => { executions += 1; return []; } }),
    });

    expect(result).toMatchObject({ ok: false, code: "budget_exhausted", retryable: true, budget: "tool_calls" });
    expect(executions).toBe(DEFAULT_PLAN_BUDGET_LIMITS.toolCalls);
    if (!result.ok) expect(result.usage.toolCalls).toBe(24);
  });

  it("returns a tool error to the model so a later turn can recover", async () => {
    const script = scripted([
      { type: "tool_calls", calls: [{ id: "bad-detail", name: "getShotDetails", input: { shotIds: ["missing"] } }] },
      { type: "submit", submission: validSubmission },
    ]);

    const result = await runPlan(job, {
      model: script.model,
      tools: tools({ getShotDetails: async () => { throw new Error("shot missing is outside project project-1"); } }),
    });

    expect(result.ok).toBe(true);
    expect(script.inputs[1]?.messages.at(-1)).toMatchObject({ role: "tool", toolCallId: "bad-detail", isError: true });
    expect(script.inputs[1]?.messages.at(-1)?.content).toMatch(/outside project project-1/i);
  });

  it("does not grant a fresh model-turn allowance to validation repair", async () => {
    const invalid: ProposalSubmission = {
      ...validSubmission,
      moments: validSubmission.moments.slice(0, 2),
      chapters: [{ title: "Thin", summary: "", momentIds: ["p1", "p2"] }],
    };
    const script = scripted([
      { type: "submit", submission: invalid },
      { type: "submit", submission: validSubmission },
    ]);

    const result = await runPlan(job, {
      model: script.model,
      tools: tools(),
      budgetLimits: { modelTurns: 1 },
    });

    expect(result).toMatchObject({ ok: false, code: "budget_exhausted", budget: "model_turns" });
    expect(script.inputs).toHaveLength(1);
  });
});

describe("Budget", () => {
  it("throws typed elapsed-time exhaustion at the default 120 second boundary", () => {
    let now = 0;
    const budget = new Budget(undefined, () => now);
    budget.spendModelTurn();
    now = DEFAULT_PLAN_BUDGET_LIMITS.elapsedMs;

    let thrown: unknown;
    try {
      budget.assertWithinLimits();
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(BudgetExhausted);
    expect(thrown).toMatchObject({ budget: "elapsed_time", limit: 120_000 });
  });
});
