import { describe, expect, it } from "vitest";
import { parseTimeline } from "@mosae/contracts";
import { getEditDocument, saveEditDocument, validateEditRequest } from "./editStore.js";

const timeline = parseTimeline({
  schemaVersion: 1, projectId: "p1", mode: "memory", aspect: "9:16", fps: 30,
  durationSec: 3, chapters: [{ title: "Day", startSec: 0 }],
  videoClips: [{ id: "clip-1", source: { kind: "photo", shotId: "shot-1" }, startSec: 0, durationSec: 3, transitionIn: { kind: "cut", durationSec: 0 } }],
  audioClips: [], captions: [],
});

describe("validateEditRequest", () => {
  it("accepts a valid edit and keeps the submitted ops", () => {
    expect(validateEditRequest(timeline, { revision: 1, ops: [{ op: "setPhotoDuration", clipId: "clip-1", sec: 4 }] })).toEqual({
      ok: true, revision: 1, ops: [{ op: "setPhotoDuration", clipId: "clip-1", sec: 4 }],
    });
  });

  it("reports the first invalid operation index", () => {
    expect(validateEditRequest(timeline, { revision: 1, ops: [
      { op: "setPhotoDuration", clipId: "clip-1", sec: 4 },
      { op: "remove", clipId: "clip-1" },
    ] })).toMatchObject({ ok: false, opIndex: 1 });
  });

  it("rejects malformed revision and operation bodies", () => {
    expect(validateEditRequest(timeline, { revision: 0, ops: [] })).toMatchObject({ ok: false, opIndex: -1 });
    expect(validateEditRequest(timeline, { revision: 1, ops: [{}] })).toMatchObject({ ok: false, opIndex: 0 });
  });
});

describe("saveEditDocument source dimensions", () => {
  it("stores oriented dimensions for a device-upload shot added by an edit", async () => {
    const records: Record<string, Record<string, unknown>> = {
      "projects/p1": { userId: "owner" },
      "projects/p1/generations/g1": { timeline },
      "projects/p1/assets/device-photo": { storagePath: "upload/original.jpg", media: { width: 4401, height: 6602 } },
    };
    const pathAwareDb = {
      collection: (name: string) => ({ doc: (id: string) => {
        const makeRef = (path: string): Record<string, unknown> => ({ path, collection: (child: string) => ({ doc: (childId: string) => makeRef(`${path}/${child}/${childId}`) }), get: async () => ({ exists: path in records, data: () => records[path], get: (field: string) => records[path]?.[field] }) });
        return makeRef(`${name}/${id}`);
      } }),
      runTransaction: async (work: (tx: { get: (r: any) => Promise<any>; set: (r: any, value: Record<string, unknown>) => void }) => Promise<unknown>) => work({
        get: (r) => r.get(),
        set: (r, value) => { records[r.path] = value; },
      }),
    };
    const result = await saveEditDocument(pathAwareDb as never, "owner", "p1", "g1", {
      revision: 1,
      ops: [{ op: "add", shotId: "device-photo_0000", kind: "photo", afterClipId: null, durationSec: 3 }],
    }, () => 123);
    expect(result).toMatchObject({ status: "saved", document: { sourceDimensions: { "device-photo_0000": { width: 4401, height: 6602 } } } });
    await expect(getEditDocument(pathAwareDb as never, "owner", "p1", "g1")).resolves.toMatchObject({ sourceDimensions: { "device-photo_0000": { width: 4401, height: 6602 } } });
  });
});
