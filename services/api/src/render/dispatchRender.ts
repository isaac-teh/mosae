import type { Firestore } from "firebase-admin/firestore";
import { GoogleAuth } from "google-auth-library";
import { applyEdits, type EditOp, type Generation } from "@mosae/contracts";
import type { ShotAnalysis } from "../domain/understanding.js";
import { addSourceDimensions, resolveSources, type SourceDeps } from "../compose/resolveSources.js";
import { fitCollageCrops } from "../compose/fitCollageCrops.js";
import { failGeneration, markSaved, resetRender, setRenderProgress } from "../store/generationStore.js";
import { throttleProgress } from "./throttleProgress.js";

export type RenderTask = {
  projectId: string;
  generationId: string;
  revision?: number;
  workKey?: string;
  /** Set when retries are exhausted: settle the generation or edit revision. */
  giveUp?: string;
};

export type RenderTaskResult = "rendered" | "enqueued" | "failed" | "skipped";

export type RenderWorkerTask = {
  name: string;
  path: "/tasks/render";
  body: {
    timeline: Generation["timeline"];
    sources: Record<string, string>;
    outputFile: string;
    resolution: "720p" | "1080p";
    uploadUrl?: string;
    job: { projectId: string; generationId: string; userId: string; outputPath: string; revision?: number };
  };
};

/** One line of the render service's newline-delimited response. */
export type RenderEvent =
  | { progress: number }
  | { done: true; outputPath: string; durationInFrames: number; uploaded?: boolean }
  | { error: string; detail?: string };

export type RenderConfig = {
  db: Firestore;
  /** Base URL of the `mosae-render` service. */
  renderServiceUrl: string;
  /** Resolve a shot id to the asset whose files back it, and optionally a soundtrack id. */
  sources: SourceDeps;
  /**
   * Turn a storage path into something the render service can fetch. Absent in
   * local development, where the render service serves the path off its own
   * `/media` mount.
   */
  signRead?: (path: string) => Promise<string>;
  /** Sign a PUT URL for the finished MP4. Absent when the render stays on disk. */
  signUpload?: (path: string) => Promise<string>;
  /**
   * Copy a local render to its storage path so it can be read back. Absent in
   * production, where `signUpload` hands the render service a signed PUT. Only
   * runs when the render stayed local (`done.uploaded !== true`), so a local
   * run can still `/download` a file the emulator holds.
   */
  storeLocalOutput?: (localFile: string, storagePath: string) => Promise<void>;
  /** Production handoff: queue the fully prepared request on mosae-render. */
  enqueueRenderJob?: (task: RenderWorkerTask) => Promise<"enqueued" | "already_exists">;
  /** Test seam: POST the request and yield the service's events. */
  post?: (url: string, body: unknown) => AsyncIterable<RenderEvent>;
  now?: () => number;
};

/** A stable output path for the first cut or a particular edit revision. */
export function renderOutputPath(userId: string, projectId: string, generationId: string, revision?: number): string {
  return `renders/${userId}/${projectId}/${generationId}${revision === undefined ? "" : `-edit-${revision}`}.mp4`;
}

/** Read the render service's newline-delimited response one event at a time. */
async function renderIdToken(audience: string): Promise<string> {
  const client = await new GoogleAuth().getIdTokenClient(audience);
  return client.idTokenProvider.fetchIdToken(audience);
}

export async function* postForEvents(url: string, body: unknown, getIdToken = renderIdToken): AsyncIterable<RenderEvent> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (process.env.NODE_ENV === "production") {
    const audience = new URL(url).origin;
    headers.authorization = `Bearer ${await getIdToken(audience)}`;
  }
  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  if (!response.ok || !response.body) {
    const detail = await response.text().catch(() => "");
    yield { error: "render_service_rejected", detail: `${response.status} ${detail}`.trim() };
    return;
  }

  const decoder = new TextDecoder();
  let buffer = "";
  for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
    buffer += decoder.decode(chunk as Uint8Array, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (line.trim()) yield JSON.parse(line) as RenderEvent;
    }
  }
  if (buffer.trim()) yield JSON.parse(buffer) as RenderEvent;
}

/**
 * Run one render job: resolve the film's sources, hand the timeline to
 * `mosae-render`, write throttled progress back to the generation, and settle
 * it either as `saved` or back to `playable`.
 *
 * **A failed render never costs the user their film.** `startRender` only
 * accepts a `playable` generation, so a generation abandoned in `rendering`
 * could never be rendered or retried again — pressing Save once would brick the
 * film. Every failure here puts it back to `playable` with the reason recorded,
 * which is the recovery path: the user can press Save again, and the outbox
 * redelivers the task by itself when the lease expires.
 */
