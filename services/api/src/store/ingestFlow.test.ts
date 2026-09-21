import { copyFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { getStorage } from "firebase-admin/storage";
import { afterAll, describe, expect, it } from "vitest";
import { buildOriginalPath } from "../domain/ids.js";
import { adminDb, getAdminApp } from "../firebase/admin.js";
import { closeProbe } from "../ingest/probe.js";
import { makeJpeg, makeSceneVideo, tempDir } from "../ingest/testMedia.js";
import { createIngest } from "../ingest/wire.js";
import { runProjectPass } from "./clusterStore.js";
import { recordFinalize } from "./finalizeStore.js";
import { closeSession, createProject, openSession } from "./projectStore.js";
import { settleProject } from "./readinessStore.js";

const BUCKET = "demo-mosae.appspot.com";
const tokyo = { lat: 35.6895, lng: 139.6917 };

afterAll(async () => {
  await closeProbe();
});

describe("ingest flow (emulators)", () => {
  it("ingests a mixed upload, settles the project and clusters it", { timeout: 180_000 }, async () => {
    const media = await tempDir();
    const bucket = getStorage(getAdminApp()).bucket(BUCKET);

    const dayOne = await makeJpeg(media.dir, "day1.jpg", { width: 640, height: 480, dateTimeOriginal: "2026:05:03 09:00:00", gps: tokyo });
    const dayOneCopy = path.join(media.dir, "day1-copy.jpg");
    await copyFile(dayOne, dayOneCopy);
    const dayTwo = await makeJpeg(media.dir, "day2.jpg", { width: 640, height: 480, dateTimeOriginal: "2026:05:04 19:30:00", gps: tokyo });
    const corrupt = path.join(media.dir, "corrupt.jpg");
    await writeFile(corrupt, Buffer.from("this is not an image"));
    const clip = await makeSceneVideo(media.dir, "clip.mp4", ["red", "blue", "green"], 2);

    const uploads = [
      { file: dayOne, name: "day1.jpg", contentType: "image/jpeg" },
      { file: dayOneCopy, name: "day1-copy.jpg", contentType: "image/jpeg" },
      { file: dayTwo, name: "day2.jpg", contentType: "image/jpeg" },
      { file: corrupt, name: "corrupt.jpg", contentType: "image/jpeg" },
      { file: clip, name: "clip.mp4", contentType: "video/mp4" },
    ];
    const sizes = await Promise.all(uploads.map(async (u) => (await stat(u.file)).size));

    const userId = `u-${crypto.randomUUID()}`;
    const project = await createProject(adminDb, { userId, mode: "memory", now: 1 });
    const { session, entries } = await openSession(adminDb, {
      userId,
      projectId: project.id,
      entries: uploads.map((u, i) => ({ fileName: u.name, contentType: u.contentType, sizeBytes: sizes[i] })),
      now: 1,
    });

    const registered: { assetId: string; generation: string; name: string }[] = [];
    for (const [i, upload] of uploads.entries()) {
      const assetId = entries[i].assetId;
      const objectName = buildOriginalPath({ userId, projectId: project.id, sessionId: session.id, assetId });
      await bucket.upload(upload.file, { destination: objectName, metadata: { contentType: upload.contentType } });
      const [metadata] = await bucket.file(objectName).getMetadata();
      const generation = String(metadata.generation);
      const result = await recordFinalize(adminDb, BUCKET, { bucket: BUCKET, objectName, generation, sizeBytes: sizes[i], contentType: upload.contentType, now: 2 });
      expect(result.kind).toBe("accepted");
      registered.push({ assetId, generation, name: upload.name });
    }
    expect((await adminDb.doc(`projects/${project.id}`).get()).get("status")).toBe("processing");

    await closeSession(adminDb, { userId, projectId: project.id, sessionId: session.id });

    const settle = async (projectId: string) => {
      await settleProject(adminDb, projectId, Date.now());
    };
    const ingest = createIngest({ db: adminDb, bucketName: BUCKET, settle });
    const results: Record<string, string> = {};
    for (const item of registered) {
      results[item.name] = await ingest({ projectId: project.id, assetId: item.assetId, generation: item.generation });
    }
    expect(results).toEqual({ "day1.jpg": "ingested", "day1-copy.jpg": "ingested", "day2.jpg": "ingested", "corrupt.jpg": "failed", "clip.mp4": "ingested" });

    const asset = async (name: string) => (await adminDb.doc(`projects/${project.id}/assets/${registered.find((r) => r.name === name)!.assetId}`).get()).data()!;
    expect(await asset("corrupt.jpg")).toMatchObject({ status: "failed", failureReason: "unreadable_media" });
    expect(await asset("day1.jpg")).toMatchObject({ status: "ingested", media: { kind: "photo", localTime: "2026-05-03T09:00:00" }, quality: { blurry: false } });

    const clipAsset = await asset("clip.mp4");
    expect(clipAsset.media).toMatchObject({ kind: "video", width: 320, height: 240 });
    for (const derivative of [clipAsset.derivatives.thumbPath, clipAsset.derivatives.proxyPath, (await asset("day2.jpg")).derivatives.renderPath]) {
      const [exists] = await bucket.file(derivative).exists();
      expect(exists, derivative).toBe(true);
    }

    const shots = await adminDb.collection(`projects/${project.id}/shots`).get();
    expect(shots.size).toBe(6);
    const clipShots = shots.docs.filter((d) => d.get("assetId") === registered.find((r) => r.name === "clip.mp4")!.assetId);
    expect(clipShots).toHaveLength(3);

    const tasks = await adminDb.collection(`projects/${project.id}/taskOutbox`).where("stage", "==", "cluster").get();
    expect(tasks.size).toBe(1);

    const again = await ingest({ projectId: project.id, assetId: registered[0].assetId, generation: registered[0].generation });
    expect(again).toBe("skipped");
    expect((await adminDb.collection(`projects/${project.id}/shots`).get()).size).toBe(6);

    expect(await runProjectPass(adminDb, project.id, Date.now())).toEqual({ status: "ready_with_errors", events: 3, duplicates: 1 });
    expect((await adminDb.doc(`projects/${project.id}`).get()).data()).toMatchObject({
      status: "ready_with_errors", eventCount: 3, dateRange: { start: "2026-05-03", end: "2026-05-04" },
    });
    const linked = (await adminDb.collection(`projects/${project.id}/assets`).get()).docs.filter((d) => d.get("dupOf"));
    expect(linked).toHaveLength(1);
    expect((await asset("clip.mp4")).eventId).toBe("undated");

    await media.cleanup();
  });

  it("recovers when the first settle fails after the asset commit", { timeout: 180_000 }, async () => {
    const media = await tempDir();
    const bucket = getStorage(getAdminApp()).bucket(BUCKET);
    const file = await makeJpeg(media.dir, "single.jpg", { dateTimeOriginal: "2026:05:03 09:00:00" });
    const sizeBytes = (await stat(file)).size;
    const userId = `u-${crypto.randomUUID()}`;
    const project = await createProject(adminDb, { userId, mode: "memory", now: 1 });
    const { session, entries } = await openSession(adminDb, {
      userId,
      projectId: project.id,
      entries: [{ fileName: "single.jpg", contentType: "image/jpeg", sizeBytes }],
      now: 1,
    });
    const assetId = entries[0].assetId;
    const objectName = buildOriginalPath({ userId, projectId: project.id, sessionId: session.id, assetId });
    await bucket.upload(file, { destination: objectName, metadata: { contentType: "image/jpeg" } });
    const [metadata] = await bucket.file(objectName).getMetadata();
    const generation = String(metadata.generation);
    expect(await recordFinalize(adminDb, BUCKET, { bucket: BUCKET, objectName, generation, sizeBytes, contentType: "image/jpeg", now: 2 })).toMatchObject({ kind: "accepted" });
    await closeSession(adminDb, { userId, projectId: project.id, sessionId: session.id });

    let calls = 0;
    const settle = async (pid: string) => {
      calls += 1;
      if (calls === 1) throw new Error("firestore unavailable");
      await settleProject(adminDb, pid, Date.now());
    };
    const ingest = createIngest({ db: adminDb, bucketName: BUCKET, settle });
    const task = { projectId: project.id, assetId, generation };

    await expect(ingest(task)).rejects.toThrow("firestore unavailable");
    expect((await adminDb.doc(`projects/${project.id}/assets/${assetId}`).get()).get("status")).toBe("ingested");
    expect((await adminDb.collection(`projects/${project.id}/taskOutbox`).where("stage", "==", "cluster").get()).size).toBe(0);
    expect((await adminDb.doc(`projects/${project.id}`).get()).get("status")).toBe("processing");

    await expect(ingest(task)).resolves.toBe("skipped");
    expect(calls).toBe(2);
    expect((await adminDb.collection(`projects/${project.id}/taskOutbox`).where("stage", "==", "cluster").get()).size).toBe(1);
    await expect(runProjectPass(adminDb, project.id, Date.now())).resolves.toEqual({ status: "ready", events: 1, duplicates: 0 });
    await media.cleanup();
  });
});
