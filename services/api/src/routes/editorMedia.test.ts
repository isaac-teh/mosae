import { describe, expect, it, vi } from "vitest";
import type { Firestore } from "firebase-admin/firestore";
import type { Timeline } from "@mosae/contracts";
import { loadUnusedProjectMedia } from "./editorMedia.js";

const timeline: Timeline = {
  schemaVersion: 1, projectId: "p1", mode: "memory", aspect: "9:16", fps: 30, durationSec: 6,
  chapters: [],
  videoClips: [
    { id: "used-photo", source: { kind: "photo", shotId: "used-photo" }, startSec: 0, durationSec: 3, transitionIn: { kind: "cut", durationSec: 0 } },
    { kind: "collage", clipId: "used-collage", startSec: 3, durationSec: 3, transitionIn: { kind: "cut", durationSec: 0 }, spec: { layoutId: "photo-table", slots: [{ slotId: "slot-1", shotId: "used-slot", kind: "photo" }], motionId: "stack-deal", effectId: null, seed: "s", durationSec: 3 } },
  ],
  audioClips: [], captions: [],
};

function dbWith(records: Record<string, Record<string, unknown>>) {
  const ref = (path: string): any => ({
    collection: (name: string) => ({
      get: async () => ({ docs: Object.entries(records).filter(([key]) => key.startsWith(`${path}/${name}/`)).map(([key, data]) => ({ id: key.split("/").at(-1), data: () => data })) }),
      doc: (id: string) => ref(`${path}/${name}/${id}`),
    }),
    get: async () => ({ exists: path in records, id: path.split("/").at(-1), data: () => records[path] }),
  });
  return { collection: (name: string) => ({ doc: (id: string) => ref(`${name}/${id}`) }) } as unknown as Firestore;
}

describe("loadUnusedProjectMedia", () => {
  it("returns every unused shot with browser URLs, video bounds, and newest event dates first", async () => {
    const db = dbWith({
      "projects/p1/shots/used-photo": { id: "used-photo", assetId: "asset-used", mediaType: "photo", index: 0 },
      "projects/p1/shots/used-slot": { id: "used-slot", assetId: "asset-slot", mediaType: "photo", index: 0 },
      "projects/p1/shots/unused-old": { id: "unused-old", assetId: "asset-old", mediaType: "photo", index: 0 },
      "projects/p1/shots/unused-new": { id: "unused-new", assetId: "asset-new", mediaType: "video", index: 0, sourceStartSec: 1.5, sourceEndSec: 12 },
      "projects/p1/assets/asset-used": { id: "asset-used", eventId: "old-event", derivatives: { thumbPath: "thumb/used.jpg" } },
      "projects/p1/assets/asset-slot": { id: "asset-slot", eventId: "old-event", derivatives: { thumbPath: "thumb/slot.jpg" } },
      "projects/p1/assets/asset-old": { id: "asset-old", eventId: "old-event", derivatives: { thumbPath: "thumb/old.jpg" } },
      "projects/p1/assets/asset-new": { id: "asset-new", eventId: "new-event", derivatives: { thumbPath: "thumb/new.jpg", proxyPath: "proxy/new.mp4" } },
      "projects/p1/events/old-event": { id: "old-event", date: "2026-06-02", label: "Day 2, morning" },
      "projects/p1/events/new-event": { id: "new-event", date: "2026-06-03", label: "Day 3, evening" },
    });
    const signReadUrl = vi.fn(async (path: string) => `signed:${path}`);

    await expect(loadUnusedProjectMedia(db, "p1", timeline, signReadUrl, () => 100)).resolves.toEqual([
      { shotId: "unused-new", kind: "video", thumbnailUrl: "signed:thumb/new.jpg", previewUrl: "signed:proxy/new.mp4", date: "2026-06-03", eventLabel: "Day 3, evening", sourceInSec: 1.5, sourceOutSec: 12 },
      { shotId: "unused-old", kind: "photo", thumbnailUrl: "signed:thumb/old.jpg", previewUrl: "signed:thumb/old.jpg", date: "2026-06-02", eventLabel: "Day 2, morning" },
    ]);
    expect(signReadUrl).toHaveBeenCalledWith("proxy/new.mp4", 21_600_100);
    expect(signReadUrl).toHaveBeenCalledWith("thumb/new.jpg", 21_600_100);
  });
});
