import type { Firestore } from "firebase-admin/firestore";
import type { Generation } from "@mosae/contracts";
import { resolveSources, type SourceDeps } from "../compose/resolveSources.js";
import { failGeneration, markSaved, resetRender, setRenderProgress } from "../store/generationStore.js";
import { throttleProgress } from "./throttleProgress.js";

export type RenderTask = {
  projectId: string;
  generationId: string;
  /** Set when retries are exhausted: settle the generation, do not render. */
  giveUp?: string;
};

export type RenderTaskResult = "rendered" | "failed" | "skipped";

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
  /** Test seam: POST the request and yield the service's events. */
  post?: (url: string, body: unknown) => AsyncIterable<RenderEvent>;
  now?: () => number;
};

/** `renders/{userId}/{projectId}/{generationId}.mp4`, as the spec names it. */
export function renderOutputPath(userId: string, projectId: string, generationId: string): string {
  return `renders/${userId}/${projectId}/${generationId}.mp4`;
}

/** Read the render service's newline-delimited response one event at a time. */
export async function* postForEvents(url: string, body: unknown): AsyncIterable<RenderEvent> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
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
    try {
      sources = await resolveSources(generation.timeline, config.sources, task.projectId, "render");
      if (config.signRead) {
        sources = Object.fromEntries(
          await Promise.all(Object.entries(sources).map(async ([id, path]) => [id, await config.signRead!(path)] as const)),
        );
      }
    } catch (error) {
      return giveBack([`source resolution failed: ${error instanceof Error ? error.message : String(error)}`]);
    }

    const outputPath = renderOutputPath(userId, task.projectId, task.generationId);
    let uploadUrl: string | undefined;
    try {
      uploadUrl = await config.signUpload?.(outputPath);
    } catch (error) {
      return giveBack([`could not sign the render destination: ${error instanceof Error ? error.message : String(error)}`]);
    }

    const progress = throttleProgress(
      (value) => setRenderProgress(db, { ...identity, progress: value }),
      { now: config.now },
    );

    let done: Extract<RenderEvent, { done: true }> | undefined;
    try {
      const events = post(`${config.renderServiceUrl.replace(/\/$/, "")}/tasks/render`, {
        timeline: generation.timeline,
        sources,
        outputFile: `${task.generationId}.mp4`,
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
    await markSaved(db, { ...identity, outputPath });
    return "rendered";
  };
}
