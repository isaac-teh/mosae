import { describe, it, expect } from "vitest";
import { loadConfig } from "./config.js";

const base = { FIREBASE_STORAGE_BUCKET: "b", SERVICE_URL: "http://localhost:8080" };
const tasks = { GCP_PROJECT_ID: "p", TASKS_LOCATION: "l", TASKS_QUEUE: "q", TASKS_INVOKER_SERVICE_ACCOUNT: "sa@p.iam.gserviceaccount.com" };
const prod = { ...tasks, RENDER_SERVICE_URL: "https://render.example", NODE_ENV: "production" };

describe("loadConfig", () => {
  it("allows local development without Cloud Tasks", () => {
    expect(loadConfig(base)).toMatchObject({ production: false, tasks: null, invokerEmails: [], port: 8080, geminiApiKey: "" });
  });

  it("uses configurable face matching thresholds with spike defaults", () => {
    expect(loadConfig(base)).toMatchObject({ faceMatchThreshold: 0.85, faceGroupMergeThreshold: 0.78 });
    expect(loadConfig({ ...base, FACE_MATCH_THRESHOLD: "0.9", FACE_GROUP_MERGE_THRESHOLD: "0.8" }))
      .toMatchObject({ faceMatchThreshold: 0.9, faceGroupMergeThreshold: 0.8 });
  });

  it("passes through GEMINI_API_KEY without requiring it", () => {
    expect(loadConfig({ ...base, GEMINI_API_KEY: "test-key" }).geminiApiKey).toBe("test-key");
  });

  it("requires bucket and service URL everywhere", () => {
    expect(() => loadConfig({ SERVICE_URL: "x" })).toThrow("missing env FIREBASE_STORAGE_BUCKET");
    expect(() => loadConfig({ FIREBASE_STORAGE_BUCKET: "b" })).toThrow("missing env SERVICE_URL");
  });

  it("requires Cloud Tasks and invokers in production", () => {
    expect(() => loadConfig({ ...base, NODE_ENV: "production", INVOKER_SERVICE_ACCOUNTS: "a@b", ALLOWED_ORIGINS: "https://web.example" })).toThrow("missing env GCP_PROJECT_ID");
    const config = loadConfig({ ...base, ...prod, INVOKER_SERVICE_ACCOUNTS: "a@b, c@d", ALLOWED_ORIGINS: "https://web.example" });
    expect(config.invokerEmails).toEqual(["a@b", "c@d"]);
    expect(config.tasks?.queue).toBe("q");
  });

  it("trims allowed origins and requires them in production", () => {
    expect(loadConfig({ ...base, ALLOWED_ORIGINS: " https://web.example, https://admin.example " }).allowedOrigins).toEqual(["https://web.example", "https://admin.example"]);
    expect(() => loadConfig({ ...base, ...prod, INVOKER_SERVICE_ACCOUNTS: "a@b" })).toThrow("missing env ALLOWED_ORIGINS");
  });

  it("requires the render service URL in production and defaults it locally", () => {
    // Without it, saving a film enqueues a task that can reach nothing.
    expect(() => loadConfig({ ...base, ...tasks, NODE_ENV: "production", INVOKER_SERVICE_ACCOUNTS: "a@b", ALLOWED_ORIGINS: "https://web.example" }))
      .toThrow("missing env RENDER_SERVICE_URL");
    expect(loadConfig(base).renderServiceUrl).toBe("http://127.0.0.1:8081");
    expect(loadConfig({ ...base, RENDER_SERVICE_URL: "http://elsewhere" }).renderServiceUrl).toBe("http://elsewhere");
  });
});
