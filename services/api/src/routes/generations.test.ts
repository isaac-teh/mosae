import { describe, it, expect, vi } from "vitest";
import express from "express";
import request from "supertest";
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
    it("returns 400 when proposalId is missing", async () => {
      // Need an existing project so the route passes ownership check and reaches body validation.
      const dbMock = {
        collection: vi.fn((name: string) => ({
          doc: vi.fn().mockReturnValue({
            get: vi.fn().mockResolvedValue({ exists: true, data: () => ({ userId: "test-user" }), get: (field: string) => ({ userId: "test-user" })[field] }),
          }),
        })),
      };
      const res = await request(buildApp({ db: dbMock as unknown as Firestore }))
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
      const res = await request(buildApp({ db: dbMock as unknown as Firestore }))
        .post("/api/projects/p1/generations")
        .set("Authorization", "Bearer user-token")
        .send({ proposalId: "proposal-1" });

      expect(res.status).toBe(403);
    });

    it("returns 201 when generation is created successfully", async () => {
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
                set: vi.fn().mockResolvedValue(undefined),
              }),
            })),
          }),
        };
      });

      const res = await request(buildApp({ db: dbMock as unknown as Firestore }))
        .post("/api/projects/p1/generations")
        .set("Authorization", "Bearer user-token")
        .send({ proposalId: "proposal-1" });

      expect(res.status).toBe(201);
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

      const res = await request(buildApp({ db: dbMock as unknown as Firestore }))
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

      const res = await request(buildApp({ db: dbMock as unknown as Firestore }))
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

      const res = await request(buildApp({ db: dbMock as unknown as Firestore }))
        .get("/api/projects/p1/generations/gen-123/download")
        .set("Authorization", "Bearer user-token");

      expect(res.status).toBe(404);
    });

    it("returns 400 when render not complete", async () => {
      const dbMock = makeDbMock(true, true, "pending");

      const res = await request(buildApp({ db: dbMock as unknown as Firestore }))
        .get("/api/projects/p1/generations/gen-123/download")
        .set("Authorization", "Bearer user-token");

      expect(res.status).toBe(400);
    });
  });
});
