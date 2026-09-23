import type { StoryIntent, StoryProposal } from "@mosae/contracts";
import express from "express";
import type { Firestore } from "firebase-admin/firestore";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../store/projectStore.js", async () => {
  const actual = await vi.importActual<typeof import("../store/projectStore.js")>("../store/projectStore.js");
  return { ...actual, getOwnedProject: vi.fn() };
});

vi.mock("../store/directingStore.js", async () => {
  const actual = await vi.importActual<typeof import("../store/directingStore.js")>("../store/directingStore.js");
  return {
    ...actual,
    saveIntent: vi.fn(),
    reviseConstraints: vi.fn(),
    readProposal: vi.fn(),
    acceptProposal: vi.fn(),
  };
});

const projectStore = await import("../store/projectStore.js");
const directingStore = await import("../store/directingStore.js");
const actualDirectingStore = await vi.importActual<typeof import("../store/directingStore.js")>("../store/directingStore.js");
const { createPlanJob, directingRouter } = await import("./directing.js");

const db = {} as Firestore;
const queuePlan = vi.fn();
const fakeAuth: express.RequestHandler = (_req, res, next) => {
  res.locals.userId = "user-1";
  next();
};

const constraints = {
  excludedShotIds: [],
  deselectedMomentIds: [],
  mustIncludeMomentIds: [],
  feedback: [],
};

const proposal: StoryProposal = {
  schemaVersion: 1,
  id: "proposal-1",
  projectId: "project-1",
  storyIntentId: "intent-1",
  parentProposalId: null,
  state: "draft",
  version: 1,
  title: "Homecoming",
  moments: [
    { id: "moment-1", shotId: "shot-1", kind: "photo", title: "Arrival", description: "", rationale: "" },
    { id: "moment-2", shotId: "shot-2", kind: "photo", title: "Dinner", description: "", rationale: "" },
  ],
  chapters: [{ id: "chapter-1", title: "Together", summary: "", momentIds: ["moment-1", "moment-2"] }],
  constraints,
  openQuestions: [],
};

function ownedProject(status: "collecting" | "processing" | "ready" | "ready_with_errors" | "failed" = "ready") {
  return {
    id: "project-1",
    userId: "user-1",
    mode: "memory" as const,
    title: null,
    status,
    createdAt: 1,
    currentProposalId: proposal.id,
  };
}

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/projects", directingRouter({ db, now: () => 42, newId: () => "intent-new", auth: fakeAuth, queuePlan }));
  return app;
}

