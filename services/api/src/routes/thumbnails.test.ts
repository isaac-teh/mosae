import { describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { listeningServer } from "../test/listeningServer.js";
import type { Firestore } from "firebase-admin/firestore";
import { requireUser } from "../auth/requireUser.js";
import { firebaseObjectStore, firebaseThumbnailUrlStore } from "../ingest/objectStore.js";
import { buildDerivativePath } from "../domain/ids.js";
import { thumbnailsRouter } from "./thumbnails.js";

const path = buildDerivativePath({ userId: "owner", projectId: "p1", assetId: "a1", generation: "7" }, "thumb.jpg");

function setup(thumbPath: string | null = path) {
  const records: Record<string, Record<string, unknown>> = {
    "projects/p1": { id: "p1", userId: "owner" },
    "projects/p1/assets/a1": { id: "a1", derivatives: { thumbPath } },
  };
  const ref = (key: string): unknown => ({
    collection: (name: string) => ({ doc: (id: string) => ref(`${key}/${name}/${id}`) }),
    get: async () => ({ exists: key in records, data: () => records[key], get: (field: string) => records[key]?.[field] }),
  });
  const db = { collection: (name: string) => ({ doc: (id: string) => ref(`${name}/${id}`) }) } as unknown as Firestore;
  const objects = new Map<string, unknown>();
  const signed = vi.fn(async (objectPath: string, options: unknown) => {
    if (!objects.has(objectPath)) throw new Error("missing uploaded object");
    return [`https://storage.test/${objectPath}?X-Goog-Signature=test`];
  });
  const bucket = {
    upload: async (_source: string, options: { destination: string; metadata: unknown }) => { objects.set(options.destination, options.metadata); },
    file: (objectPath: string) => ({ getSignedUrl: (options: unknown) => signed(objectPath, options) }),
  } as unknown as Parameters<typeof firebaseObjectStore>[0];
  const app = express();
  app.use("/api/projects", thumbnailsRouter({
    db, thumbnails: firebaseThumbnailUrlStore(bucket), now: () => 1000,
    auth: requireUser(async (token) => { if (token === "invalid") throw new Error("invalid"); return { uid: token }; }),
  }));
  return { app, signed, objects, upload: () => firebaseObjectStore(bucket).upload({ source: "thumb.jpg", path, contentType: "image/jpeg" }) };
}

describe("owner thumbnail URLs", () => {
  it("signs the actual ingest thumbnail without requiring or adding Firebase download tokens", async () => {
    const { app, upload, objects, signed } = setup();
    await upload();
    const res = await request(await listeningServer(app)).get("/api/projects/p1/assets/a1/thumbnail").set("Authorization", "Bearer owner");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ url: `https://storage.test/${path}?X-Goog-Signature=test`, expiresAt: 301000 });
    expect(res.headers["cache-control"]).toBe("private, no-store");
    expect(signed).toHaveBeenCalledWith(path, { version: "v4", action: "read", expires: 301000 });
    expect(objects.get(path)).toEqual({ contentType: "image/jpeg", cacheControl: "private, max-age=31536000" });
  });

  it.each([undefined, "invalid", "other-user"])("rejects unauthorized access for %s before signing", async (token) => {
    const { app, signed } = setup();
    const req = request(await listeningServer(app)).get("/api/projects/p1/assets/a1/thumbnail");
    if (token) req.set("Authorization", `Bearer ${token}`);
    const res = await req;
    expect(res.status).toBe(token === "other-user" ? 404 : 401);
    expect(signed).not.toHaveBeenCalled();
  });

  it.each([null, "proxies/other/p1/a1/7/thumb.jpg", "proxies/owner/other/a1/7/thumb.jpg", "proxies/owner/p1/other/7/thumb.jpg", "proxies/owner/p1/a1/7/proxy.mp4", "proxies/owner/p1/a1/../thumb.jpg"])("rejects unavailable or out-of-scope thumbnail %s", async (thumbPath) => {
    const { app, signed } = setup(thumbPath);
    const res = await request(await listeningServer(app)).get("/api/projects/p1/assets/a1/thumbnail").set("Authorization", "Bearer owner");
    expect(res.status).toBe(404);
    expect(signed).not.toHaveBeenCalled();
  });

  it.each(["missing/assets/a1", "p1/assets/missing", "p1%2Fother/assets/a1"])("does not sign missing or malformed resource %s", async (resource) => {
    const { app, signed } = setup();
    const res = await request(await listeningServer(app)).get(`/api/projects/${resource}/thumbnail`).set("Authorization", "Bearer owner");
    expect(res.status).toBe(404);
    expect(signed).not.toHaveBeenCalled();
  });
});
