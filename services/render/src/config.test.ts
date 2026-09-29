import { describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";

describe("loadConfig", () => {
  it("returns no-auth configuration during local development", () => {
    expect(loadConfig({ NODE_ENV: "development" })).toMatchObject({ production: false, serviceCaller: null, outputDir: "/tmp/mosae-renders" });
  });

  it("requires the service caller configuration in production", () => {
    expect(() => loadConfig({ NODE_ENV: "production" })).toThrow("missing env API_SERVICE_URL");
    expect(() => loadConfig({ NODE_ENV: "production", API_SERVICE_URL: "https://api.example" })).toThrow("missing env SERVICE_URL");
    expect(() => loadConfig({ NODE_ENV: "production", API_SERVICE_URL: "https://api.example", SERVICE_URL: "https://render.example" })).toThrow("missing env INVOKER_SERVICE_ACCOUNTS");
  });
});
