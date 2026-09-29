import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Firestore } from "firebase-admin/firestore";
import { createDemoProject } from "./createDemoProject.js";
import { loadDemoBundle } from "./bundle.js";

const { sharpMock } = vi.hoisted(() => ({ sharpMock: vi.fn() }));
vi.mock("sharp", () => ({ default: sharpMock }));

describe("createDemoProject", () => {
  beforeEach(() => {
    const pipeline = {
      rotate: () => pipeline,
      resize: () => pipeline,
      jpeg: () => pipeline,
      toBuffer: async () => Buffer.from("derivative"),
    };
    sharpMock.mockReset().mockReturnValue(pipeline);
  });

  it("copies all originals and derivatives concurrently without downloading or using sharp", async () => {
    let id = 0;
    const writes: Array<{ path: string; value: Record<string, unknown> }> = [];
    const copyCalls: Array<{ source: string; destination: string }> = [];
    let activeOriginalCopies = 0;
    let maxActiveOriginalCopies = 0;
    const refs = new Map<string, ReturnType<typeof makeRef>>();
    function makeRef(path: string) {
      return {
        id: path.split("/").at(-1)!, path,
        set: vi.fn(async () => undefined),
        update: vi.fn(async () => undefined),
        collection: (name: string) => ({ doc: (docId: string) => makeRef(`${path}/${name}/${docId}`) }),
      };
    }
    const getRef = (path: string) => {
      if (!refs.has(path)) refs.set(path, makeRef(path));
      return refs.get(path)!;
    };
    const db = {
      collection: (name: string) => ({
        doc: (docId?: string) => getRef(name === "_ids" ? `ids/${docId ?? `fresh-${++id}`}` : `${name}/${docId ?? "demo-project"}`),
      }),
      batch: () => ({
        set: (ref: { path: string }, value: Record<string, unknown>) => { writes.push({ path: ref.path, value }); },
        commit: vi.fn(async () => undefined),
      }),
    } as unknown as Firestore;
    const files = new Map<string, {
      path: string;
      copy: ReturnType<typeof vi.fn>;
      download: ReturnType<typeof vi.fn>;
      save: ReturnType<typeof vi.fn>;
      getMetadata: ReturnType<typeof vi.fn>;
    }>();
    const bucket = {
      file: (path: string) => {
        if (!files.has(path)) {
          const file = {
            path,
            copy: vi.fn(async (destination: string) => {
              const original = path.startsWith("library/demo/trip1-v2/") && !path.includes("/variants/");
              if (original) {
                activeOriginalCopies += 1;
                maxActiveOriginalCopies = Math.max(maxActiveOriginalCopies, activeOriginalCopies);
              }
              await new Promise((resolve) => setTimeout(resolve, 5));
              copyCalls.push({ source: path, destination });
              if (original) activeOriginalCopies -= 1;
              return undefined;
            }),
            download: vi.fn(async () => [Buffer.from("original")]),
            save: vi.fn(async () => undefined),
            getMetadata: vi.fn(async () => [{ generation: "target-generation" }]),
          };
          files.set(path, file);
        }
        return files.get(path)!;
      },
    };

    const project = await createDemoProject({ db, bucket, userId: "demo-user", now: 123 });

    expect(project.status).toBe("ready");
    expect(copyCalls).toHaveLength(45);
    expect(maxActiveOriginalCopies).toBeGreaterThan(1);
    expect([...files.values()].flatMap((file) => file.download.mock.calls)).toHaveLength(0);
    expect([...files.values()].flatMap((file) => file.save.mock.calls)).toHaveLength(0);
    expect(sharpMock).not.toHaveBeenCalled();
    expect(writes.filter((write) => write.path.includes("/assets/") || write.path.includes("/shots/"))).toHaveLength(30);
    const asset = writes.find((write) => write.path.includes("/assets/"))!.value;
    const source = loadDemoBundle().photos[0]!;
    expect(asset).toMatchObject({
      sizeBytes: source.sizeBytes,
      contentType: "image/jpeg",
      media: { width: source.media.width, height: source.media.height },
    });
  });
});
