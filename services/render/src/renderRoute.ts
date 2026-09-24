import type { Request, RequestHandler, Response } from "express";
import { parseRenderRequest, renderTimeline, resolveMediaUrls, type RenderDeps } from "./renderTimeline.js";

/**
 * The service's one render path.
 *
 * It is a handler rather than a body inlined into `index.ts` because `index.ts`
 * listens on a port the moment it is imported, and a render path no test can
 * reach is a render path nobody has run. The previous arrangement inlined the
 * render here and left `renderTimeline` with four tests and no caller.
 */
export type RenderRouteDeps = Omit<RenderDeps, "onProgress"> & {
  outputDir: string;
  /** Where this process serves its own `/media` mount, e.g. `http://127.0.0.1:8080`. */
  mediaBaseUrl: string;
  /** PUT the finished file to a signed URL. Omitted locally, where the file stays on disk. */
  upload?: (uploadUrl: string, filePath: string) => Promise<void>;
};

/**
 * Progress is streamed as newline-delimited JSON rather than returned at the
 * end, because the caller writes it to the generation and a film can render for
 * minutes. The caller decides how often to persist it; this reports every tick.
 */
export function renderRoute(deps: RenderRouteDeps): RequestHandler {
  return async (req: Request, res: Response) => {
    let request;
    try {
      request = parseRenderRequest(req.body);
    } catch (error) {
      res.status(400).json({ error: "invalid_request", detail: error instanceof Error ? error.message : String(error) });
      return;
    }

    res.status(200);
    res.set("Content-Type", "application/x-ndjson");
    const write = (line: unknown): void => {
      res.write(`${JSON.stringify(line)}\n`);
    };

    try {
      const result = await renderTimeline(
        // Remotion needs URLs. A storage path is served from this process's own
        // `/media` mount; anything already a URL is passed through untouched.
        { ...request, sources: resolveMediaUrls(request.sources, deps.mediaBaseUrl) },
        { bundle: deps.bundle, selectComposition: deps.selectComposition, renderMedia: deps.renderMedia, onProgress: (progress) => write({ progress }) },
        deps.outputDir,
      );

      if (request.uploadUrl) {
        if (!deps.upload) throw new Error("this render service cannot upload");
        await deps.upload(request.uploadUrl, result.outputPath);
      }

      write({ done: true, outputPath: result.outputPath, durationInFrames: result.durationInFrames, uploaded: Boolean(request.uploadUrl) });
    } catch (error) {
      // The stream is already open, so a failure is the last line rather than a
      // status code. A caller that stops at the first line it can parse would
      // otherwise read a half-written film as a finished one.
      console.error("render failed", error);
      write({ error: "render_failed", detail: error instanceof Error ? error.message : String(error) });
    } finally {
      res.end();
    }
  };
}
