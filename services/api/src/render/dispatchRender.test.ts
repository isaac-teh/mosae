import { describe, it, expect, vi } from "vitest";
import type { Firestore } from "firebase-admin/firestore";
import type { Generation, Timeline } from "@mosae/contracts";
import { createRender, renderOutputPath, type RenderEvent } from "./dispatchRender.js";
import { FakeFirestore } from "./fakeFirestore.js";

const TIMELINE: Timeline = {
  schemaVersion: 1,
  projectId: "p1",
  mode: "memory",
  aspect: "9:16",
  fps: 30,
  durationSec: 4,
  chapters: [{ title: "One", startSec: 0 }],
  videoClips: [{
    id: "c1",
    source: { kind: "photo", shotId: "shot-1" },
    startSec: 0,
    durationSec: 4,
    transitionIn: { kind: "cut", durationSec: 0 },
  }],
  audioClips: [],
  captions: [],
};

const SETTINGS = {
  schemaVersion: 1 as const, id: "d1", projectId: "p1", version: 1, note: "",
  cadenceId: "tender", soundtrackId: null, durationId: "30s", aspect: "9:16" as const, captions: false,
};

function seed(status: Generation["status"] = "rendering", timeline: Timeline | null = TIMELINE) {
  const db = new FakeFirestore();
  db.docs.set("projects/p1", { id: "p1", userId: "owner" });
  db.docs.set("projects/p1/generations/g1", {
    schemaVersion: 1, id: "g1", projectId: "p1", proposalId: "pr1", parentGenerationId: null,
    settings: SETTINGS, seed: "s", status, timeline, droppedPicks: [], failureReasons: [],
    outputPath: null, renderProgress: 0,
  });
  return db;
}

const generation = (db: FakeFirestore) => db.docs.get("projects/p1/generations/g1") as unknown as Generation;
const editPath = "projects/p1/generations/g1/edits/current";
const revisionPath = (revision: number) => `${editPath}/revisions/${revision}`;
function seedRevision(db: FakeFirestore, revision: number, sec: number) {
  const ops = [{ op: "setPhotoDuration", clipId: "c1", sec }];
  db.docs.set(editPath, { revision, ops, updatedAt: 1, renderRevision: revision, status: "rendering" });
  db.docs.set(revisionPath(revision), { revision, ops, updatedAt: 1, status: "rendering" });
}

function stream(...events: RenderEvent[]) {
  return async function* (_url: string, _body: unknown): AsyncIterable<RenderEvent> {
    void _url;
    void _body;
    for (const event of events) yield event;
  };
}

function build(db: FakeFirestore, events: RenderEvent[], overrides: Record<string, unknown> = {}) {
  const post: ReturnType<typeof vi.fn> = vi.fn(stream(...events));
  const render = createRender({
    db: db as unknown as Firestore,
    renderServiceUrl: "http://render.test/",
    sources: { loadAsset: async () => ({ storagePath: "uploads/owner/p1/s/a/original.jpg", derivatives: { thumbPath: "t.jpg" } }) },
    post: (url, body) => post(url, body),
    now: () => 0,
    ...overrides,
  });
  return { render, post };
}