describe("directing routes", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(projectStore.getOwnedProject).mockResolvedValue(ownedProject());
    vi.mocked(directingStore.saveIntent).mockImplementation(async (_db, input) => input.intent);
    vi.mocked(directingStore.readProposal).mockResolvedValue(proposal);
    vi.mocked(directingStore.reviseConstraints).mockResolvedValue({
      ...proposal,
      id: "proposal-2",
      parentProposalId: proposal.id,
      version: 2,
      constraints: { ...constraints, deselectedMomentIds: ["moment-1"] },
    });
    vi.mocked(directingStore.acceptProposal).mockResolvedValue({ ...proposal, state: "accepted" });
    queuePlan.mockResolvedValue({ id: "job-1", proposalId: "proposal-next", version: 2 });
  });

  it("saves a versioned intent and queues planning for a ready project", async () => {
    const response = await request(buildApp())
      .post("/api/projects/project-1/story-intents")
      .send({ text: "Keep the family reunion warm.", focus: ["family"] });

    expect(response.status).toBe(202);
    expect(response.body).toMatchObject({ intent: { projectId: "project-1", version: 1 }, job: { id: "job-1" } });
    const saved = vi.mocked(directingStore.saveIntent).mock.calls[0][1];
    expect(saved).toMatchObject({ userId: "user-1", createdAt: 42 });
    expect(saved.intent).toMatchObject({ schemaVersion: 1, projectId: "project-1", version: 1, text: "Keep the family reunion warm.", focus: ["family"] });
    expect(queuePlan).toHaveBeenCalledWith(expect.objectContaining({
      userId: "user-1",
      projectId: "project-1",
      storyIntentId: saved.intent.id,
      minimumVersion: 1,
      parentProposalId: null,
      constraints,
      waitForReady: false,
      createdAt: 42,
    }));
  });

  it("allocates story intent identity and initial version on the server", async () => {
    const response = await request(buildApp())
      .post("/api/projects/project-1/story-intents")
      .send({ id: "reused-client-id", version: 99, text: "Keep this version immutable.", focus: [] });

    expect(response.status).toBe(202);
    const saved = vi.mocked(directingStore.saveIntent).mock.calls[0][1].intent;
    expect(saved).toMatchObject({ id: "intent-new", version: 1, text: "Keep this version immutable." });
  });

  it.each([
    ["collecting", "project_collecting", "Finish adding media before planning a story."],
    ["failed", "project_failed", "This project has no usable media to plan."],
  ] as const)("refuses a %s project with a readable reason", async (status, error, reason) => {
    vi.mocked(projectStore.getOwnedProject).mockResolvedValue(ownedProject(status));

    const response = await request(buildApp())
      .post("/api/projects/project-1/story-intents")
      .send({ text: "Tell the story", focus: [] });

    expect(response.status).toBe(409);
    expect(response.body).toEqual({ error, reason });
    expect(directingStore.saveIntent).not.toHaveBeenCalled();
    expect(queuePlan).not.toHaveBeenCalled();
  });

  it.each([
    ["processing", true],
    ["ready_with_errors", false],
  ] as const)("accepts a %s project with the right readiness behavior", async (status, waitForReady) => {
    vi.mocked(projectStore.getOwnedProject).mockResolvedValue(ownedProject(status));

    const response = await request(buildApp())
      .post("/api/projects/project-1/story-intents")
      .send({ text: "Tell the story", focus: [] });

    expect(response.status).toBe(202);
    expect(queuePlan).toHaveBeenCalledWith(expect.objectContaining({ waitForReady }));
  });

  it("revises constraints synchronously against the exact proposal without queueing planning", async () => {
    const response = await request(buildApp())
      .patch("/api/projects/project-1/proposals/proposal-1/constraints")
      .send({ deselectedMomentIds: ["moment-1"], mustIncludeMomentIds: [] });

    expect(response.status).toBe(201);
    expect(response.body.proposal).toMatchObject({ id: "proposal-2", parentProposalId: "proposal-1", version: 2 });
    expect(directingStore.reviseConstraints).toHaveBeenCalledWith(db, {
      userId: "user-1",
      projectId: "project-1",
      proposalId: "proposal-1",
      constraints: { ...constraints, deselectedMomentIds: ["moment-1"] },
      createdAt: 42,
    });
    expect(queuePlan).not.toHaveBeenCalled();
  });

  it("re-selects a deselected moment and marks it must-include in the new draft", async () => {
    vi.mocked(directingStore.readProposal).mockResolvedValue({
      ...proposal,
      constraints: { ...constraints, deselectedMomentIds: ["moment-1"] },
    });

    const response = await request(buildApp())
      .patch("/api/projects/project-1/proposals/proposal-1/constraints")
      .send({ deselectedMomentIds: [], mustIncludeMomentIds: ["moment-1"] });

    expect(response.status).toBe(201);
    expect(directingStore.reviseConstraints).toHaveBeenCalledWith(db, expect.objectContaining({
      proposalId: "proposal-1",
      constraints: { ...constraints, mustIncludeMomentIds: ["moment-1"] },
    }));
    expect(queuePlan).not.toHaveBeenCalled();
  });

  it("refuses to apply constraints to a stale proposal id", async () => {
    vi.mocked(directingStore.reviseConstraints).mockRejectedValue(new directingStore.DirectingStoreError("stale_proposal"));

    const response = await request(buildApp())
      .patch("/api/projects/project-1/proposals/proposal-1/constraints")
      .send({ deselectedMomentIds: [], mustIncludeMomentIds: [] });

    expect(response.status).toBe(409);
    expect(response.body).toEqual({ error: "stale_proposal" });
  });

  it("appends feedback to the exact current proposal and queues a new version", async () => {
    const response = await request(buildApp())
      .post("/api/projects/project-1/proposals/proposal-1/feedback")
      .send({ feedback: "Give the grandparents more emphasis." });

    expect(response.status).toBe(202);
    expect(queuePlan).toHaveBeenCalledWith(expect.objectContaining({
      userId: "user-1",
      projectId: "project-1",
      storyIntentId: "intent-1",
      parentProposalId: "proposal-1",
      minimumVersion: 2,
      constraints: { ...constraints, feedback: ["Give the grandparents more emphasis."] },
      waitForReady: false,
      createdAt: 42,
    }));
  });

  it("refuses feedback against a stale proposal rather than applying it to the newest", async () => {
    vi.mocked(projectStore.getOwnedProject).mockResolvedValue({ ...ownedProject(), currentProposalId: "proposal-newer" } as never);

    const response = await request(buildApp())
      .post("/api/projects/project-1/proposals/proposal-1/feedback")
      .send({ feedback: "More warmth." });

    expect(response.status).toBe(409);
    expect(response.body).toEqual({ error: "stale_proposal" });
    expect(queuePlan).not.toHaveBeenCalled();
  });

  it("accepts an already accepted proposal idempotently", async () => {
    const app = buildApp();
    const first = await request(app).post("/api/projects/project-1/proposals/proposal-1/accept");
    const second = await request(app).post("/api/projects/project-1/proposals/proposal-1/accept");

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(first.body.proposal.state).toBe("accepted");
    expect(second.body.proposal.state).toBe("accepted");
    expect(directingStore.acceptProposal).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["intent", "post", "/api/projects/project-1/story-intents", { text: "Tell the story", focus: [] }],
    ["constraints", "patch", "/api/projects/project-1/proposals/proposal-1/constraints", { deselectedMomentIds: [], mustIncludeMomentIds: [] }],
    ["feedback", "post", "/api/projects/project-1/proposals/proposal-1/feedback", { feedback: "More warmth." }],
    ["accept", "post", "/api/projects/project-1/proposals/proposal-1/accept", undefined],
  ] as const)("enforces project ownership on the %s route", async (_name, method, path, body) => {
    vi.mocked(projectStore.getOwnedProject).mockResolvedValue(null);
    const pending = request(buildApp())[method](path);
    const response = body === undefined ? await pending : await pending.send(body);

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: "not_found" });
    expect(directingStore.saveIntent).not.toHaveBeenCalled();
    expect(directingStore.reviseConstraints).not.toHaveBeenCalled();
    expect(directingStore.readProposal).not.toHaveBeenCalled();
    expect(directingStore.acceptProposal).not.toHaveBeenCalled();
    expect(queuePlan).not.toHaveBeenCalled();
  });

  it.each([
    ["intent", "/api/projects/project-1/story-intents", {}],
    ["feedback", "/api/projects/project-1/proposals/proposal-1/feedback", {}],
  ] as const)("checks ownership before validating the %s body", async (_name, path, body) => {
    vi.mocked(projectStore.getOwnedProject).mockResolvedValue(null);

    const response = await request(buildApp()).post(path).send(body);

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: "not_found" });
  });
});

