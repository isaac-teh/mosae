import { afterEach, describe, expect, it, vi } from "vitest";
import { requireStorageEmulator } from "./seedDemoLocal.js";

afterEach(() => vi.unstubAllEnvs());

describe("requireStorageEmulator", () => {
  it("refuses to run when the storage emulator host is missing", () => {
    vi.stubEnv("FIREBASE_STORAGE_EMULATOR_HOST", "");

    expect(() => requireStorageEmulator()).toThrow("FIREBASE_STORAGE_EMULATOR_HOST must be set");
  });
});
