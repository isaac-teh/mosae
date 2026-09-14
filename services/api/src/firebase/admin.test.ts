import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => vi.unstubAllEnvs());

describe("getAdminApp", () => {
  it("refuses mixed emulator and credential configuration before initialization", async () => {
    vi.stubEnv("FIRESTORE_EMULATOR_HOST", "127.0.0.1:8085");
    vi.stubEnv("FIREBASE_PRIVATE_KEY", "private");
    const { getAdminApp } = await import("./admin.js");
    expect(() => getAdminApp()).toThrow("mixed_emulator_and_credentials");
  });
});
