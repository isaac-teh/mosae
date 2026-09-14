import { describe, it, expect } from "vitest";
import { loadConfig } from "./config.js";

const base = { FIREBASE_STORAGE_BUCKET: "b", SERVICE_URL: "http://localhost:8080" };
const tasks = { GCP_PROJECT_ID: "p", TASKS_LOCATION: "l", TASKS_QUEUE: "q", TASKS_INVOKER_SERVICE_ACCOUNT: "sa@p.iam.gserviceaccount.com" };

describe("loadConfig", () => {
  it("allows local development without Cloud Tasks", () => {
    expect(loadConfig(base)).toMatchObject({ production: false, tasks: null, invokerEmails: [], port: 8080 });
  });

  it("requires bucket and service URL everywhere", () => {
    expect(() => loadConfig({ SERVICE_URL: "x" })).toThrow("missing env FIREBASE_STORAGE_BUCKET");
  });

  it("requires Cloud Tasks and invokers in production", () => {
    expect(() => loadConfig({ ...base, NODE_ENV: "production", INVOKER_SERVICE_ACCOUNTS: "a@b" })).toThrow("missing env GCP_PROJECT_ID");
    const config = loadConfig({ ...base, ...tasks, NODE_ENV: "production", INVOKER_SERVICE_ACCOUNTS: "a@b, c@d" });
    expect(config.invokerEmails).toEqual(["a@b", "c@d"]);
    expect(config.tasks?.queue).toBe("q");
  });
});
