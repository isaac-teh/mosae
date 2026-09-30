import { afterEach, describe, expect, it, vi } from "vitest";

describe("API repository app startup", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("boots when API stories are enabled without a fixed story project ID", async () => {
    vi.stubEnv("EXPO_PUBLIC_USE_API_STORY_REPOSITORY", "true");
    vi.stubEnv("EXPO_PUBLIC_STORY_PROJECT_ID", "");

    await expect(import("../lib/core")).resolves.toBeDefined();
  });
});