describe("createRender", () => {
  it("renders revision 3 from the first cut and resolves its render sources", async () => {
    const db = seed("saved");
    seedRevision(db, 3, 5);
    const { render, post } = build(db, [{ done: true, outputPath: "/tmp/edit3.mp4", durationInFrames: 150 }]);

    expect(await render({ projectId: "p1", generationId: "g1", revision: 3 })).toBe("rendered");
    const body = post.mock.calls[0][1] as { timeline: Timeline; sources: Record<string, string>; outputFile: string };
    expect(body.timeline.durationSec).toBe(5);
    expect(body.timeline.videoClips[0].durationSec).toBe(5);
    expect(body.sources["shot-1"]).toBe("uploads/owner/p1/s/a/original.jpg");
    expect(body.outputFile).toBe("g1-edit-3.mp4");
    expect(db.docs.get(revisionPath(3))).toMatchObject({ status: "ready", outputPath: "renders/owner/p1/g1-edit-3.mp4" });
    expect(db.docs.get(editPath)).toMatchObject({ renderRevision: 3, status: "ready", outputPath: "renders/owner/p1/g1-edit-3.mp4" });
  });

  it("records an older completion without replacing a newer render request", async () => {
    const db = seed("saved");
    seedRevision(db, 3, 5);
    let finish!: () => void;
    const waiting = new Promise<void>((resolve) => { finish = resolve; });
    let started!: () => void;
    const posting = new Promise<void>((resolve) => { started = resolve; });
    const post = async function* (): AsyncIterable<RenderEvent> {
      started();
      await waiting;
      yield { done: true, outputPath: "/tmp/edit3.mp4", durationInFrames: 150 };
    };
    const { render } = build(db, [], { post });
    const pending = render({ projectId: "p1", generationId: "g1", revision: 3 });
    await posting;
    db.docs.set(editPath, { ...db.docs.get(editPath), renderRevision: 4, status: "rendering", outputPath: null });
    db.docs.set(revisionPath(4), { revision: 4, ops: [], updatedAt: 2, status: "rendering" });
    finish();

    expect(await pending).toBe("rendered");
    expect(db.docs.get(revisionPath(3))).toMatchObject({ status: "ready", outputPath: "renders/owner/p1/g1-edit-3.mp4" });
    expect(db.docs.get(editPath)).toMatchObject({ renderRevision: 4, status: "rendering", outputPath: null });
  });

  it("renders the film and marks the generation saved at the spec's path", async () => {
    const db = seed();
    const { render, post } = build(db, [{ progress: 0.5 }, { done: true, outputPath: "/tmp/g1.mp4", durationInFrames: 120 }]);

    expect(await render({ projectId: "p1", generationId: "g1" })).toBe("rendered");

    const [url, body] = post.mock.calls[0] as unknown as [string, { sources: Record<string, string>; outputFile: string }];
    expect(url).toBe("http://render.test/tasks/render");
    expect(body.outputFile).toBe("g1.mp4");
    expect(body.sources["shot-1"]).toBe("uploads/owner/p1/s/a/original.jpg");

    expect(generation(db).status).toBe("saved");
    expect(generation(db).renderProgress).toBe(1);
    expect(generation(db).outputPath).toBe("renders/owner/p1/g1.mp4");
    expect(renderOutputPath("owner", "p1", "g1")).toBe("renders/owner/p1/g1.mp4");
    expect(db.docs.get("projects/p1")?.savedGenerationId).toBe("g1");
  });

  it("copies a local render to its storage path and saves that path", async () => {
    // A local render never uploads, so its done event has uploaded !== true.
    // Without storeLocalOutput the MP4 would stay on the render service's disk
    // and /download (a storage-emulator URL for generation.outputPath) would 404.
    // With it, we copy the file to the storage path and save that path.
    const db = seed();
    const storeLocalOutput = vi.fn(async () => {});
    const { render } = build(db, [{ done: true, outputPath: "/tmp/g1.mp4", durationInFrames: 120, uploaded: false }], {
      storeLocalOutput,
    });

    expect(await render({ projectId: "p1", generationId: "g1" })).toBe("rendered");

    expect(storeLocalOutput).toHaveBeenCalledTimes(1);
    const [localFile, storagePath] = storeLocalOutput.mock.calls[0] as unknown as [string, string];
    expect(localFile).toBe("/tmp/g1.mp4");
    expect(storagePath).toBe("renders/owner/p1/g1.mp4");
    expect(generation(db).outputPath).toBe("renders/owner/p1/g1.mp4");
  });

  it("does not copy a local render when storeLocalOutput is absent", async () => {
    const db = seed();
    const { render } = build(db, [{ done: true, outputPath: "/tmp/g1.mp4", durationInFrames: 120, uploaded: false }]);

    expect(await render({ projectId: "p1", generationId: "g1" })).toBe("rendered");
    expect(generation(db).outputPath).toBe("renders/owner/p1/g1.mp4");
  });

  it("does not copy a render that already uploaded", async () => {
    const db = seed();
    const storeLocalOutput = vi.fn(async () => {});
    const { render } = build(db, [{ done: true, outputPath: "/tmp/g1.mp4", durationInFrames: 120, uploaded: true }], {
      storeLocalOutput,
    });

    expect(await render({ projectId: "p1", generationId: "g1" })).toBe("rendered");
    expect(storeLocalOutput).not.toHaveBeenCalled();
    expect(generation(db).outputPath).toBe("renders/owner/p1/g1.mp4");
  });

  it("signs every source and the destination when signing is configured", async () => {
    const db = seed();
    const { render, post } = build(db, [{ done: true, outputPath: "/tmp/g1.mp4", durationInFrames: 120 }], {
      signRead: async (path: string) => `https://signed.example/read/${path}`,
      signUpload: async (path: string) => `https://signed.example/put/${path}`,
    });

    await render({ projectId: "p1", generationId: "g1" });

    const body = post.mock.calls[0][1] as unknown as { sources: Record<string, string>; uploadUrl: string };
    expect(body.sources["shot-1"]).toBe("https://signed.example/read/uploads/owner/p1/s/a/original.jpg");
    expect(body.uploadUrl).toBe("https://signed.example/put/renders/owner/p1/g1.mp4");
  });

  it("throttles the progress it writes", async () => {
    const db = seed();
    let clock = 0;
    const ticks: RenderEvent[] = Array.from({ length: 300 }, (_, i) => ({ progress: (i + 1) / 300 }));
    const { render } = build(db, [...ticks, { done: true, outputPath: "/tmp/g1.mp4", durationInFrames: 300 }], {
      now: () => (clock += 10),
    });
    await render({ projectId: "p1", generationId: "g1" });

    const progressWrites = db.writes
      .filter((write) => write.path === "projects/p1/generations/g1" && write.value.status === "rendering")
      .map((write) => write.value.renderProgress as number);

    // Three seconds of render, so three throttled writes, plus the explicit
    // 1.0 the leg always writes before marking the film saved. Four, not 300.
    // An unthrottled onProgress is 9,000 writes for a five-minute film.
    expect(progressWrites).toHaveLength(4);
    expect(progressWrites.map((value) => Number(value.toFixed(2)))).toEqual([0.33, 0.67, 1, 1]);
  });

  it("hands the film back playable when the render service reports an error", async () => {
    // The recovery path. `startRender` only accepts a playable film, so leaving
    // the generation in `rendering` would mean it could never be retried and
    // `/download` would refuse forever — the film bricked by pressing Save.
    const db = seed();
    const { render } = build(db, [{ progress: 0.2 }, { error: "render_failed", detail: "chromium died" }]);

    expect(await render({ projectId: "p1", generationId: "g1" })).toBe("failed");
    expect(generation(db).status).toBe("playable");
    expect(generation(db).renderProgress).toBe(0);
    expect(generation(db).failureReasons.join(" ")).toContain("chromium died");
    // The film itself never stopped working, so no pointer moves.
    expect(db.docs.get("projects/p1")?.savedGenerationId).toBeUndefined();
  });

  it("hands the film back when the stream ends without finishing", async () => {
    const db = seed();
    const { render } = build(db, [{ progress: 0.9 }]);

    expect(await render({ projectId: "p1", generationId: "g1" })).toBe("failed");
    expect(generation(db).status).toBe("playable");
    expect(generation(db).failureReasons.join(" ")).toContain("without finishing");
  });

  it("hands the film back when the render service is unreachable", async () => {
    const db = seed();
    const { render } = build(db, [], {
      post: () => { throw new Error("ECONNREFUSED"); },
    });

    expect(await render({ projectId: "p1", generationId: "g1" })).toBe("failed");
    expect(generation(db).status).toBe("playable");
    expect(generation(db).failureReasons.join(" ")).toContain("ECONNREFUSED");
  });

  it("hands the film back when a source cannot be resolved", async () => {
    const db = seed();
    const { render, post } = build(db, [], { sources: { loadAsset: async () => null } });

    expect(await render({ projectId: "p1", generationId: "g1" })).toBe("failed");
    expect(generation(db).status).toBe("playable");
    expect(generation(db).failureReasons.join(" ")).toContain("missing source: shot-1");
    expect(post).not.toHaveBeenCalled();
  });

  it("hands the film back when retries are exhausted", async () => {
    const db = seed();
    const { render, post } = build(db, []);

    expect(await render({ projectId: "p1", generationId: "g1", giveUp: "exceeded 3 render attempts" })).toBe("failed");
    expect(generation(db).status).toBe("playable");
    expect(generation(db).failureReasons).toEqual(["exceeded 3 render attempts"]);
    expect(post).not.toHaveBeenCalled();
  });

  it("skips a generation that is not rendering", async () => {
    const db = seed("saved");
    const { render, post } = build(db, [{ done: true, outputPath: "/tmp/g1.mp4", durationInFrames: 1 }]);

    // A redelivered task must not render over a film that is already settled.
    expect(await render({ projectId: "p1", generationId: "g1" })).toBe("skipped");
    expect(post).not.toHaveBeenCalled();
  });

  it("skips a generation that does not exist", async () => {
    const db = seed();
    const { render } = build(db, []);
    expect(await render({ projectId: "p1", generationId: "missing" })).toBe("skipped");
  });

  it("fails a generation left rendering with no timeline", async () => {
    const db = seed("rendering", null);
    const { render } = build(db, []);

    expect(await render({ projectId: "p1", generationId: "g1" })).toBe("failed");
    // There is no playable film to give back to, so this one is genuinely failed.
    expect(generation(db).status).toBe("failed");
  });
});
