import { describe, it, expect, vi } from "vitest";
import express from "express";
import request from "supertest";
import { listeningServer } from "../test/listeningServer.js";
import type { Firestore } from "firebase-admin/firestore";

vi.mock("../outbox/dispatcher.js", () => ({
  dispatchDue: vi.fn().mockResolvedValue({ delivered: 0, failed: 0 }),
}));

// Default mock supporting the chains used by generationsRouter endpoints.
const db = {
  collection: (name: string) => ({
    doc: (id?: string) => ({
      get: async () => ({ exists: false, data: () => null }),
      update: async () => {},
      set: async () => {},
      add: async () => ({ id: "outbox-1" }),
      collection: (subName?: string) => ({
        doc: (subId?: string) => ({
          get: async () => ({ exists: false, data: () => null }),
          update: async () => {},
          set: async () => {},
        }),
      }),
    }),
  }),
} as unknown as Firestore;

// Helper to build a mock db that supports the full chain: projects → doc() → generations → doc()
function makeDbMock(projectExists = true, genExists = false, genStatus?: string) {
  return {
    collection: vi.fn((name: string) => ({
      doc: vi.fn().mockReturnValue({
        get: vi.fn().mockResolvedValue(
          name === "projects" && projectExists
            ? { exists: true, data: () => ({ userId: "test-user" }), get: (f: string) => ({ userId: "test-user" })[f] }
            : { exists: false },
        ),
        collection: vi.fn((subName: string) => ({
          doc: vi.fn().mockReturnValue({
            id: subName === "generations" ? "gen-123" : undefined,
            get: vi.fn().mockResolvedValue(
              genExists && subName === "generations"
                ? { exists: true, data: () => ({ status: genStatus ?? "completed", renderUrl: "/render.mp4" }) }
                : { exists: false },
            ),
            collection: vi.fn(() => ({ doc: vi.fn(() => ({ get: vi.fn().mockResolvedValue({ exists: false }) })) })),
            set: vi.fn().mockResolvedValue(undefined),
          }),
        })),
      }),
    })),
  };
}

vi.mock("../auth/requireUser.js", () => ({
  requireUser: vi.fn(() => (_req: any, res: any, next: any) => {
    res.locals.userId = "test-user";
    next();
  }),
}));

const { generationsRouter } = await import("./generations.js");

const settings = {
  schemaVersion: 1, id: "settings-1", projectId: "p1", version: 1, note: "",
  cadenceId: "tender", soundtrackId: null, durationId: "30s", aspect: "9:16", captions: false,
};

function buildApp({
  db: customDb,
}: { db?: Firestore } = {}) {
  const app = express();
  app.use(express.json());
  app.use(
    "/api/projects",
    generationsRouter({ db: customDb ?? (db as Firestore) }),
  );
  return app;
}

