import { describe, expect, it, vi } from "vitest";
import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "../firebase/admin.js";
import { createPlanJob } from "../routes/directing.js";
import { createPlan, PLAN_LEASE_MS, type PlanTask } from "../directing/wire.js";
import type { PlanModelInput, PlanModelOutput, PlanningModel } from "../directing/runPlan.js";
import { saveProposal } from "./directingStore.js";
import { dispatchDue } from "../outbox/dispatcher.js";
import { DevTaskQueue } from "../queue/devTaskQueue.js";

const constraints = { excludedShotIds: [], deselectedMomentIds: [], mustIncludeMomentIds: [], feedback: [] };
const submission = {
  title: "Together",
  moments: Array.from({ length: 12 }, (_, i) => ({ shotId: `shot-${i}`, kind: "photo" as const, title: "Picnic", description: "Family together", rationale: "A warm moment" })),
  chapters: [{ title: "Picnic", summary: "A day outdoors", momentIds: Array.from({ length: 12 }, (_, i) => `shot-${i}`) }],
  openQuestions: [],
};

async function seed(status = "ready") {
  const projectId = `plan-${crypto.randomUUID()}`;
  const project = adminDb.doc(`projects/${projectId}`);
  await project.set({ id: projectId, userId: "owner", status, createdAt: 1 });
  const batch = adminDb.batch();
  for (let i = 0; i < 12; i++) {
    batch.set(project.collection("assets").doc(`asset-${i}`), {
      id: `asset-${i}`, projectId, status: "understood", generation: "1", eventId: "event", dupOf: null,
      media: { kind: "photo", localTime: "2026-05-03T10:00:00" }, transcript: null,
    });
    batch.set(project.collection("shots").doc(`shot-${i}`), {
      assetId: `asset-${i}`, assetGeneration: "1", sourceStartSec: null, sourceEndSec: null,
      embedding: FieldValue.vector([1, 0]),
      analysis: { kind: "photo", caption: "Family picnic", subjects: [], setting: "park", activities: ["picnic"], mood: "warm", shotType: "wide", aesthetics: 4, keyMomentScore: 4, tags: [] },
    });
  }
  await batch.commit();
  const addJob = async () => {
    const job = await createPlanJob(adminDb, {
      userId: "owner", projectId, storyIntentId: "intent", parentProposalId: null, minimumVersion: 1,
      constraints, waitForReady: status === "processing", createdAt: 10, intent: { text: "Family picnic", focus: [] },
    });
    return { job, task: { projectId, jobId: job.id, generation: String(job.version) } satisfies PlanTask, ref: project.collection("jobs").doc(job.id) };
  };
  return { project, projectId, addJob };
}

function model(run?: (input: PlanModelInput) => Promise<PlanModelOutput>) {
  const inputs: PlanModelInput[] = [];
  const instance: PlanningModel = { runTurn: async (input) => {
    inputs.push(input);
    return run ? run(input) : { type: "submit", submission };
  } };
  return { instance, inputs };
}

