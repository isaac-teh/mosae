import express, { type RequestHandler } from "express";
import request from "supertest";
import { listeningServer } from "../test/listeningServer.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Firestore } from "firebase-admin/firestore";
import type { GenerateOptions } from "../gemini/client.js";

const fixturesDir = fileURLToPath(new URL("../../fixtures/gemini/", import.meta.url));
afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("chat interpret replay route", () => {
  it("parses the four recorded answers through the route and Gemini replay adapter", async () => {
    vi.stubEnv("MOCK_GEMINI", "replay");
    vi.resetModules();
    const [{ chatInterpretRouter }, { generateStructured }, { createGeminiClient }] = await Promise.all([
      import("./chatInterpret.js"), import("../gemini/client.js"), import("../gemini/wire.js"),
    ]);
    // The four plan examples; later end-to-end runs record more interpret fixtures beside them.
    const files = ["interpret-59a4430195ee.json", "interpret-013f57fa78a0.json", "interpret-72eee5878df8.json", "interpret-251315051b00.json", "interpret-c72662d83cc0.json", "interpret-0d8b9329099c.json"];
    for (const name of files) expect(readdirSync(fixturesDir)).toContain(name);
    const fixtures = files.map((name) => JSON.parse(readFileSync(`${fixturesDir}/${name}`, "utf8")) as { request: string });
    const examples = fixtures.map(({ request: requestText }) => {
      const modelRequest = JSON.parse(requestText) as { contents: { text: string }[] };
      const prompt = modelRequest.contents[0]!.text;
      const step = /\nStep: (occasion|people|moments|direction)\n/.exec(prompt)?.[1];
      const contextText = /\nContext: (.+)\nText: /s.exec(prompt)?.[1];
      const text = /\nText: ([\s\S]*)$/.exec(prompt)?.[1];
      if (!step || !contextText || !text) throw new Error("invalid recorded interpretation fixture");
      return { step, context: JSON.parse(contextText), text };
    }).sort((left, right) => ["occasion", "people", "moments", "direction"].indexOf(left.step) - ["occasion", "people", "moments", "direction"].indexOf(right.step));

    const owner = "replay-owner";
    const projectId = "replay-project-0001";
    const db = {
      collection: () => ({ doc: (id: string) => ({ get: async () => ({ exists: true, get: (field: string) => field === "userId" ? owner : undefined, data: () => ({ id, userId: owner }) }) }) }),
    } as unknown as Firestore;
    const auth: RequestHandler = (_req, res, next) => { res.locals.userId = owner; next(); };
    const app = express();
    app.use(express.json());
    app.use("/api/projects", chatInterpretRouter({
      db,
      auth,
      generate: (options) => generateStructured(options as GenerateOptions<unknown>, {
        generateContent: createGeminiClient(),
        recordUsage: () => {},
      }),
      searchShots: async (_id, query) => {
        expect(query.toLowerCase()).toContain("snow monkey");
        return ["snow-monkey-shot"];
      },
    }));

    const expected = [
      { step: "occasion", text: "it's grandma's 70th, not a trip", kind: "occasion", fields: { storyText: "Grandma's 70th birthday" } },
      { step: "people", kind: "person", fields: { name: "Mia", role: "child" } },
      { step: "moments", kind: "moments", fields: { mustIncludeShotIds: ["snow-monkey-shot"] } },
      { step: "direction", kind: "direction", fields: { pace: "lively", lengthSec: 60 } },
    ];
    for (const example of expected) {
      const input = examples.find(({ step, text }) => step === example.step && (!example.text || text === example.text))!;
      const response = await request(await listeningServer(app)).post(`/api/projects/${projectId}/chat/interpret`).send(input);
      expect(response.status, example.step).toBe(200);
      expect(response.body.change, example.step).toMatchObject({ kind: example.kind, ...example.fields });
    }

    const singaporeExamples = examples.filter(({ step, text }) => step === "occasion" && text === "it's our Singapore holiday with the kids");
    expect(singaporeExamples).toHaveLength(2);
    for (const singapore of singaporeExamples) {
      const singaporeResponse = await request(await listeningServer(app)).post(`/api/projects/${projectId}/chat/interpret`).send(singapore);
      expect(singaporeResponse.status).toBe(200);
      expect(singaporeResponse.body.change).toMatchObject({
        kind: "occasion",
        storyText: singapore.context.summary.processed.understood === 13 ? "Singapore holiday with the kids" : "Singapore family holiday",
      });
    }
  });
});
