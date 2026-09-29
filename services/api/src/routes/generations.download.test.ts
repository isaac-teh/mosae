import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import type { Firestore } from "firebase-admin/firestore";

// The route verifies ownership through requireUser; mock it so the real auth
// emulator is not needed (the existing generations tests do the same).
vi.mock("../auth/requireUser.js", () => ({
  requireUser: vi.fn(() => (_req: unknown, res: { locals: { userId: string } }, next: () => void) => {
    res.locals.userId = "owner";
    next();
  }),
}));

// The route verifies ownership and reads the generation through this chain.
function makeDb(generation: Record<string, unknown> | null, edits?: Record<string, unknown>) {
  const records: Record<string, Record<string, unknown>> = {
    "projects/p1": { id: "p1", userId: "owner" },
  };
  if (generation) records["projects/p1/generations/g1"] = generation;
  if (edits) records["projects/p1/generations/g1/edits/current"] = edits;
  const ref = (key: string): unknown => ({
    collection: (name: string) => ({ doc: (id: string) => ref(`${key}/${name}/${id}`) }),
    get: async () => ({ exists: key in records, data: () => records[key], get: (field: string) => records[key]?.[field] }),
  });
  return { collection: (name: string) => ({ doc: (id?: string) => ref(id ? `${name}/${id}` : name) }) } as unknown as Firestore;
}

const generation = {
  schemaVersion: 1, id: "g1", projectId: "p1", proposalId: "pr1", parentGenerationId: null,
  settings: { schemaVersion: 1, id: "d1", projectId: "p1", version: 1, note: "", cadenceId: "tender", soundtrackId: null, durationId: "30s", aspect: "9:16" as const, captions: false },
  seed: "s", status: "saved", timeline: null, droppedPicks: [], failureReasons: [], outputPath: "renders/owner/p1/g1.mp4", renderProgress: 1,
};

// A fake firebase-admin/storage bucket whose file().getSignedUrl() records the call.
function makeBucket() {
  const calls: Array<{ path: string; options: unknown }> = [];
  const bucket = {
    name: "demo-mosae.appspot.com",
    file: (path: string) => ({ getSignedUrl: async (options: unknown) => { calls.push({ path, options }); return [`https://storage.test/${path}?sig=abc`]; } }),
  };
  return { bucket, calls };
}

// The route dynamically imports firebase-admin/storage and ../firebase/admin.js;
// mock both so the emulator branch can be exercised without a real app. The
// factory reads `currentBucket`, which each test sets before building its app.
let currentBucket: unknown = {};
let requestedBucket: string | undefined;
vi.mock("firebase-admin/storage", () => ({ getStorage: () => ({ bucket: (name?: string) => { requestedBucket = name; return currentBucket; } }) }));
vi.mock("../firebase/admin.js", () => ({ getAdminApp: () => ({}), adminDb: {} }));

const { generationsRouter } = await import("./generations.js");

function buildApp(db: Firestore, fakeBucket: ReturnType<typeof makeBucket>, sourceDeps: {
  loadSource?: (projectId: string, shotId: string) => Promise<{ storagePath: string; derivatives?: { proxyPath?: string | null; renderPath?: string | null; thumbPath: string } } | null>;
  loadSoundtrack?: (soundtrackId: string) => Promise<string | null>;
  loadSoundtrackLibrary?: () => Promise<{ id: string; path: string }[]>;
  loadUnusedMedia?: (projectId: string, timeline: unknown) => Promise<{ shotId: string; kind: "photo" | "video"; thumbnailUrl: string; previewUrl: string; date: string; eventLabel: string; sourceInSec?: number; sourceOutSec?: number }[]>;
  signReadUrl?: (path: string, expiresAt: number) => Promise<string>;
} = {}) {
  currentBucket = fakeBucket.bucket;
  const app = express();
  app.use(express.json());
  app.use("/api/projects", generationsRouter({ db, storageBucket: "demo-mosae.appspot.com", dispatch: async () => undefined, ...sourceDeps }));
  return app;
}

