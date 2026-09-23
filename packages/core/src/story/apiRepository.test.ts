import { describe, expect, it, vi } from "vitest";

const firebaseMocks = vi.hoisted(() => ({
  ensureSignedIn: vi.fn(async () => ({ getIdToken: async () => "owner-token" })),
  onSnapshot: vi.fn(),
}));

vi.mock("../auth", () => ({ ensureSignedIn: firebaseMocks.ensureSignedIn }));
vi.mock("../config", () => ({ getCoreConfig: () => ({ apiBaseUrl: "https://api.test" }) }));
vi.mock("../firebase", () => ({ getFirestoreClient: () => "firestore", getStorageClient: () => "storage" }));
vi.mock("firebase/firestore", () => ({
  doc: (_db: unknown, ...segments: string[]) => segments.join("/"),
  collection: (_db: unknown, ...segments: string[]) => segments.join("/"),
  onSnapshot: firebaseMocks.onSnapshot,
}));

import { createApiStoryRepository, type ApiStoryRepositoryDeps } from "./apiRepository";

const proposal = {
  schemaVersion: 1,
  id: "proposal-1",
  projectId: "project-1",
  storyIntentId: "intent-1",
  parentProposalId: null,
  state: "draft",
  version: 1,
  title: "Family weekend",
  moments: [
    { id: "moment-1", shotId: "shot-1", kind: "photo", title: "Arrival", description: "At the station", rationale: "Opening" },
    { id: "moment-2", shotId: "shot-2", kind: "photo", title: "Dinner", description: "Around the table", rationale: "Togetherness" },
  ],
  chapters: [{ id: "chapter-1", title: "Together", summary: "The first evening", momentIds: ["moment-1", "moment-2"] }],
  constraints: { excludedShotIds: [], deselectedMomentIds: [], mustIncludeMomentIds: [], feedback: [] },
  openQuestions: [],
};

function dependencies(overrides: Partial<ApiStoryRepositoryDeps> = {}): ApiStoryRepositoryDeps {
  const documents: Record<string, unknown> = {
    "projects/project-1": { id: "project-1", title: "Family weekend", place: "Singapore", dateRange: "22–23 Sep 2026" },
    "projects/project-1/storyProposals/proposal-1": proposal,
    "projects/project-1/jobs/job-next": { id: "job-next", status: "succeeded", proposalId: "proposal-next" },
  };
  const collections: Record<string, unknown[]> = {
    "projects/project-1/shots": [
      { id: "shot-1", assetId: "asset-1", mediaType: "photo" },
      { id: "shot-2", assetId: "asset-2", mediaType: "photo" },
    ],
    "projects/project-1/assets": [
      { id: "asset-1", eventId: "event-1", derivatives: { thumbPath: "proxies/user/project-1/asset-1/1/thumb.jpg" } },
      { id: "asset-2", eventId: "event-1", derivatives: { thumbPath: "proxies/user/project-1/asset-2/1/thumb.jpg" } },
    ],
    "projects/project-1/events": [{ id: "event-1", label: "Day 1, evening" }],
  };
  return {
    listenDocument: vi.fn(async (path) => documents[path] ?? null),
    listenUntil: vi.fn(async (path, accept) => {
      const value = documents[path] ?? null;
      if (!accept(value)) throw new Error(`listenUntil would hang on ${path}`);
      return value;
    }),
    listenCollection: vi.fn(async (path) => collections[path] ?? []),
    getThumbnailUrl: vi.fn(async (projectId, assetId) => `https://storage.test/${projectId}/${assetId}?signed=true`),
    request: vi.fn(async () => ({})),
    ...overrides,
  };
}

