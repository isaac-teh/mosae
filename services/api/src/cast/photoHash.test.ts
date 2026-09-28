import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { Firestore } from "firebase-admin/firestore";
import type { getStorage } from "firebase-admin/storage";
import { projectPhotoHashes, sha256Hex } from "./photoHash.js";

type Bucket = ReturnType<ReturnType<typeof getStorage>["bucket"]>;

/** A fake asset store plus a map of storage path -> bytes. */
function makeDeps(
  assets: { id: string; storagePath: string }[],
  files: Record<string, Buffer>,
) {
  const deps = {
    listAssets: async (_projectId: string) => assets,
    readBytes: async (storagePath: string) => {
      const bytes = files[storagePath];
      if (!bytes) throw new Error(`missing ${storagePath}`);
      return bytes;
    },
  };
  return deps;
}

describe("sha256Hex", () => {
  it("matches a sha256 computed in the test", () => {
    const bytes = Buffer.from("hello world");
    expect(sha256Hex(bytes)).toBe(createHash("sha256").update(bytes).digest("hex"));
  });

  it("is deterministic and lowercase hex", () => {
    const bytes = Buffer.from([0, 1, 2, 3, 255]);
    expect(sha256Hex(bytes)).toMatch(/^[0-9a-f]{64}$/);
    expect(sha256Hex(bytes)).toBe(sha256Hex(Buffer.from([0, 1, 2, 3, 255])));
  });
});

describe("projectPhotoHashes", () => {
  it("skips assets without a storage path", async () => {
    const readBytes = vi.fn(async () => Buffer.from("photo"));
    const hashes = await projectPhotoHashes({ listAssets: async () => [{ id: "no-path" }], readBytes }, "p1");
    expect(hashes.size).toBe(0);
    expect(readBytes).not.toHaveBeenCalled();
  });
  it("gives two correct hashes for two assets", async () => {
    const bytesA = Buffer.from("photo-a-bytes");
    const bytesB = Buffer.from("photo-b-bytes-different");
    const deps = makeDeps(
      [
        { id: "assetA", storagePath: "uploads/a.jpg" },
        { id: "assetB", storagePath: "uploads/b.jpg" },
      ],
      { "uploads/a.jpg": bytesA, "uploads/b.jpg": bytesB },
    );

    const hashes = await projectPhotoHashes(deps, "p1");

    expect(hashes.get("assetA")).toBe(createHash("sha256").update(bytesA).digest("hex"));
    expect(hashes.get("assetB")).toBe(createHash("sha256").update(bytesB).digest("hex"));
    expect([...hashes.keys()].sort()).toEqual(["assetA", "assetB"]);
  });

  it("gives an identical hash for identical bytes across two assets", async () => {
    const same = Buffer.from("identical-image-bytes");
    const deps = makeDeps(
      [
        { id: "dup1", storagePath: "uploads/dup1.jpg" },
        { id: "dup2", storagePath: "uploads/dup2.jpg" },
      ],
      { "uploads/dup1.jpg": same, "uploads/dup2.jpg": same },
    );

    const hashes = await projectPhotoHashes(deps, "p1");

    expect(hashes.get("dup1")).toBe(hashes.get("dup2"));
    expect(hashes.get("dup1")).toBe(createHash("sha256").update(same).digest("hex"));
  });
});