describe("plan flow (emulator)", () => {
  it("dispatches a waiting job again when ready without spending an attempt", async () => {
    const { project, addJob } = await seed("processing");
    const { task, ref } = await addJob();
    const scripted = model();
    const worker = createPlan({ db: adminDb, model: scripted.instance, embedContent: async () => [[1, 0]], now: () => 100 });
    const queue = new DevTaskQueue({
      plan: (input) => input.projectId === task.projectId ? worker(input) : Promise.resolve("skipped"),
      ingest: async () => {}, understand: async () => {}, cluster: async () => {},
    });
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const first = await dispatchDue(adminDb, queue, 100, 1000);
    errors.mockRestore();
    expect(first.failed).toBeGreaterThanOrEqual(1);
    expect((await ref.get()).data()).toMatchObject({ status: "waiting_for_ready", attempts: 0, leaseUntil: null });
    expect(scripted.inputs).toHaveLength(0);
    await project.update({ status: "ready_with_errors" });
    await dispatchDue(adminDb, queue, 200, 1000);
    expect((await ref.get()).data()).toMatchObject({ status: "succeeded", attempts: 1, leaseUntil: null });
    expect(scripted.inputs).toHaveLength(1);
    expect(scripted.inputs[0].messages[0].content).toContain("shot-0 | photo | 2026-05-03");
    expect(scripted.inputs[0].messages[0].content).toContain("park");
    expect((await project.get()).get("currentProposalId")).toBe((await ref.get()).get("proposalId"));
    expect(await worker(task)).toBe("skipped");
  });

  it("publishes out-of-order jobs once each while keeping the newest current", async () => {
    const { project, addJob } = await seed();
    const old = await addJob();
    const newer = await addJob();
    let finish!: (output: PlanModelOutput) => void;
    let started!: () => void;
    const ready = new Promise<void>((resolve) => { started = resolve; });
    const oldModel = model(async () => { started(); return new Promise((resolve) => { finish = resolve; }); });
    const oldWorker = createPlan({ db: adminDb, model: oldModel.instance, embedContent: async () => [], now: () => 100 });
    const pending = oldWorker(old.task);
    await ready;
    const newModel = model();
    const newWorker = createPlan({ db: adminDb, model: newModel.instance, embedContent: async () => [], now: () => 100 });
    expect(await newWorker(newer.task)).toBe("published");
    finish({ type: "submit", submission });
    expect(await pending).toBe("stale");
    await Promise.all([oldWorker(old.task), newWorker(newer.task)]);
    expect((await project.get()).get("currentProposalId")).toBe(newer.job.proposalId);
    expect((await project.collection("storyProposals").get()).size).toBe(2);
    expect(oldModel.inputs).toHaveLength(1);
    expect(newModel.inputs).toHaveLength(1);
  });

  it.each([false, true])("recovers a crash around publication (write already committed: %s)", async (committed) => {
    const { project, addJob } = await seed();
    const { task, ref } = await addJob();
    const scripted = model();
    let fail = true;
    const worker = createPlan({ db: adminDb, model: scripted.instance, embedContent: async () => [], now: () => 100,
      publish: async (input) => {
        if (fail) {
          fail = false;
          if (committed) await saveProposal(adminDb, input);
          throw new Error("simulated crash");
        }
        return saveProposal(adminDb, input);
      },
    });
    await expect(worker(task)).rejects.toThrow("simulated crash");
    expect((await ref.get()).data()).toMatchObject({ status: "publishing", attempts: 1, leaseUntil: null });
    expect(await worker(task)).toBe("published");
    expect(scripted.inputs).toHaveLength(1);
    expect((await project.collection("storyProposals").get()).size).toBe(1);
    expect((await ref.get()).data()).toMatchObject({ status: "succeeded", attempts: 1 });
  });

  it("exhausts three bounded runs without replacing the previous proposal", async () => {
    const { project, addJob } = await seed();
    const previous = await addJob();
    await createPlan({ db: adminDb, model: model().instance, embedContent: async () => [], now: () => 100 })(previous.task);
    const next = await addJob();
    const scripted = model(async () => ({ type: "tool_calls", calls: [] }));
    const worker = createPlan({ db: adminDb, model: scripted.instance, embedContent: async () => [], now: () => 100, budgetLimits: { modelTurns: 1 } });
    await expect(worker(next.task)).rejects.toThrow("budget_exhausted");
    await expect(worker(next.task)).rejects.toThrow("budget_exhausted");
    expect(await worker(next.task)).toBe("failed");
    expect(await worker(next.task)).toBe("skipped");
    expect(scripted.inputs).toHaveLength(3);
    expect((await next.ref.get()).data()).toMatchObject({ status: "failed", attempts: 3, code: "retries_exhausted", lastError: "budget_exhausted", leaseUntil: null });
    expect((await project.get()).get("currentProposalId")).toBe(previous.job.proposalId);
    expect((await project.collection("storyProposals").get()).size).toBe(1);
  });

  it("fences an expired worker while a replacement finishes", async () => {
    const { project, addJob } = await seed();
    const { task, ref } = await addJob();
    let now = 100;
    let finish!: (output: PlanModelOutput) => void;
    let started!: () => void;
    const ready = new Promise<void>((resolve) => { started = resolve; });
    const scripted = model(async () => { started(); return new Promise((resolve) => { finish = resolve; }); });
    const oldWorker = createPlan({ db: adminDb, model: scripted.instance, embedContent: async () => [], now: () => now });
    const pending = oldWorker(task);
    const rejected = expect(pending).rejects.toThrow();
    await ready;
    await expect(oldWorker(task)).rejects.toThrow("lease_busy");
    expect(scripted.inputs).toHaveLength(1);
    now += PLAN_LEASE_MS + 1;
    await createPlan({ db: adminDb, model: model().instance, embedContent: async () => [], now: () => now })(task);
    finish({ type: "submit", submission: { ...submission, title: "Expired worker" } });
    await rejected;
    expect((await ref.get()).data()).toMatchObject({ status: "succeeded", attempts: 2, leaseUntil: null });
    expect((await project.collection("storyProposals").get()).docs[0].get("title")).toBe("Together");
  });

  it("rejects a stale task generation without running and stops terminal project jobs", async () => {
    const { project, addJob } = await seed();
    const { task, ref } = await addJob();
    const scripted = model();
    const worker = createPlan({ db: adminDb, model: scripted.instance, embedContent: async () => [], now: () => 100 });
    expect(await worker({ ...task, generation: "999" })).toBe("skipped");
    await project.update({ status: "failed" });
    expect(await worker(task)).toBe("failed");
    expect((await ref.get()).data()).toMatchObject({ status: "failed", code: "project_failed", attempts: 0 });
    expect(scripted.inputs).toHaveLength(0);
  });

  it("retries a validation failure once with a fresh attempt and omits superseded asset generations", async () => {
    const { project, addJob } = await seed();
    const { task, ref } = await addJob();
    await project.collection("assets").doc("asset-0").update({ generation: "2" });
    const scripted = model();
    const worker = createPlan({ db: adminDb, model: scripted.instance, now: () => 100 });
    await expect(worker(task)).rejects.toThrow("validation_failed");
    expect((await ref.get()).data()).toMatchObject({ status: "queued", attempts: 1, code: "validation_failed", leaseUntil: null });
    expect(await worker(task)).toBe("failed");
    expect(await worker(task)).toBe("skipped");
    expect(scripted.inputs).toHaveLength(4);
    expect(scripted.inputs[0].messages[0].content).not.toContain("shot-0 | photo");
    expect((await ref.get()).data()).toMatchObject({ status: "failed", attempts: 2, code: "validation_failed", lastError: "validation_failed", leaseUntil: null });
    expect((await project.collection("storyProposals").get()).empty).toBe(true);
  });

  it("allows boot with no API key and terminates the task after three failed attempts", async () => {
    const { addJob } = await seed();
    const { task, ref } = await addJob();
    const worker = createPlan({ db: adminDb, geminiApiKey: "", now: () => 100 });
    await expect(worker(task)).rejects.toThrow("gemini_api_key_missing");
    await expect(worker(task)).rejects.toThrow("gemini_api_key_missing");
    expect(await worker(task)).toBe("failed");
    expect((await ref.get()).data()).toMatchObject({ status: "failed", attempts: 3, code: "retries_exhausted", lastError: "gemini_api_key_missing", leaseUntil: null });
  });

  it("recovers a checkpoint after an expired final attempt without a fourth model run", async () => {
    const { addJob } = await seed();
    const { task, ref } = await addJob();
    const first = createPlan({ db: adminDb, model: model().instance, now: () => 100, publish: async () => { throw new Error("crash"); } });
    await expect(first(task)).rejects.toThrow("crash");
    await ref.update({ attempts: 3, leaseOwner: "crashed-process", leaseUntil: 99 });
    const worker = createPlan({ db: adminDb, now: () => 100 });
    expect(await worker(task)).toBe("published");
    expect((await ref.get()).data()).toMatchObject({ status: "succeeded", attempts: 3, leaseUntil: null });
  });
});