beforeEach(() => {
  delete process.env.FIREBASE_STORAGE_EMULATOR_HOST;
});

describe("GET /download — emulator branch", () => {
  it("returns browser-loadable sources for every clip and the selected soundtrack in a stored generation", async () => {
    const storedTimeline = {
      schemaVersion: 1,
      projectId: "p1",
      mode: "creator",
      aspect: "9:16",
      fps: 30,
      durationSec: 8,
      chapters: [{ title: "Trip", startSec: 0 }],
      videoClips: ["shot-a", "shot-b"].map((shotId, index) => ({
        id: `clip-${index + 1}`, source: { kind: "photo", shotId }, startSec: index * 4, durationSec: 4,
        transitionIn: { kind: "cut", durationSec: 0 },
      })),
      audioClips: [{
        id: "music-1", role: "music", startSec: 0, durationSec: 8, gain: 0.2,
        source: { kind: "soundtrack", soundtrackId: "lyria-energetic", sourceInSec: 0, sourceOutSec: 8 },
      }],
      captions: [],
    };
    const storedGeneration = { ...generation, timeline: storedTimeline };
    const signed: string[] = [];
    const app = buildApp(makeDb(storedGeneration), makeBucket(), {
      loadSource: async (_projectId, shotId) => ({ storagePath: `original/${shotId}.jpg`, derivatives: { thumbPath: `thumb/${shotId}.jpg`, proxyPath: `proxy/${shotId}.mp4` } }),
      loadSoundtrack: async (id) => id === "lyria-energetic" ? "library/music/lyria-energetic.mp3" : null,
      loadSoundtrackLibrary: async () => ["lyria-tender", "lyria-reflective", "lyria-playful", "lyria-energetic", "lyria-celebratory", "lyria-journey"].map((id) => ({ id, path: `library/music/${id}.mp3` })),
      loadUnusedMedia: async (_projectId, timeline) => {
        expect(timeline).toEqual(storedTimeline);
        return [{ shotId: "shot-c", kind: "photo", thumbnailUrl: "http://127.0.0.1:9199/download/thumb/shot-c.jpg", previewUrl: "http://127.0.0.1:9199/download/thumb/shot-c.jpg", date: "2026-06-03", eventLabel: "Day 3, morning" }];
      },
      signReadUrl: async (path) => { signed.push(path); return `http://127.0.0.1:9199/download/${path}`; },
    });

    const res = await request(app).get("/api/projects/p1/generations/g1").set("Authorization", "Bearer owner");

    expect(res.status).toBe(200);
    expect(res.body.timeline.videoClips).toHaveLength(2);
    expect(res.body.timeline.audioClips).toHaveLength(1);
    expect(res.body.unusedMedia).toEqual([{ shotId: "shot-c", kind: "photo", thumbnailUrl: "http://127.0.0.1:9199/download/thumb/shot-c.jpg", previewUrl: "http://127.0.0.1:9199/download/thumb/shot-c.jpg", date: "2026-06-03", eventLabel: "Day 3, morning" }]);
    expect(res.body.sources).toEqual({
      "shot-a": "http://127.0.0.1:9199/download/thumb/shot-a.jpg",
      "shot-b": "http://127.0.0.1:9199/download/thumb/shot-b.jpg",
      "lyria-energetic": "http://127.0.0.1:9199/download/library/music/lyria-energetic.mp3",
      "lyria-tender": "http://127.0.0.1:9199/download/library/music/lyria-tender.mp3",
      "lyria-reflective": "http://127.0.0.1:9199/download/library/music/lyria-reflective.mp3",
      "lyria-playful": "http://127.0.0.1:9199/download/library/music/lyria-playful.mp3",
      "lyria-celebratory": "http://127.0.0.1:9199/download/library/music/lyria-celebratory.mp3",
      "lyria-journey": "http://127.0.0.1:9199/download/library/music/lyria-journey.mp3",
    });
    expect(signed).toHaveLength(8);
    expect(signed).toEqual(expect.arrayContaining(["thumb/shot-a.jpg", "thumb/shot-b.jpg", ...["lyria-tender", "lyria-reflective", "lyria-playful", "lyria-energetic", "lyria-celebratory", "lyria-journey"].map((id) => `library/music/${id}.mp3`)]));
  });

  it("prefers the current edited render over the first cut", async () => {
    const { bucket, calls } = makeBucket();
    const app = buildApp(makeDb(generation, { revision: 3, renderRevision: 3, status: "ready", outputPath: "renders/owner/p1/g1-edit-3.mp4" }), { bucket, calls });
    const res = await request(app).get("/api/projects/p1/generations/g1/download").set("Authorization", "Bearer owner");
    expect(res.status).toBe(200);
    expect(res.body.outputPath).toBe("renders/owner/p1/g1-edit-3.mp4");
    expect(calls[0].path).toBe("renders/owner/p1/g1-edit-3.mp4");
  });

  it("falls back to the first cut when the newest edit has no render", async () => {
    const { bucket, calls } = makeBucket();
    const app = buildApp(makeDb(generation, { revision: 4, renderRevision: 3, status: "ready", outputPath: "renders/owner/p1/g1-edit-3.mp4" }), { bucket, calls });
    const res = await request(app).get("/api/projects/p1/generations/g1/download").set("Authorization", "Bearer owner");
    expect(res.status).toBe(200);
    expect(res.body.outputPath).toBe("renders/owner/p1/g1.mp4");
    expect(calls[0].path).toBe("renders/owner/p1/g1.mp4");
  });

  it("returns the GCS-style emulator download URL when FIREBASE_STORAGE_EMULATOR_HOST is set", async () => {
    process.env.FIREBASE_STORAGE_EMULATOR_HOST = "127.0.0.1:9199";
    const app = buildApp(makeDb(generation), makeBucket());

    const res = await request(app).get("/api/projects/p1/generations/g1/download").set("Authorization", "Bearer owner");
    expect(res.status).toBe(200);
    expect(res.body.downloadUrl).toBe(
      "http://127.0.0.1:9199/download/storage/v1/b/demo-mosae.appspot.com/o/renders%2Fowner%2Fp1%2Fg1.mp4?alt=media",
    );
  });

  it("signs a v4 read URL when no emulator host is set", async () => {
    const { bucket, calls } = makeBucket();
    const app = buildApp(makeDb(generation), { bucket, calls });

    const res = await request(app).get("/api/projects/p1/generations/g1/download").set("Authorization", "Bearer owner");
    expect(res.status).toBe(200);
    expect(calls[0].path).toBe("renders/owner/p1/g1.mp4");
    expect(calls[0].options).toMatchObject({ version: "v4", action: "read" });
  });

  it("reads the configured bucket, since the admin app has no default one", async () => {
    process.env.FIREBASE_STORAGE_EMULATOR_HOST = "127.0.0.1:9199";
    requestedBucket = undefined;
    const app = buildApp(makeDb(generation), makeBucket());
    await request(app).get("/api/projects/p1/generations/g1/download").set("Authorization", "Bearer owner");
    expect(requestedBucket).toBe("demo-mosae.appspot.com");
  });

  it("returns 400 when the render is not complete", async () => {
    const incomplete = { ...generation, status: "rendering", outputPath: null };
    const app = buildApp(makeDb(incomplete), makeBucket());
    const res = await request(app).get("/api/projects/p1/generations/g1/download").set("Authorization", "Bearer owner");
    expect(res.status).toBe(400);
  });

  it("returns 404 when the generation is not found", async () => {
    const app = buildApp(makeDb(null), makeBucket());
    const res = await request(app).get("/api/projects/p1/generations/g1/download").set("Authorization", "Bearer owner");
    expect(res.status).toBe(404);
  });
});
