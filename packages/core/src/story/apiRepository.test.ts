import { describe, expect, it, vi } from "vitest";

const firebaseMocks = vi.hoisted(() => ({
  ensureSignedIn: vi.fn(async () => ({ uid: "owner", getIdToken: async () => "owner-token" })),
  onSnapshot: vi.fn(),
  getDocs: vi.fn(),
  query: vi.fn((source: unknown) => source),
  where: vi.fn(),
}));

vi.mock("../auth", () => ({ ensureSignedIn: firebaseMocks.ensureSignedIn }));
vi.mock("../config", () => ({ getCoreConfig: () => ({ apiBaseUrl: "https://api.test" }) }));
vi.mock("../firebase", () => ({ getFirestoreClient: () => "firestore", getStorageClient: () => "storage" }));
vi.mock("firebase/firestore", () => ({
  doc: (_db: unknown, ...segments: string[]) => segments.join("/"),
  collection: (_db: unknown, ...segments: string[]) => segments.join("/"),
  onSnapshot: firebaseMocks.onSnapshot,
  getDocs: firebaseMocks.getDocs,
  query: firebaseMocks.query,
  where: firebaseMocks.where,
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
      { id: "shot-3", assetId: "asset-1", mediaType: "photo" },
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
    listenUserProjects: vi.fn(async () => []),
    getThumbnailUrl: vi.fn(async (projectId, assetId) => `https://storage.test/${projectId}/${assetId}?signed=true`),
    request: vi.fn(async () => ({})),
    ...overrides,
  };
}

describe("createApiStoryRepository", () => {
  it("loads the generation timeline and preview sources for editing", async () => {
    const timeline = { schemaVersion: 1, projectId: "project-1", mode: "memory", aspect: "9:16", fps: 30, durationSec: 3, chapters: [{ title: "Opening", startSec: 0 }], videoClips: [{ id: "c1", source: { kind: "photo", shotId: "s1" }, startSec: 0, durationSec: 3, transitionIn: { kind: "cut", durationSec: 0 } }], audioClips: [], captions: [] };
    const deps = dependencies({ request: vi.fn(async () => ({ timeline, sources: { s1: "preview.jpg" } })) });
    await expect(createApiStoryRepository({ projectId: "project-1" }, deps).getFilmTimeline("project-1", "g1")).resolves.toEqual({ timeline, sources: { s1: "preview.jpg" } });
    expect(deps.request).toHaveBeenCalledWith("GET", "/api/projects/project-1/generations/g1");
  });

  it("reads and saves edit revisions through the authenticated API", async () => {
    const document = { revision: 2, ops: [{ op: "remove" as const, clipId: "clip-1" }], updatedAt: 123 };
    const deps = dependencies({ request: vi.fn(async () => document) });
    const repository = createApiStoryRepository({ projectId: "project-1" }, deps);
    await expect(repository.getEdits("project-1", "gen-1")).resolves.toEqual(document);
    await expect(repository.saveEdits("project-1", "gen-1", 2, document.ops)).resolves.toEqual(document);
    expect(deps.request).toHaveBeenNthCalledWith(1, "GET", "/api/projects/project-1/generations/gen-1/edits");
    expect(deps.request).toHaveBeenNthCalledWith(2, "PUT", "/api/projects/project-1/generations/gen-1/edits", { revision: 2, ops: document.ops });
  });

  it("asks the generation edit interpreter at the requested revision", async () => {
    const response = { reply: "Move the second photo earlier?", ops: [{ op: "move" as const, clipId: "clip-2", toIndex: 0 }] };
    const deps = dependencies({ request: vi.fn(async () => response) });
    const repository = createApiStoryRepository({ projectId: "project-1" }, deps);
    await expect(repository.interpretEdit("project-1", "gen-1", "move the second photo earlier", 3)).resolves.toEqual(response);
    expect(deps.request).toHaveBeenCalledWith("POST", "/api/projects/project-1/generations/gen-1/edits/interpret", { text: "move the second photo earlier", revision: 3 });
  });

  it("requests and reads an edited render", async () => {
    const deps = dependencies({ request: vi.fn(async (method) => method === "POST"
      ? { renderId: "g1-edit-3" }
      : { revision: 3, status: "ready", downloadUrl: "https://storage.test/edit.mp4" }) });
    const repository = createApiStoryRepository({ projectId: "project-1" }, deps);
    await expect(repository.renderRevision("project-1", "g1", 3)).resolves.toEqual({ renderId: "g1-edit-3" });
    await expect(repository.getRender("project-1", "g1", 3)).resolves.toMatchObject({ revision: 3, status: "ready" });
    expect(deps.request).toHaveBeenNthCalledWith(1, "POST", "/api/projects/project-1/generations/g1/edits/3/render");
    expect(deps.request).toHaveBeenNthCalledWith(2, "GET", "/api/projects/project-1/generations/g1/edits/3/render");
  });

  it("reads summary and interprets text through the project endpoints", async () => {
    const deps = dependencies();
    vi.mocked(deps.request).mockImplementation(async (_method, path) => path.endsWith("/summary")
      ? { total: 4, ready: { summary: true, faces: false, plan: false } }
      : { reply: "A family trip.", change: { kind: "occasion", storyText: "A family trip" } });
    const repository = createApiStoryRepository({ projectId: "project-1" }, deps);
    await expect(repository.getSummary("project-1")).resolves.toMatchObject({ total: 4 });
    await expect(repository.interpret("project-1", { step: "occasion", text: "our trip", context: {} })).resolves.toMatchObject({ change: { kind: "occasion" } });
    expect(deps.request).toHaveBeenNthCalledWith(1, "GET", "/api/projects/project-1/summary");
    expect(deps.request).toHaveBeenNthCalledWith(2, "POST", "/api/projects/project-1/chat/interpret", { step: "occasion", text: "our trip", context: {} });
  });

  it("lists saved films newest first with month, duration, poster and recent-save marker", async () => {
    const deps = dependencies({
      listenUserProjects: vi.fn(async () => [
        { id: "old", createdAt: 1, savedGenerationId: "g-old", title: "Old" },
        { id: "new", createdAt: 2, savedGenerationId: "g-new", title: "New" },
      ]),
      listenDocument: vi.fn(async (path) => {
        if (path === "projects/old/generations/g-old") return { id: "g-old", proposalId: "p-old", status: "saved", savedAt: Date.now() - 60_000, timeline: { durationSec: 125, videoClips: [{ source: { shotId: "old-shot" } }] } };
        if (path === "projects/new/generations/g-new") return { id: "g-new", proposalId: "p-new", status: "saved", savedAt: Date.now() - 60_000, timeline: { durationSec: 90, videoClips: [{ source: { shotId: "new-shot" } }] } };
        if (path === "projects/old") return { dateRange: { start: "2025-06-02", end: "2025-06-03" } };
        if (path === "projects/new") return { dateRange: { start: "2026-09-22", end: "2026-09-23" } };
        if (path.endsWith("/storyProposals/p-old")) return { title: "Old" };
        if (path.endsWith("/storyProposals/p-new")) return { title: "New" };
        return null;
      }),
      listenCollection: vi.fn(async (path) => path === "projects/new/shots" ? [{ id: "new-shot", assetId: "new-asset" }] : [{ id: "old-shot", assetId: "old-asset" }]),
    });
    const films = await createApiStoryRepository({ projectId: "unused" }, deps).listFilms();
    expect(films).toEqual([
      { projectId: "new", filmId: "g-new", title: "New", month: "Sep 2026", duration: "1:30", posterUrl: "https://storage.test/new/new-asset?signed=true", justSaved: true },
      { projectId: "old", filmId: "g-old", title: "Old", month: "Jun 2025", duration: "2:05", posterUrl: "https://storage.test/old/old-asset?signed=true", justSaved: true },
    ]);
  });

  it("groups repeated faces by character and counts distinct shots", async () => {
    const deps = dependencies();
    vi.mocked(deps.request).mockImplementation(async (_method, path) => path.endsWith("/characters") ? { shots: [
      { shotId: "shot-1", assetId: "asset-1", faces: [{ faceId: "face-1", characterId: "char-1", bbox: [0.1, 0.2, 0.4, 0.5] }, { faceId: "face-2", characterId: "char-1", bbox: [0.2, 0.3, 0.5, 0.6] }] },
      { shotId: "shot-2", assetId: "asset-2", faces: [{ faceId: "face-3", characterId: "char-1", bbox: [0.3, 0.4, 0.7, 0.8] }] },
    ] } : { cast: { people: [{ personId: "char-1", name: "Mia", role: "child" }] } });
    const repository = createApiStoryRepository({ projectId: "project-1" }, deps);
    await expect(repository.getPeople("project-1")).resolves.toEqual([{ personId: "char-1", name: "Mia", role: "child", momentCount: 2, sampleShotIds: ["shot-1", "shot-2"], sampleFaces: [
      { shotId: "shot-1", uri: "https://storage.test/project-1/asset-1?signed=true", bbox: [0.1, 0.2, 0.4, 0.5] },
      { shotId: "shot-2", uri: "https://storage.test/project-1/asset-2?signed=true", bbox: [0.3, 0.4, 0.7, 0.8] },
    ], days: [1] }]);
    expect(deps.getThumbnailUrl).toHaveBeenCalledWith("project-1", "asset-1");
    expect(deps.getThumbnailUrl).toHaveBeenCalledWith("project-1", "asset-2");
  });

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

  it("opens the project's current version when the link names an older one", async () => {
    const deps = dependencies();
    const base = deps.listenDocument;
    deps.listenDocument = vi.fn(async (path, waitForExists) => {
      if (path === "projects/project-1") return { id: "project-1", currentProposalId: "proposal-2" };
      if (path === "projects/project-1/storyProposals/proposal-2") return { ...(await base("projects/project-1/storyProposals/proposal-1")) as object, id: "proposal-2", title: "Edited" };
      return base(path, waitForExists);
    });
    const plan = await createApiStoryRepository({ projectId: "project-1" }, deps).getPlan("proposal-1");
    expect(plan.planId).toBe("proposal-2");
    expect(plan.title).toBe("Edited");
  });

  it("counts every project shot the proposal left out, not the shots it kept", async () => {
    const plan = await createApiStoryRepository({ projectId: "project-1" }, dependencies()).getPlan("proposal-1");

    expect(plan.otherPhotoCount).toBe(1);
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

const settings = {
  schemaVersion: 1, id: "settings-1", projectId: "project-1", version: 1, note: "",
  cadenceId: "playful", soundtrackId: null, durationId: "30s", aspect: "9:16", captions: false,
};

function generation(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1, id: "gen-1", projectId: "project-1", proposalId: "proposal-1", parentGenerationId: null,
    settings, seed: "seed", status: "playable",
    timeline: { durationSec: 30, videoClips: [{ id: "c1", source: { kind: "photo", shotId: "shot-2" } }, { id: "c2", source: { kind: "photo", shotId: "shot-1" } }] },
    droppedPicks: [], failureReasons: [], outputPath: null, renderProgress: 0,
    ...overrides,
  };
}

function filmDependencies(generations: Record<string, unknown>, overrides: Partial<ApiStoryRepositoryDeps> = {}) {
  const base = dependencies();
  const read = async (path: string) => generations[path] ?? await base.listenDocument(path);
  return dependencies({
    listenDocument: vi.fn(read),
    listenUntil: vi.fn(async (path, accept) => {
      const value = await read(path);
      if (!accept(value)) throw new Error(`listenUntil would hang on ${path}`);
      return value;
    }),
    ...overrides,
  });
}

describe("film adapters", () => {
  const genPath = "projects/project-1/generations/gen-1";

  it("keeps the media kind on alternatives so collage slots can enforce one video", async () => {
    const deps = dependencies({ request: vi.fn(async () => ({ shots: [{ shotId: "video-2", thumbUrl: "thumb:video", kind: "video" }] })) });
    await expect(createApiStoryRepository({ projectId: "project-1" }, deps).getAlternatives("proposal-1", "moment-1"))
      .resolves.toEqual([{ shotId: "video-2", thumbnailUrl: "thumb:video", kind: "video" }]);
  });

  it("returns the direction options route body unchanged", async () => {
    const body = { note: "n", rewrites: [], cadences: [], soundtracks: [], durations: [], recommendedDuration: "30s", recommendedCadence: "playful", cadenceReason: "kids laughing" };
    const deps = dependencies({ request: vi.fn(async () => body) });
    await expect(createApiStoryRepository({ projectId: "project-1" }, deps).getDirectionOptions("proposal-1")).resolves.toEqual(body);
    expect(deps.request).toHaveBeenCalledWith("GET", "/api/projects/project-1/proposals/proposal-1/direction-options");
  });

  it("accepts the plan, then posts a generation and returns its id as the film id", async () => {
    const deps = dependencies({
      request: vi.fn(async (_method: string, path: string) => (path.endsWith("/generations") ? { generation: { id: "gen-9" } } : {})),
    });
    const result = await createApiStoryRepository({ projectId: "project-1" }, deps)
      .directFilm("proposal-1", { note: "warm", cadenceId: "playful", soundtrackId: null, durationId: "30s" });
    expect(result).toEqual({ filmId: "gen-9" });
    const calls = vi.mocked(deps.request).mock.calls;
    expect(calls[0]).toEqual(["POST", "/api/projects/project-1/proposals/proposal-1/accept"]);
    expect(calls[1][0]).toBe("POST");
    expect(calls[1][1]).toBe("/api/projects/project-1/generations");
    expect(calls[1][2]).toMatchObject({ proposalId: "proposal-1", settings: { projectId: "project-1", note: "warm", cadenceId: "playful", durationId: "30s", soundtrackId: null, schemaVersion: 1, version: 1, collageAmount: "few", motionFeel: "calm" } });
  });

  it("sends explicitly selected collage density and motion feel in generation settings", async () => {
    const deps = dependencies({ request: vi.fn(async (_method: string, path: string) => path.endsWith("/generations") ? { generation: { id: "gen-9" } } : {}) });
    await createApiStoryRepository({ projectId: "project-1" }, deps).directFilm("proposal-1", {
      note: "", cadenceId: "playful", soundtrackId: null, durationId: null, collageAmount: "lots", motionFeel: "playful",
    });
    const request = vi.mocked(deps.request).mock.calls.find((call) => call[1].endsWith("/generations"));
    expect(request?.[2]).toMatchObject({ settings: { collageAmount: "lots", motionFeel: "playful" } });
  });

  it("sends the chosen soundtrack — accepts the plan, then posts a generation and returns its id as the film id", async () => {
    const deps = dependencies({
      request: vi.fn(async (_method: string, path: string) => (path.endsWith("/generations") ? { generation: { id: "gen-9" } } : {})),
    });
    const result = await createApiStoryRepository({ projectId: "project-1" }, deps)
      .directFilm("proposal-1", { note: "warm", cadenceId: "playful", soundtrackId: "lyria-playful", durationId: "30s" });
    expect(result).toEqual({ filmId: "gen-9" });
    const calls = vi.mocked(deps.request).mock.calls;
    expect(calls[0]).toEqual(["POST", "/api/projects/project-1/proposals/proposal-1/accept"]);
    expect(calls[1][0]).toBe("POST");
    expect(calls[1][1]).toBe("/api/projects/project-1/generations");
    expect(calls[1][2]).toMatchObject({ proposalId: "proposal-1", settings: { projectId: "project-1", note: "warm", cadenceId: "playful", durationId: "30s", soundtrackId: "lyria-playful", schemaVersion: 1, version: 1 } });
  });

  it("still directs the film when the plan was already accepted", async () => {
    const deps = dependencies({
      request: vi.fn(async (_method: string, path: string) => {
        if (path.endsWith("/accept")) throw Object.assign(new Error("invalid_state"), { status: 409 });
        return { generation: { id: "gen-9" } };
      }),
    });
    await expect(createApiStoryRepository({ projectId: "project-1" }, deps)
      .directFilm("proposal-1", { note: "", cadenceId: "playful", soundtrackId: null, durationId: null })).resolves.toEqual({ filmId: "gen-9" });
  });

  it("throws a failed film's reasons instead of showing an empty player", async () => {
    const deps = filmDependencies({ [genPath]: generation({ status: "failed", timeline: null, failureReasons: ["every pick was dropped"] }) });
    await expect(createApiStoryRepository({ projectId: "project-1" }, deps).getFilm("gen-1")).rejects.toThrow("every pick was dropped");
  });

  it("maps a playable film with no video yet, its reasons and its poster", async () => {
    const deps = filmDependencies({ [genPath]: generation({ reasons: ["Closing on the whole family together."], renderProgress: 0.7 }) });
    const film = await createApiStoryRepository({ projectId: "project-1" }, deps).getFilm("gen-1");
    expect(film).toMatchObject({
      filmId: "gen-1", planId: "proposal-1", version: 1, title: "Family weekend", durationSec: 30, momentCount: 2,
      status: "ready", videoUrl: null, rendering: true, reasons: ["Closing on the whole family together."],
      renderProgress: 0.7,
      generationStatus: "playable",
      posterKey: "https://storage.test/project-1/asset-2?signed=true",
    });
    expect(deps.request).not.toHaveBeenCalled();
  });

  it("reads the latest generation status and render progress on each film poll", async () => {
    const generations: Record<string, unknown> = { [genPath]: generation({ status: "composing", timeline: null }) };
    const deps = filmDependencies(generations);
    const repository = createApiStoryRepository({ projectId: "project-1" }, deps);
    const composing = await repository.getFilm("gen-1");
    generations[genPath] = generation({ status: "rendering", renderProgress: 0.56 });
    const rendering = await repository.getFilm("gen-1");
    expect(composing).toMatchObject({ generationStatus: "composing", rendering: true, renderProgress: 0 });
    expect(rendering).toMatchObject({ generationStatus: "rendering", rendering: true, renderProgress: 0.56 });
    expect(deps.listenDocument).toHaveBeenCalledWith(genPath);
    expect(vi.mocked(deps.listenDocument).mock.calls.filter(([path]) => path === genPath)).toHaveLength(2);
  });

  it("gives a saved film its download URL", async () => {
    const deps = filmDependencies({ [genPath]: generation({ status: "saved", outputPath: "renders/u/p/gen-1.mp4" }) }, {
      request: vi.fn(async () => ({ downloadUrl: "http://127.0.0.1:9199/download/film.mp4", outputPath: "renders/u/p/gen-1.mp4" })),
    });
    const film = await createApiStoryRepository({ projectId: "project-1" }, deps).getFilm("gen-1");
    expect(film.videoUrl).toBe("http://127.0.0.1:9199/download/film.mp4");
    expect(film.rendering).toBe(false);
    expect(film.generationStatus).toBe("saved");
    expect(deps.request).toHaveBeenCalledWith("GET", "/api/projects/project-1/generations/gen-1/download");
  });

  it("revises by posting a child generation with the request as its note, never touching the old one", async () => {
    const child = generation({ id: "gen-2", parentGenerationId: "gen-1", settings: { ...settings, version: 2, note: "shorter please" } });
    const deps = filmDependencies({ [genPath]: generation(), "projects/project-1/generations/gen-2": child }, {
      request: vi.fn(async () => ({ generation: { id: "gen-2" } })),
    });
    const film = await createApiStoryRepository({ projectId: "project-1" }, deps).reviseFilm("gen-1", "shorter please");
    expect(deps.listenUntil).toHaveBeenCalledWith("projects/project-1/generations/gen-2", expect.any(Function));
    const calls = vi.mocked(deps.request).mock.calls;
    expect(calls).toHaveLength(1);
    expect(calls[0][0]).toBe("POST");
    expect(calls[0][1]).toBe("/api/projects/project-1/generations");
    expect(calls[0][2]).toMatchObject({ proposalId: "proposal-1", parentGenerationId: "gen-1", settings: { note: "shorter please", version: 2 } });
    expect(film).toMatchObject({ filmId: "gen-2", version: 2 });
  });

  it("requests a render for a film still at playable, then returns its download URL", async () => {
    let status = "playable";
    const deps = filmDependencies({}, {
      listenDocument: vi.fn(async () => generation({ status })),
      listenUntil: vi.fn(async () => generation({ status: "saved", outputPath: "renders/u/p/gen-1.mp4" })),
      request: vi.fn(async (_method: string, path: string) => {
        if (path.endsWith("/render")) status = "rendering";
        return path.endsWith("/download") ? { downloadUrl: "http://x/film.mp4" } : { status: "rendering" };
      }),
    });
    await expect(createApiStoryRepository({ projectId: "project-1" }, deps).saveFilm("gen-1")).resolves.toEqual({ downloadKey: "http://x/film.mp4" });
    expect(deps.request).toHaveBeenCalledWith("POST", "/api/projects/project-1/generations/gen-1/render");
  });

  it("does not ask again for a render compose already started", async () => {
    const deps = filmDependencies({ [genPath]: generation({ status: "rendering" }) }, {
      listenUntil: vi.fn(async () => generation({ status: "saved", outputPath: "renders/u/p/gen-1.mp4" })),
      request: vi.fn(async () => ({ downloadUrl: "http://x/film.mp4" })),
    });
    await expect(createApiStoryRepository({ projectId: "project-1" }, deps).saveFilm("gen-1")).resolves.toEqual({ downloadKey: "http://x/film.mp4" });
    expect(deps.request).not.toHaveBeenCalledWith("POST", expect.stringContaining("/render"));
  });
});