function fakeFirestore(status: "processing" | "ready", proposalVersion = 3) {
  const documents = new Map<string, Record<string, unknown>>([
    ["projects/project-1", { ...ownedProject(status), proposalVersionCounter: 2 }],
    ["projects/project-1/storyProposals/proposal-1", { ...proposal, version: proposalVersion }],
  ]);
    let generated = 0;
    const document = (path: string, id?: string): any => {
      const resolvedId = id ?? `generated-${++generated}`;
      const resolvedPath = id === undefined ? `${path}/${resolvedId}` : `${path}/${id}`;
      return {
        id: resolvedId,
        path: resolvedPath,
        collection: (name: string) => ({ doc: (childId?: string) => document(`${resolvedPath}/${name}`, childId) }),
      };
    };
  const db = {
      collection: (name: string) => ({ doc: (id?: string) => document(name, id) }),
      runTransaction: async (run: (transaction: any) => Promise<unknown>) => run({
        get: async (ref: { path: string }) => {
          const data = documents.get(ref.path);
          return { exists: data !== undefined, data: () => data, get: (field: string) => data?.[field] };
        },
        create: (ref: { path: string }, value: Record<string, unknown>) => documents.set(ref.path, value),
        set: (ref: { path: string }, value: Record<string, unknown>) => documents.set(ref.path, value),
        update: (ref: { path: string }, value: Record<string, unknown>) => documents.set(ref.path, { ...documents.get(ref.path), ...value }),
      }),
  } as unknown as Firestore;
  return { db, documents };
}

