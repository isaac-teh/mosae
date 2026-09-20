import { parseTimeline, type Timeline } from "@mosae/contracts";

export type RenderRequest = {
  timeline: Timeline;
  sources: Record<string, string>;
  outputPath: string;
};

export type RenderDeps = {
  bundle: (entry: string) => Promise<string>;
  selectComposition: (args: { serveUrl: string; id: string; inputProps: unknown }) => Promise<{ durationInFrames: number } & Record<string, unknown>>;
  renderMedia: (args: Record<string, unknown>) => Promise<void>;
  onProgress?: (fraction: number) => void;
};

export const COMPOSITION_ID = "MosaeTimeline";

/**
 * Every shot, asset and soundtrack a Timeline names must resolve, or the render
 * silently drops picture or sound. Checking here turns that into a rejected
 * request instead of a film with holes in it.
 */
function missingSources(timeline: Timeline, sources: Record<string, string>): string[] {
  const needed = new Set<string>();
  for (const clip of timeline.videoClips) needed.add(clip.source.shotId);
  for (const clip of timeline.audioClips) {
    needed.add(clip.source.kind === "asset" ? clip.source.assetId : clip.source.soundtrackId);
  }
  return [...needed].filter((key) => typeof sources[key] !== "string" || sources[key].length === 0);
}

export function parseRenderRequest(body: unknown): RenderRequest {
  const input = body as Partial<RenderRequest> | null;
  if (!input || typeof input !== "object") throw new Error("render request must be an object");
  if (typeof input.outputPath !== "string" || input.outputPath.length === 0) {
    throw new Error("render request requires an outputPath");
  }
  const sources = input.sources;
  if (!sources || typeof sources !== "object") throw new Error("render request requires a sources map");

  let timeline: Timeline;
  try {
    timeline = parseTimeline(input.timeline);
  } catch (error) {
    throw new Error(`render request timeline is invalid: ${error instanceof Error ? error.message : String(error)}`);
  }

  const missing = missingSources(timeline, sources as Record<string, string>);
  if (missing.length > 0) throw new Error(`missing source for ${missing.join(", ")}`);

  return { timeline, sources: sources as Record<string, string>, outputPath: input.outputPath };
}

export async function renderTimeline(
  request: RenderRequest,
  deps: RenderDeps,
): Promise<{ outputPath: string; durationInFrames: number }> {
  const entry = new URL("../../../packages/video/src/index.tsx", import.meta.url).pathname;
  const serveUrl = await deps.bundle(entry);
  const inputProps = { timeline: request.timeline, sources: request.sources };
  const composition = await deps.selectComposition({ serveUrl, id: COMPOSITION_ID, inputProps });

  await deps.renderMedia({
    serveUrl,
    composition,
    codec: "h264",
    outputLocation: request.outputPath,
    inputProps,
    onProgress: ({ progress }: { progress: number }) => deps.onProgress?.(progress),
  });

  return { outputPath: request.outputPath, durationInFrames: composition.durationInFrames };
}
