import { afterEach, describe, expect, it, vi } from "vitest";
import { firebaseDownloadUrlStore } from "./objectStore.js";

afterEach(() => vi.unstubAllEnvs());

describe("firebaseDownloadUrlStore", () => {
  it("signs MP4 URLs as attachments with a safe filename", async () => {
    vi.stubEnv("FIREBASE_STORAGE_EMULATOR_HOST", "");
    const getSignedUrl = vi.fn(async () => ["https://storage.test/signed"]);
    const bucket = { file: vi.fn(() => ({ getSignedUrl })) } as any;
    const url = await firebaseDownloadUrlStore(bucket).signedDownloadUrl("renders/u/p/a film.mp4");
    expect(url).toBe("https://storage.test/signed");
    expect(getSignedUrl).toHaveBeenCalledWith(expect.objectContaining({
      action: "read",
      responseDisposition: 'attachment; filename="a film.mp4"',
    }));
  });
});