describe("createPlanJob", () => {
  it("atomically queues a monotonic plan version that waits for a processing project", async () => {
    const { db: fakeDb, documents } = fakeFirestore("processing");

    const job = await createPlanJob(fakeDb, {
      userId: "user-1",
      projectId: "project-1",
      storyIntentId: "intent-1",
      parentProposalId: "proposal-1",
      minimumVersion: 2,
      constraints,
      waitForReady: true,
      createdAt: 42,
      intent: { text: "Tell the story", focus: [] },
    });

    expect(job).toMatchObject({ version: 4, status: "waiting_for_ready" });
    expect(documents.get(`projects/project-1/jobs/${job.id}`)).toMatchObject({
      proposalId: job.proposalId,
      version: 4,
      waitForReady: true,
      pinnedInputs: { intent: { text: "Tell the story", focus: [] }, constraints, targetSec: 60 },
    });
    expect([...documents.entries()].find(([path]) => path.includes("/taskOutbox/"))?.[1]).toMatchObject({
      projectId: "project-1",
      subjectKind: "job",
      subjectId: job.id,
      generation: "4",
      stage: "plan",
      state: "pending",
    });
    expect(documents.get("projects/project-1")?.proposalVersionCounter).toBe(4);
  });

  it("uses transaction-time readiness when the project became ready after the route read", async () => {
    const { db: fakeDb } = fakeFirestore("ready");

    const job = await createPlanJob(fakeDb, {
      userId: "user-1",
      projectId: "project-1",
      storyIntentId: "intent-1",
      parentProposalId: "proposal-1",
      minimumVersion: 4,
      constraints,
      waitForReady: true,
      createdAt: 42,
      intent: { text: "Tell the story", focus: [] },
    });

    expect(job.status).toBe("queued");
  });
});

describe("directing persistence invariants", () => {
  it("refuses to overwrite an existing story intent with different text", async () => {
    const { db: fakeDb, documents } = fakeFirestore("ready");
    const intent: StoryIntent = {
      schemaVersion: 1,
      id: "intent-reused",
      projectId: "project-1",
      version: 1,
      text: "Keep the original family story.",
      focus: ["family"],
    };
    await actualDirectingStore.saveIntent(fakeDb, { userId: "user-1", intent, createdAt: 20 });

    await expect(actualDirectingStore.saveIntent(fakeDb, {
      userId: "user-1",
      intent: { ...intent, text: "Replace it with a different story." },
      createdAt: 30,
    })).rejects.toMatchObject({ code: "invalid_intent" });

    expect(documents.get("projects/project-1/storyIntents/intent-reused")).toEqual({ ...intent, createdAt: 20 });
  });

  it("allocates a constraint revision after reserved job versions so late jobs stay stale", async () => {
    const { db: fakeDb, documents } = fakeFirestore("ready", 1);
    documents.set("projects/project-1", { ...ownedProject("ready"), proposalVersionCounter: 1 });
    const jobInput = {
      userId: "user-1",
      projectId: "project-1",
      storyIntentId: "intent-1",
      parentProposalId: "proposal-1",
      minimumVersion: 2,
      constraints,
      waitForReady: false,
      createdAt: 30,
      intent: { text: "Preserve the family story.", focus: ["family"] },
    };
    const jobV2 = await createPlanJob(fakeDb, jobInput);
    const jobV3 = await createPlanJob(fakeDb, { ...jobInput, createdAt: 31 });

    const revised = await actualDirectingStore.reviseConstraints(fakeDb, {
      userId: "user-1",
      projectId: "project-1",
      proposalId: "proposal-1",
      constraints: { ...constraints, deselectedMomentIds: ["moment-1"] },
      createdAt: 40,
    });
    const lateV3: StoryProposal = {
      ...proposal,
      id: jobV3.proposalId,
      parentProposalId: proposal.id,
      version: jobV3.version,
    };

    expect([jobV2.version, jobV3.version, revised.version]).toEqual([2, 3, 4]);
    await expect(actualDirectingStore.saveProposal(fakeDb, {
      jobId: jobV3.id,
      proposal: lateV3,
      createdAt: 50,
    })).resolves.toBe("stale");
    expect(documents.get("projects/project-1")?.currentProposalId).toBe(revised.id);
  });
});
