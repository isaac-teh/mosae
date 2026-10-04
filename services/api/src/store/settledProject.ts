import { settleProject } from "./readinessStore.js";

type SettledResult = Awaited<ReturnType<typeof settleProject>>;

/** Run readiness side effects after every asset has completed understanding. */
export async function settleReadyProject(input: {
  projectId: string;
  settle: (projectId: string) => Promise<SettledResult>;
  ensureCast: (projectId: string) => Promise<unknown>;
  dispatchDue: () => Promise<unknown>;
}): Promise<SettledResult> {
  const result = await input.settle(input.projectId);
  if (result.settled && result.facts.ingested > 0) {
    try {
      await input.ensureCast(input.projectId);
    } finally {
      // A retry may find the deterministic cluster task already created, so
      // drain due work on every settled pass, even when `enqueued` is false.
      await input.dispatchDue();
    }
  } else if (result.enqueued) {
    await input.dispatchDue();
  }
  return result;
}
