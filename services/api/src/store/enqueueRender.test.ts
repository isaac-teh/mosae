import { describe, expect, it, vi } from "vitest";
import type { Firestore } from "firebase-admin/firestore";
import { enqueueRender } from "./enqueueRender.js";

function database() {
  const data = new Map<string, Record<string, unknown>>([
    ["projects/p1", { userId: "owner" }],
    ["projects/p1/generations/g1", { id: "g1", projectId: "p1", status: "playable", renderProgress: 0, failureReasons: [] }],
  ]);
  const writes = new Map<string, number>();
  const doc = (path: string) => ({
    path,
    get: async () => {
      const value = data.get(path);
      return { exists: Boolean(value), data: () => value, get: (field: string) => value?.[field] };
    },
    set: async (value: Record<string, unknown>) => {
      writes.set(path, (writes.get(path) ?? 0) + 1);
      data.set(path, value);
    },
    collection: (name: string) => ({ doc: (id: string) => doc(`${path}/${name}/${id}`) }),
  });
  const db = {
    collection: (name: string) => ({ doc: (id: string) => doc(`${name}/${id}`) }),
    runTransaction: async (work: (tx: any) => Promise<unknown>) => work({
      get: (ref: ReturnType<typeof doc>) => ref.get(),
      set: (ref: ReturnType<typeof doc>, value: Record<string, unknown>) => { data.set(ref.path, value); },
    }),
  };
  return { db: db as unknown as Firestore, data, writes };
}

describe("enqueueRender", () => {
  it("treats duplicate Save requests as one render in flight", async () => {
    const { db, data, writes } = database();
    const input = { userId: "owner", projectId: "p1", generationId: "g1", schemaVersion: 1 };

    await enqueueRender(db, input);
    const taskPath = [...data.keys()].find((path) => path.includes("/taskOutbox/"));
    expect(taskPath).toBeTruthy();
    const delivered = { ...data.get(taskPath!)!, state: "delivered" };
    data.set(taskPath!, delivered);

    await expect(enqueueRender(db, input)).resolves.toBeUndefined();

    expect(data.get("projects/p1/generations/g1")?.status).toBe("rendering");
    expect([...data.keys()].filter((path) => path.includes("/taskOutbox/"))).toHaveLength(1);
    expect(data.get(taskPath!)).toEqual(delivered);
    expect(writes.get(taskPath!)).toBe(1);
  });
});