export function createRender(config: RenderConfig): (task: RenderTask) => Promise<RenderTaskResult> {
  const { db } = config;
  const post = config.post ?? postForEvents;

  return async (task) => {
    if (task.revision !== undefined) return renderEditRevision(config, { ...task, revision: task.revision }, post);
    const project = db.collection("projects").doc(task.projectId);
    const genRef = project.collection("generations").doc(task.generationId);
    const genSnap = await genRef.get();
    if (!genSnap.exists) return "skipped";

    const generation = genSnap.data() as Generation;
    // Anything other than `rendering` has already been settled by another
    // attempt; a redelivery must not render over it.
    if (generation.status !== "rendering") return "skipped";

    const projectSnap = await project.get();
    const userId = (projectSnap.get("userId") as string | undefined) ?? "";
    const identity = { userId, projectId: task.projectId, generationId: task.generationId };

    /** Back to playable, with the reason on the record. The film still works. */
    const giveBack = async (reasons: string[]): Promise<RenderTaskResult> => {
      await resetRender(db, { ...identity, reasons });
      return "failed";
    };

    if (task.giveUp) return giveBack([task.giveUp]);

    if (!generation.timeline) {
      // A generation in `rendering` with no timeline was never playable, so
      // there is no film to give back to.
      await failGeneration(db, { ...identity, reasons: ["render requested for a generation with no timeline"] });
      return "failed";
    }

    let sources: Record<string, string>;
    let renderTimeline = generation.timeline;
    try {
      renderTimeline = await addSourceDimensions(generation.timeline, config.sources.loadAsset, task.projectId);
      sources = await resolveSources(renderTimeline, config.sources, task.projectId, "render");
      if (config.signRead) {
        sources = Object.fromEntries(
          await Promise.all(Object.entries(sources).map(async ([id, path]) => [id, await config.signRead!(path)] as const)),
        );
      }
    } catch (error) {
      return giveBack([`source resolution failed: ${error instanceof Error ? error.message : String(error)}`]);
    }

    let outputPath = renderOutputPath(userId, task.projectId, task.generationId);
    let uploadUrl: string | undefined;
    try {
      uploadUrl = await config.signUpload?.(outputPath);
    } catch (error) {
      return giveBack([`could not sign the render destination: ${error instanceof Error ? error.message : String(error)}`]);
    }

    if (config.enqueueRenderJob) {
      try {
        const workKey = task.workKey ?? `${task.projectId}-${task.generationId}`;
        await config.enqueueRenderJob({
          name: `render-${workKey.replace(/[^A-Za-z0-9_-]/g, "_")}`,
          path: "/tasks/render",
          body: {
            timeline: renderTimeline,
            sources,
            outputFile: `${task.generationId}.mp4`,
            resolution: "720p",
            ...(uploadUrl ? { uploadUrl } : {}),
            job: { projectId: task.projectId, generationId: task.generationId, userId, outputPath },
          },
        });
        return "enqueued";
      } catch (error) {
        return giveBack([`could not enqueue render: ${error instanceof Error ? error.message : String(error)}`]);
      }
    }

    const progress = throttleProgress(
      (value) => setRenderProgress(db, { ...identity, progress: value }),
      { now: config.now },
    );

    let done: Extract<RenderEvent, { done: true }> | undefined;
    try {
      const events = post(`${config.renderServiceUrl.replace(/\/$/, "")}/tasks/render`, {
        timeline: renderTimeline,
        sources,
        outputFile: `${task.generationId}.mp4`,
        resolution: "720p",
        ...(uploadUrl ? { uploadUrl } : {}),
      });

      for await (const event of events) {
        if ("progress" in event) {
          await progress.report(event.progress);
        } else if ("error" in event) {
          return giveBack([`render failed: ${event.error}${event.detail ? `: ${event.detail}` : ""}`]);
        } else {
          done = event;
        }
      }
    } catch (error) {
      return giveBack([`render service unreachable: ${error instanceof Error ? error.message : String(error)}`]);
    }

    if (!done) {
      // The stream ended with neither a finished film nor an error. Treating
      // that as success would mark a generation saved against a file that may
      // not exist.
      return giveBack(["render service closed the stream without finishing"]);
    }

    // The progress the screen waits on, written whatever the throttle did.
    await setRenderProgress(db, { ...identity, progress: 1 });
    // A local render stays on the render service's disk (its done event has
    // uploaded !== true). Copy it to the storage path so `/download` can read
    // it, and save that path instead of the on-disk one. A production render
    // (signUpload set) already uploaded, so it is untouched.
    if (done.uploaded !== true && config.storeLocalOutput) {
      const storagePath = renderOutputPath(userId, task.projectId, task.generationId);
      await config.storeLocalOutput(done.outputPath, storagePath);
      outputPath = storagePath;
    }
    await markSaved(db, { ...identity, outputPath });
    return "rendered";
  };
}

