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
function makeDb(generation: Record<string, unknown> | null) {
  const records: Record<string, Record<string, unknown>> = {
    "projects/p1": { id: "p1", userId: "owner" },
  };
  if (generation) records["projects/p1/generations/g1"] = generation;
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
vi.mock("firebase-admin/storage", () => ({ getStorage: () => ({ bucket: () => currentBucket }) }));
vi.mock("../firebase/admin.js", () => ({ getAdminApp: () => ({}), adminDb: {} }));

const { generationsRouter } = await import("./generations.js");

function buildApp(db: Firestore, fakeBucket: ReturnType<typeof makeBucket>) {
  currentBucket = fakeBucket.bucket;
  const app = express();
  app.use(express.json());
  app.use("/api/projects", generationsRouter({ db, dispatch: async () => undefined }));
  return app;
}

beforeEach(() => {
  delete process.env.FIREBASE_STORAGE_EMULATOR_HOST;
});

describe("GET /download — emulator branch", () => {
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