describe("createApiStoryRepository", () => {
  it("uses Firestore snapshots and authenticated thumbnail API URLs in its default read adapter", async () => {
    const fetchMock = vi.fn(async (url: string, options: RequestInit) => {
      if (options.method !== "GET" || (options.headers as Record<string, string>).Authorization !== "Bearer owner-token") {
        return new Response(JSON.stringify({ error: "unauthenticated" }), { status: 401 });
      }
      const match = /\/api\/projects\/project-1\/assets\/(asset-[12])\/thumbnail$/.exec(url);
      return new Response(JSON.stringify(match ? { url: `https://storage.test/${match[1]}?signed=true`, expiresAt: 301000 } : { error: "not_found" }), { status: match ? 200 : 404 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const documents: Record<string, unknown> = {
      "projects/project-1": { id: "project-1", title: "Family weekend", place: "Singapore", dateRange: "22–23 Sep 2026" },
      "projects/project-1/storyProposals/proposal-1": proposal,
    };
    const collections: Record<string, unknown[]> = {
      "projects/project-1/shots": [{ id: "shot-1", assetId: "asset-1", mediaType: "photo" }, { id: "shot-2", assetId: "asset-2", mediaType: "photo" }],
      "projects/project-1/assets": [
        { id: "asset-1", eventId: "event-1", derivatives: { thumbPath: "proxies/owner/project-1/asset-1/1/thumb.jpg" } },
        { id: "asset-2", eventId: "event-1", derivatives: { thumbPath: "proxies/owner/project-1/asset-2/1/thumb.jpg" } },
      ],
      "projects/project-1/events": [{ id: "event-1", label: "Day 1, evening" }],
    };
    firebaseMocks.onSnapshot.mockImplementation((path: string, onValue: (snapshot: unknown) => void) => {
      queueMicrotask(() => {
        if (path in documents) onValue({ exists: () => true, data: () => documents[path] });
        else onValue({ docs: (collections[path] ?? []).map((value) => ({ data: () => value })) });
      });
      return vi.fn();
    });

    const plan = await createApiStoryRepository({ projectId: "project-1" }).getPlan("proposal-1");

    expect(plan.moments.map(({ imageKey }) => imageKey)).toEqual(["https://storage.test/asset-1?signed=true", "https://storage.test/asset-2?signed=true"]);
    expect(firebaseMocks.onSnapshot).toHaveBeenCalledTimes(5);
  });

  it("authenticates default API writes", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ job: { proposalId: "proposal-next" } }), { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(createApiStoryRepository({ projectId: "project-1" }).createPlan("Our story", [])).resolves.toEqual({ planId: "proposal-next" });

    expect(fetchMock).toHaveBeenCalledWith("https://api.test/api/projects/project-1/story-intents", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer owner-token" },
      body: JSON.stringify({ text: "Our story", focus: [] }),
    });
  });

  it("reads Firestore-shaped records and resolves owner-authorized thumbnail download URLs", async () => {
    const deps = dependencies();
    const repository = createApiStoryRepository({ projectId: "project-1" }, deps);

    const plan = await repository.getPlan("proposal-1");

    expect(plan.moments.map(({ imageKey }) => imageKey)).toEqual([
      "https://storage.test/project-1/asset-1?signed=true",
      "https://storage.test/project-1/asset-2?signed=true",
    ]);
    expect(plan.chapters[0].dayLabel).toBe("Day 1, evening");
    expect(deps.getThumbnailUrl).toHaveBeenCalledWith("project-1", "asset-1");
  });

  it("formats the persisted project date range for the review plan", async () => {
    const deps = dependencies();
    const originalListenDocument = deps.listenDocument;
    deps.listenDocument = vi.fn(async (path, waitForExists) => {
      if (path === "projects/project-1") {
        return { id: "project-1", title: "Family weekend", place: "Singapore", dateRange: { start: "2026-09-22", end: "2026-09-23" } };
      }
      return originalListenDocument(path, waitForExists);
    });

    const plan = await createApiStoryRepository({ projectId: "project-1" }, deps).getPlan("proposal-1");

    expect(plan.dateRange).toBe("Sep 22–23, 2026");
  });

  it("creates a plan for its explicit project id instead of inferring identity from media refs", async () => {
    const deps = dependencies();
    vi.mocked(deps.request).mockResolvedValue({ job: { proposalId: "proposal-next" } });
    const repository = createApiStoryRepository({ projectId: "project-1" }, deps);

    await expect(repository.createPlan("Keep the family scenes warm.", ["wrong-project"])).resolves.toEqual({ planId: "proposal-next" });
    expect(deps.request).toHaveBeenCalledWith(
      "POST",
      "/api/projects/project-1/story-intents",
      { text: "Keep the family scenes warm.", focus: [] },
    );
  });

  it("writes moment selection through the constraint revision route", async () => {
    const deps = dependencies();
    vi.mocked(deps.request).mockResolvedValue({
      proposal: {
        ...proposal,
        id: "proposal-2",
        parentProposalId: "proposal-1",
        version: 2,
        constraints: { ...proposal.constraints, deselectedMomentIds: ["moment-1"] },
      },
    });
    const repository = createApiStoryRepository({ projectId: "project-1" }, deps);

    const updated = await repository.setMomentSelected("proposal-1", "moment-1", false);

    expect(deps.request).toHaveBeenCalledWith(
      "PATCH",
      "/api/projects/project-1/proposals/proposal-1/constraints",
      { deselectedMomentIds: ["moment-1"], mustIncludeMomentIds: [] },
    );
    expect(updated.planId).toBe("proposal-2");
    expect(updated.moments.find(({ id }) => id === "moment-1")?.selected).toBe(false);
  });

  it("posts feedback and waits for the plan job before reading the queued proposal", async () => {
    const deps = dependencies();
    const originalListenDocument = deps.listenDocument;
    deps.listenDocument = vi.fn(async (path, waitForExists) => {
      if (path.endsWith("/storyProposals/proposal-next")) return { ...proposal, id: "proposal-next", parentProposalId: "proposal-1", version: 2 };
      return originalListenDocument(path, waitForExists);
    });
    vi.mocked(deps.request).mockResolvedValue({ job: { id: "job-next", proposalId: "proposal-next" } });
    const repository = createApiStoryRepository({ projectId: "project-1" }, deps);

    const updated = await repository.reviseMoments("proposal-1", "Show more of dinner.");

    expect(deps.request).toHaveBeenCalledWith(
      "POST",
      "/api/projects/project-1/proposals/proposal-1/feedback",
      { feedback: "Show more of dinner." },
    );
    expect(updated.planId).toBe("proposal-next");
    expect(deps.listenUntil).toHaveBeenCalledWith("projects/project-1/jobs/job-next", expect.any(Function));
    expect(deps.listenDocument).toHaveBeenCalledWith("projects/project-1/storyProposals/proposal-next", true);
  });

  it("surfaces a failed plan job's reason instead of waiting for a proposal it will never write", async () => {
    const deps = dependencies();
    // A failed job writes no proposal, so waiting on the document never resolves.
    deps.listenDocument = vi.fn(async (path, waitForExists) => {
      if (path.endsWith("/storyProposals/proposal-next")) return new Promise(() => {});
      return dependencies().listenDocument(path, waitForExists);
    });
    deps.listenUntil = vi.fn(async (_path, accept) => {
      const job = { id: "job-next", status: "failed", proposalId: "proposal-next", reason: "We couldn't build a valid story plan. Please try again." };
      expect(accept(job)).toBe(true);
      expect(accept({ ...job, status: "running" })).toBe(false);
      return job;
    });
    vi.mocked(deps.request).mockResolvedValue({ job: { id: "job-next", proposalId: "proposal-next" } });
    const repository = createApiStoryRepository({ projectId: "project-1" }, deps);

    await expect(repository.reviseMoments("proposal-1", "Show more of dinner."))
      .rejects.toThrow("We couldn't build a valid story plan. Please try again.");
    expect(deps.listenDocument).not.toHaveBeenCalledWith("projects/project-1/storyProposals/proposal-next", true);
  });

  it("degrades a card whose thumbnail will not sign instead of failing the whole screen", async () => {
    const deps = dependencies();
    deps.getThumbnailUrl = vi.fn(async (projectId, assetId) => {
      if (assetId === "asset-2") throw new Error("Permission 'iam.serviceAccounts.signBlob' denied");
      return `https://storage.test/${projectId}/${assetId}?signed=true`;
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const plan = await createApiStoryRepository({ projectId: "project-1" }, deps).getPlan("proposal-1");

    expect(plan.moments.map(({ imageKey }) => imageKey)).toEqual(["https://storage.test/project-1/asset-1?signed=true", ""]);
    warn.mockRestore();
  });

  it("keeps presentation-only favorites local without issuing an application write", async () => {
    const deps = dependencies();
    const repository = createApiStoryRepository({ projectId: "project-1" }, deps);

    const updated = await repository.setMomentFavorite("proposal-1", "moment-1", true);
    const reread = await repository.getPlan("proposal-1");

    expect(updated.moments.find(({ id }) => id === "moment-1")?.favorite).toBe(true);
    expect(reread.moments.find(({ id }) => id === "moment-1")?.favorite).toBe(true);
    expect(deps.request).not.toHaveBeenCalled();
  });

  it("keeps a proposal favorite when another screen creates its own API repository", async () => {
    const deps = dependencies();
    const reviewRepository = createApiStoryRepository({ projectId: "project-1" }, deps);

    await reviewRepository.setMomentFavorite("proposal-1", "moment-2", true);
    const timelineRepository = createApiStoryRepository({ projectId: "project-1" }, deps);
    const reread = await timelineRepository.getPlan("proposal-1");

    expect(reread.moments.find(({ id }) => id === "moment-2")?.favorite).toBe(true);
    expect(deps.request).not.toHaveBeenCalled();
  });

  it("accepts the exact proposal when the user chooses to create a film", async () => {
    const deps = dependencies();
    vi.mocked(deps.request).mockResolvedValue({ proposal: { ...proposal, state: "accepted" } });
    const repository = createApiStoryRepository({ projectId: "project-1" }, deps);

    await expect(repository.chooseCreateOption("proposal-1", "film")).resolves.toEqual({ available: true });
    expect(deps.request).toHaveBeenCalledWith(
      "POST",
      "/api/projects/project-1/proposals/proposal-1/accept",
    );
  });
});
