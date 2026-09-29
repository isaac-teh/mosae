import { describe, expect, it } from "vitest";
import { initializeApp, deleteApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { createDemoProject, type DemoBucket } from "./createDemoProject.js";

describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST)("demo project", () => {
  it("copies analyzed photos into a fresh, ready project without ingest tasks", async () => {
    const app = initializeApp({ projectId: "demo-mosae" }, `demo-test-${randomUUID()}`);
    try {
      const db = getFirestore(app);
      const source = await readFile(new URL("../../../../e2e/fixtures/photo-1.jpg", import.meta.url));
      const objects = new Map<string, Buffer>();
      const bucket = { file: (path: string) => ({
        copy: async (destination: string) => {
          objects.set(destination, objects.get(path) ?? source);
        },
      }) } as unknown as DemoBucket;
      const project = await createDemoProject({ db, bucket, userId: "demo-test-user", now: 42 });
      expect(project.demo).toBe("trip1-v2");
      expect(project.status).toBe("ready");
      const ref = db.collection("projects").doc(project.id);
      const [assets, shots, tasks] = await Promise.all([
        ref.collection("assets").get(), ref.collection("shots").get(), ref.collection("taskOutbox").get(),
      ]);
      expect(assets.size).toBe(15);
      expect(shots.size).toBe(15);
      expect(tasks.empty).toBe(true);
      expect(shots.docs.every((shot) => shot.get("assetId") !== undefined && shot.get("analysis.kind") === "photo")).toBe(true);
      expect(objects.size).toBe(45);
    } finally { await deleteApp(app); }
  });
});