async function renderEditRevision(
  config: RenderConfig,
  task: RenderTask & { revision: number },
  post: (url: string, body: unknown) => AsyncIterable<RenderEvent>,
): Promise<RenderTaskResult> {
  const db = config.db;
  const revision = task.revision;
  const project = db.collection("projects").doc(task.projectId);
  const generationRef = project.collection("generations").doc(task.generationId);
  const currentRef = generationRef.collection("edits").doc("current");
  const revisionRef = currentRef.collection("revisions").doc(String(revision));
  const [generationSnap, projectSnap, revisionSnap] = await Promise.all([
    generationRef.get(), project.get(), revisionRef.get(),
  ]);
  if (!generationSnap.exists || !projectSnap.exists || !revisionSnap.exists || revisionSnap.get("status") !== "rendering") return "skipped";

  const settle = async (status: "ready" | "failed", fields: Record<string, unknown>): Promise<RenderTaskResult> => {
    await db.runTransaction(async (tx) => {
      const [latest, revisionLatest] = await Promise.all([tx.get(currentRef), tx.get(revisionRef)]);
      if (!revisionLatest.exists || revisionLatest.get("status") !== "rendering") return;
      tx.update(revisionRef, { status, ...fields });
      if (latest.exists && latest.get("renderRevision") === revision) tx.update(currentRef, { status, ...fields });
    });
    return status === "ready" ? "rendered" : "failed";
  };
  const fail = (reason: string) => settle("failed", { error: reason });
  if (task.giveUp) return fail(task.giveUp);
  const generation = generationSnap.data() as Generation;
  if (!generation.timeline) return fail("render requested for a generation with no timeline");
  const applied = applyEdits(generation.timeline, revisionSnap.get("ops") as EditOp[]);
  if (!applied.ok) return fail(`invalid revision ${revision}: ${applied.error}`);

  let sources: Record<string, string>;
  let renderTimeline = applied.timeline;
  try {
    renderTimeline = await addSourceDimensions(applied.timeline, config.sources.loadAsset, task.projectId);
    const slotShotIds = [...new Set(renderTimeline.videoClips.flatMap((clip) => "kind" in clip ? clip.spec.slots.flatMap((slot) => slot.shotId && !slot.manualCrop ? [slot.shotId] : []) : []))];
    if (slotShotIds.length) {
      const shotDocs = await config.db.getAll(...slotShotIds.map((shotId) => project.collection("shots").doc(shotId)));
      const facesByShot = new Map<string, import("../compose/focalCrop.js").FramingFace[]>();
      for (const shot of shotDocs) {
        const analysis = shot.get("analysis") as ShotAnalysis | undefined;
        if (analysis?.kind === "photo") facesByShot.set(shot.id, analysis.faces ?? []);
      }
      const focus = generation.settings.focus;
      renderTimeline = fitCollageCrops(renderTimeline, facesByShot, new Set(focus && focus !== "family" ? [focus] : []));
    }
    sources = await resolveSources(renderTimeline, config.sources, task.projectId, "render");
    if (config.signRead) sources = Object.fromEntries(await Promise.all(
      Object.entries(sources).map(async ([id, path]) => [id, await config.signRead!(path)] as const),
    ));
  } catch (error) {
    return fail(`source resolution failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  const userId = projectSnap.get("userId") as string;
  const outputPath = renderOutputPath(userId, task.projectId, task.generationId, revision);
  let uploadUrl: string | undefined;
  try {
    uploadUrl = await config.signUpload?.(outputPath);
  } catch (error) {
    return fail(`could not sign the render destination: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (config.enqueueRenderJob) {
    try {
      const workKey = task.workKey ?? `${task.projectId}-${task.generationId}-edit-${revision}`;
      await config.enqueueRenderJob({
        name: `render-${workKey.replace(/[^A-Za-z0-9_-]/g, "_")}`,
        path: "/tasks/render",
        body: {
          timeline: renderTimeline,
          sources,
          outputFile: `${task.generationId}-edit-${revision}.mp4`,
          resolution: "720p",
          ...(uploadUrl ? { uploadUrl } : {}),
          job: { projectId: task.projectId, generationId: task.generationId, userId, outputPath, revision },
        },
      });
      return "enqueued";
    } catch (error) {
      return fail(`could not enqueue render: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  let done: Extract<RenderEvent, { done: true }> | undefined;
  try {
    for await (const event of post(`${config.renderServiceUrl.replace(/\/$/, "")}/tasks/render`, {
      timeline: renderTimeline,
      sources,
      outputFile: `${task.generationId}-edit-${revision}.mp4`,
      resolution: "720p",
      ...(uploadUrl ? { uploadUrl } : {}),
    })) {
      if ("error" in event) return fail(`render failed: ${event.error}${event.detail ? `: ${event.detail}` : ""}`);
      if ("done" in event) done = event;
    }
  } catch (error) {
    return fail(`render service unreachable: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!done) return fail("render service closed the stream without finishing");
  if (done.uploaded !== true && config.storeLocalOutput) {
    try {
      await config.storeLocalOutput(done.outputPath, outputPath);
    } catch (error) {
      return fail(`could not store the render: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return settle("ready", { outputPath });
}
