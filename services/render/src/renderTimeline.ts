import { collageShotIds, parseTimeline, type Timeline } from "@mosae/contracts";
import { resolve } from "node:path";

export type RenderRequest = {
  timeline: Timeline;
  sources: Record<string, string>;
  outputFile: string;
  /**
   * Where the finished MP4 belongs. A signed PUT URL, so the render service
   * needs no storage SDK and no credentials of its own, and the caller decides
   * the destination path. Omitted for a local render, which stays on disk.
   */
  uploadUrl?: string;
  /** Present for Cloud Tasks jobs that report status back to the API. */
  job?: { projectId: string; generationId: string; userId: string; outputPath: string; revision?: number };
};

export type RenderDeps = {
  bundle: (entry: string) => Promise<string>;
  selectComposition: (args: { serveUrl: string; id: string; inputProps: unknown }) => Promise<{ durationInFrames: number } & Record<string, unknown>>;
  renderMedia: (args: Record<string, unknown>) => Promise<void>;
  onProgress?: (fraction: number) => void;
};

export const COMPOSITION_ID = "MosaeTimeline";

const OUTPUT_FILE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}\.mp4$/;

export function resolveOutputPath(dir: string, outputFile: string): string {
  if (!OUTPUT_FILE_PATTERN.test(outputFile)) throw new Error("render request has an invalid outputFile");
  return resolve(dir, outputFile);
}

/**
 * Every shot and asset a Timeline names must resolve, or the render silently
 * drops picture or sound. Checking here turns that into a rejected request
 * instead of a film with holes in it.
 *
 * A **soundtrack** id is deliberately not required. The soundtrack library does
 * not exist — nothing can turn `soundtrack-dusk` into a file — and the spec
 * says a film with no resolvable score is still a valid film. Requiring one
 * rejected every film that had music, which is every film the composer scores,
 * so the two sides disagreed and the golden fixture was exactly the case that
 * could not render. `resolveSources` omits an unresolvable soundtrack and this
 * accepts its absence; the Timeline component already renders no audio track
 * for a source it has no URL for.
 */
export function missingSources(timeline: Timeline, sources: Record<string, string>): string[] {
  const needed = new Set<string>();
  for (const clip of timeline.videoClips) if ("source" in clip) needed.add(clip.source.shotId);
  for (const shotId of collageShotIds(timeline)) needed.add(shotId);
  for (const clip of timeline.audioClips) {
    if (clip.source.kind === "asset") needed.add(clip.source.assetId);
  }
  return [...needed].filter((key) => typeof sources[key] !== "string" || sources[key].length === 0);
}

/**
 * Remotion is handed URLs, not storage paths. Anything that is already a URL is
 * passed through; anything else is served from this process's own `/media`
 * mount over the Remotion public directory. Dropping this rewrite left Remotion
 * resolving `uploads/owner/…` as a relative URL, which 404s into black frames.
 */
export function resolveMediaUrls(sources: Record<string, string>, mediaBaseUrl: string): Record<string, string> {
  return Object.fromEntries(
    Object.entries(sources).map(([key, source]) => [
      key,
      /^(https?|file|data):/.test(source) ? source : `${mediaBaseUrl.replace(/\/$/, "")}/media/${source}`,
    ]),
  );
}

/**
 * Wrap a bundler so it runs once per process. The thin slice builds the bundle
 * at image build time; a `bundle()` per request is a full webpack build on
 * every film. Concurrent first requests share the one in-flight build rather
 * than starting a second.
 */
export function createBundleOnce(build: (entry: string) => Promise<string>): (entry: string) => Promise<string> {
  let pending: Promise<string> | undefined;
  return (entry) => {
    pending ??= build(entry);
    return pending;
  };
}

export function parseRenderRequest(body: unknown): RenderRequest {
  const input = body as Partial<RenderRequest> | null;
  if (!input || typeof input !== "object") throw new Error("render request must be an object");
  if (typeof input.outputFile !== "string") {
    throw new Error("render request requires an outputFile");
  }
  if (input.uploadUrl !== undefined && (typeof input.uploadUrl !== "string" || !/^https?:\/\//.test(input.uploadUrl))) {
    throw new Error("render request uploadUrl must be an http(s) URL");
  }
  resolveOutputPath("/unused", input.outputFile);
  const sources = input.sources;
  if (!sources || typeof sources !== "object") throw new Error("render request requires a sources map");
  if (input.job !== undefined) {
    const job = input.job as Partial<NonNullable<RenderRequest["job"]>> | null;
    if (!job || ![job.projectId, job.generationId, job.userId, job.outputPath].every((value) => typeof value === "string" && value.length > 0)) {
      throw new Error("render request job metadata is invalid");
    }
    if (job.revision !== undefined && (!Number.isSafeInteger(job.revision) || job.revision < 1)) throw new Error("render request job revision is invalid");
  }

  let timeline: Timeline;
  try {
    timeline = parseTimeline(input.timeline);
  } catch (error) {
    throw new Error(`render request timeline is invalid: ${error instanceof Error ? error.message : String(error)}`);
  }

  const missing = missingSources(timeline, sources as Record<string, string>);
  if (missing.length > 0) throw new Error(`missing source for ${missing.join(", ")}`);

  return {
    timeline,
    sources: sources as Record<string, string>,
    outputFile: input.outputFile,
    ...(input.uploadUrl ? { uploadUrl: input.uploadUrl } : {}),
    ...(input.job ? { job: input.job as RenderRequest["job"] } : {}),
  };
}

export async function renderTimeline(
  request: RenderRequest,
  deps: RenderDeps,
  outputDir: string,
): Promise<{ outputPath: string; durationInFrames: number }> {
  const outputPath = resolveOutputPath(outputDir, request.outputFile);
  const entry = new URL("../../../packages/video/src/index.tsx", import.meta.url).pathname;
  const serveUrl = await deps.bundle(entry);
  const inputProps = { timeline: request.timeline, sources: request.sources };
  const composition = await deps.selectComposition({ serveUrl, id: COMPOSITION_ID, inputProps });

  await deps.renderMedia({
    serveUrl,
    composition,
    codec: "h264",
    outputLocation: outputPath,
    inputProps,
    onProgress: ({ progress }: { progress: number }) => deps.onProgress?.(progress),
  });

  return { outputPath, durationInFrames: composition.durationInFrames };
}
