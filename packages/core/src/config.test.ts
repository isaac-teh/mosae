import { describe, it, expect } from "vitest";

describe("core config", () => {
  it("throws before configuration and returns the configured values after", async () => {
    const { configureCore, getCoreConfig } = await import("./config");
    expect(() => getCoreConfig()).toThrow("core_not_configured");
    const config = { apiBaseUrl: "http://api.test", firebase: { projectId: "demo" }, useEmulators: true };
    configureCore(config);
    expect(getCoreConfig()).toEqual(config);
  });
});
