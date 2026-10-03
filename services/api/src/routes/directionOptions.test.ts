import express from "express";
import type { Firestore } from "firebase-admin/firestore";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { directionOptionsRouter } from "./directionOptions.js";
import { listeningServer } from "../test/listeningServer.js";

describe("direction options contextual copy", () => {
  it.each([undefined, null, 42, "", "x".repeat(301), "For these portraits, I’d suggest a gentle pace.", "For this celebration, I’d suggest a lively rhythm."])("keeps intent distinct from recommendation %j", async (copy) => {
    const proposal = { storyIntentId: "intent-1", moments: [], directionRecommendation: copy };
    const projectRef = {
      get: async () => ({ exists: true, get: () => "owner" }),
      collection: (name: string) => ({ doc: () => ({ get: async () => name === "storyProposals"
        ? { exists: true, data: () => proposal }
        : { exists: true, get: () => "The user's story intent" } }) }),
    };
    const db = { collection: () => ({ doc: () => projectRef }) } as unknown as Firestore;
    const app = express();
    app.use("/api/projects", directionOptionsRouter({ db, auth: (_req, res, next) => { res.locals.userId = "owner"; next(); } }));
    const response = await request(await listeningServer(app)).get("/api/projects/project-1/proposals/proposal-1/direction-options");
    expect(response.status).toBe(200);
    expect(response.body.note).toBe("The user's story intent");
    expect(response.body.recommendation).toBe(typeof copy === "string" && copy.length > 0 && copy.length <= 300 ? copy : undefined);
  });
});
