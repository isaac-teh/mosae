export type PlanBudgetLimits = {
  modelTurns: number;
  toolCalls: number;
  elapsedMs: number;
};

export type PlanBudgetKind = "model_turns" | "tool_calls" | "elapsed_time";

export type PlanBudgetUsage = {
  modelTurns: number;
  toolCalls: number;
  elapsedMs: number;
};

export const DEFAULT_PLAN_BUDGET_LIMITS: Readonly<PlanBudgetLimits> = {
  modelTurns: 8,
  toolCalls: 24,
  elapsedMs: 120_000,
};

export class BudgetExhausted extends Error {
  readonly budget: PlanBudgetKind;
  readonly limit: number;

  constructor(budget: PlanBudgetKind, limit: number) {
    super(`planning ${budget.replaceAll("_", " ")} budget exhausted at ${limit}`);
    this.name = "BudgetExhausted";
    this.budget = budget;
    this.limit = limit;
  }
}

function positiveLimit(value: number, name: keyof PlanBudgetLimits): number {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be a positive finite number`);
  return value;
}

/** One finite allowance shared by discovery, submission and the optional repair. */
export class Budget {
  readonly limits: PlanBudgetLimits;
  private readonly startedAt: number;
  private modelTurns = 0;
  private toolCalls = 0;

  constructor(limits: Partial<PlanBudgetLimits> = {}, private readonly now: () => number = Date.now) {
    this.limits = {
      modelTurns: positiveLimit(limits.modelTurns ?? DEFAULT_PLAN_BUDGET_LIMITS.modelTurns, "modelTurns"),
      toolCalls: positiveLimit(limits.toolCalls ?? DEFAULT_PLAN_BUDGET_LIMITS.toolCalls, "toolCalls"),
      elapsedMs: positiveLimit(limits.elapsedMs ?? DEFAULT_PLAN_BUDGET_LIMITS.elapsedMs, "elapsedMs"),
    };
    this.startedAt = this.now();
  }

  assertWithinLimits(): void {
    if (this.elapsed() >= this.limits.elapsedMs) {
      throw new BudgetExhausted("elapsed_time", this.limits.elapsedMs);
    }
  }

  spendModelTurn(): void {
    this.assertWithinLimits();
    if (this.modelTurns >= this.limits.modelTurns) {
      throw new BudgetExhausted("model_turns", this.limits.modelTurns);
    }
    this.modelTurns += 1;
  }

  spendToolCall(): void {
    this.assertWithinLimits();
    if (this.toolCalls >= this.limits.toolCalls) {
      throw new BudgetExhausted("tool_calls", this.limits.toolCalls);
    }
    this.toolCalls += 1;
  }

  snapshot(): PlanBudgetUsage {
    return { modelTurns: this.modelTurns, toolCalls: this.toolCalls, elapsedMs: this.elapsed() };
  }

  remainingElapsedMs(): number {
    return Math.max(0, this.limits.elapsedMs - this.elapsed());
  }

  private elapsed(): number {
    return Math.max(0, this.now() - this.startedAt);
  }
}
