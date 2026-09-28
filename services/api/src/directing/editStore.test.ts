import { describe, expect, it } from "vitest";
import { parseTimeline } from "@mosae/contracts";
import { validateEditRequest } from "./editStore.js";

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