describe("generationsRouter", () => {
  describe("POST /api/projects/:id/generations", () => {
    it.each([["missing", false, true], ["person-1", true, true], ["person-1", false, false]])("rejects focus outside the confirmed included cast (%s)", async (focus, excluded, confirmed) => {
      const dbMock = { collection: () => ({ doc: () => ({ get: async () => ({ exists: true, get: () => "test-user" }), collection: () => ({ doc: () => ({ get: async () => ({ exists: true, data: () => ({ confirmed, people: [{ personId: "person-1", excluded }] }) }) }) }) }) }) };
      const res = await request(await listeningServer(buildApp({ db: dbMock as unknown as Firestore }))).post("/api/projects/p1/generations").send({ proposalId: "proposal-1", settings: { ...settings, focus } });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe("invalid_focus");
    });

    it("returns 400 when proposalId is missing", async () => {
      // Need an existing project so the route passes ownership check and reaches body validation.
      const dbMock = {
        collection: vi.fn((name: string) => ({
          doc: vi.fn().mockReturnValue({
            get: vi.fn().mockResolvedValue({ exists: true, data: () => ({ userId: "test-user" }), get: (field: string) => ({ userId: "test-user" })[field] }),
          }),
        })),
      };
      const res = await request(await listeningServer(buildApp({ db: dbMock as unknown as Firestore })))
        .post("/api/projects/p1/generations")
        .set("Authorization", "Bearer user-token")
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("missing_proposal_id");
    });

    it("returns 403 when project ownership check fails", async () => {
      const dbMock = {
        collection: vi.fn(() => ({
          doc: vi.fn().mockReturnValue({
            get: vi.fn().mockResolvedValue({ exists: false }),
          }),
        })),
      };
      const res = await request(await listeningServer(buildApp({ db: dbMock as unknown as Firestore })))
        .post("/api/projects/p1/generations")
        .set("Authorization", "Bearer user-token")
        .send({ proposalId: "proposal-1" });

      expect(res.status).toBe(403);
    });

    it.each([undefined, "family", "person-1"])("returns 201 for valid generation focus %s", async (focus) => {
      const dbMock = {
        collection: vi.fn((name: string) => ({
          doc: vi.fn().mockReturnValue({
            get: vi.fn().mockResolvedValue({
              exists: true,
              data: () => ({ userId: "test-user" }),
              get: (field: string) => {
                const d: Record<string, string> = { userId: "test-user" };
                return d[field];
              },
            }),
            collection: vi.fn((subName: string) => ({
              doc: vi.fn().mockReturnValue({
                id: "gen-123",
                get: vi.fn().mockResolvedValue({ exists: true, data: () => ({ confirmed: true, people: [{ personId: "person-1", excluded: false }] }) }),
                set: vi.fn().mockResolvedValue(undefined),
              }),
            })),
          }),
        })),
      };

      // Add outbox support: the route calls deps.db.collection("outbox").add() after creation.
      (dbMock as any).collection.mockImplementation((name: string) => {
        if (name === "outbox") {
          return { add: vi.fn().mockResolvedValue({ id: "outbox-1" }) };
        }
        return {
          doc: vi.fn().mockReturnValue({
            get: vi.fn().mockResolvedValue({
              exists: true,
              data: () => ({ userId: "test-user" }),
              get: (field: string) => {
                const d: Record<string, string> = { userId: "test-user" };
                return d[field];
              },
            }),
            collection: vi.fn((subName: string) => ({
              doc: vi.fn().mockReturnValue({
                id: "gen-123",
                get: vi.fn().mockResolvedValue({ exists: true, data: () => ({ confirmed: true, people: [{ personId: "person-1", excluded: false }] }) }),
                set: vi.fn().mockResolvedValue(undefined),
              }),
            })),
          }),
          batch: undefined,
        };
      });
      (dbMock as any).batch = vi.fn(() => ({
        set: vi.fn(), update: vi.fn(), commit: vi.fn().mockResolvedValue(undefined),
      }));
      (dbMock as any).runTransaction = vi.fn(async (run: (tx: any) => unknown) => run({
        get: (ref: { get: () => Promise<unknown> }) => ref.get(),
        set: vi.fn(), update: vi.fn(),
      }));

      const res = await request(await listeningServer(buildApp({ db: dbMock as unknown as Firestore })))
        .post("/api/projects/p1/generations")
        .set("Authorization", "Bearer user-token")
        .send({ proposalId: "proposal-1", settings: { ...settings, ...(focus === undefined ? {} : { focus }) } });

      expect(res.status).toBe(201);
    });

    it("refuses a generation with no direction settings rather than inventing them", async () => {
      const dbMock = {
        collection: vi.fn(() => ({
          doc: vi.fn().mockReturnValue({
            get: vi.fn().mockResolvedValue({ exists: true, data: () => ({ userId: "test-user" }), get: (f: string) => ({ userId: "test-user" } as Record<string, string>)[f] }),
          }),
        })),
      };

      const res = await request(await listeningServer(buildApp({ db: dbMock as unknown as Firestore })))
        .post("/api/projects/p1/generations")
        .set("Authorization", "Bearer user-token")
        .send({ proposalId: "proposal-1" });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("missing_settings");
    });
  });

  describe("GET /api/projects/:id/generations/:gid", () => {
    it("returns 404 when generation not found", async () => {
      const dbMock = {
        collection: vi.fn((name: string) => ({
          doc: vi.fn().mockReturnValue({
            get: vi.fn().mockResolvedValue({ exists: false }),
            collection: vi.fn(() => ({
              doc: vi.fn().mockReturnValue({
                get: vi.fn().mockResolvedValue({ exists: false }),
              }),
            })),
          }),
        })),
      };

      const res = await request(await listeningServer(buildApp({ db: dbMock as unknown as Firestore })))
        .get("/api/projects/p1/generations/gen-123")
        .set("Authorization", "Bearer user-token");

      expect(res.status).toBe(404);
    });
  });

  describe("POST /api/projects/:id/generations/:gid/render", () => {
    it("returns 400 when generation has no timeline", async () => {
      const dbMock = {
        collection: vi.fn((name: string) => ({
          doc: vi.fn().mockReturnValue({
            get: vi.fn().mockResolvedValue({ exists: true, data: () => ({ status: "pending" }) }),
            collection: vi.fn(() => ({
              doc: vi.fn().mockReturnValue({
                get: vi.fn().mockResolvedValue({ exists: false }),
              }),
            })),
          }),
        })),
      };

      const res = await request(await listeningServer(buildApp({ db: dbMock as unknown as Firestore })))
        .post("/api/projects/p1/generations/gen-123/render")
        .set("Authorization", "Bearer user-token");

      expect(res.status).toBe(400);
    });
  });

  describe("GET /api/projects/:id/generations/:gid/download", () => {
    it("returns 404 when generation not found", async () => {
      const dbMock = {
        collection: vi.fn((name: string) => ({
          doc: vi.fn().mockReturnValue({
            get: vi.fn().mockResolvedValue({ exists: false }),
            collection: vi.fn(() => ({
              doc: vi.fn().mockReturnValue({
                get: vi.fn().mockResolvedValue({ exists: false }),
              }),
            })),
          }),
        })),
      };

      const res = await request(await listeningServer(buildApp({ db: dbMock as unknown as Firestore })))
        .get("/api/projects/p1/generations/gen-123/download")
        .set("Authorization", "Bearer user-token");

      expect(res.status).toBe(404);
    });

    it("returns 400 when render not complete", async () => {
      const dbMock = makeDbMock(true, true, "pending");

      const res = await request(await listeningServer(buildApp({ db: dbMock as unknown as Firestore })))
        .get("/api/projects/p1/generations/gen-123/download")
        .set("Authorization", "Bearer user-token");

      expect(res.status).toBe(400);
    });
  });
});
