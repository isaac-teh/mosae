import { describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Firestore } from "firebase-admin/firestore";

describe("demo Gemini fallback", () => {
  it("uses live only on an exact fixture miss and caps it at 30 calls per project", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "demo-fixtures-"));
    vi.stubEnv("GEMINI_FIXTURES", dir);
    vi.resetModules();
    try {
      const { createProjectGeminiClient } = await import("./wire.js");
      const { DemoLimitReached } = await import("./errors.js");
      const data = { demo: "trip1-v2", demoLiveCalls: 0 };
      const ref = { get: async () => ({ exists: true, get: (key: keyof typeof data) => data[key] }) };
      const db = {
        collection: () => ({ doc: () => ref }),
        runTransaction: async (work: (tx: { get: (r: typeof ref) => ReturnType<typeof ref.get>; update: (_r: typeof ref, patch: Partial<typeof data>) => void }) => Promise<void>) => work({
          get: (r) => r.get(), update: (_r, patch) => Object.assign(data, patch),
        }),
      } as unknown as Firestore;
      const live = vi.fn(async () => ({ text: "{}", usageMetadata: {} }));
      const generate = createProjectGeminiClient({ db, projectId: "project-1", live });
      for (let i = 0; i < 30; i++) await generate({ model: "test", contents: `unrecorded-${i}` });
      await expect(generate({ model: "test", contents: "unrecorded-30" })).rejects.toBeInstanceOf(DemoLimitReached);
      expect(live).toHaveBeenCalledTimes(30);
      expect(data.demoLiveCalls).toBe(30);
    } finally {
      rmSync(dir, { recursive: true, force: true });
      vi.unstubAllEnvs();
    }
  });
});
