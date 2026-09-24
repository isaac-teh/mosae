import express from "express";
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import { parseRenderRequest, COMPOSITION_ID, resolveOutputPath } from "./renderTimeline.js";
import { mkdirSync } from "node:fs";
import { loadConfig } from "./config.js";
import { requireServiceCaller } from "./auth/requireServiceCaller.js";

const config = loadConfig();
const port = Number(process.env.PORT || 8080);
const publicDir = process.env.MOSAE_REMOTION_PUBLIC_DIR ?? new URL("../../../apps/client/assets/demo", import.meta.url).pathname;
const app = express();
app.use(express.json({ limit: "8mb" }));
app.use("/media", express.static(publicDir));
mkdirSync(config.outputDir, { recursive: true });

// Task 11: bundle once at startup, not per request
let cachedServeUrl: string | undefined;
async function ensureBundled(): Promise<string> {
  if (cachedServeUrl) return cachedServeUrl;
  const entry = new URL("../../../packages/video/src/index.tsx", import.meta.url).pathname;
  cachedServeUrl = await bundle({ entryPoint: entry, publicDir });
  console.log(`bundled video package at ${cachedServeUrl}`);
  return cachedServeUrl;
}

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

const renderMiddleware = config.serviceCaller
  ? requireServiceCaller(config.serviceCaller)
  // Local development runs without service identity tokens.
  : (_req: express.Request, _res: express.Response, next: express.NextFunction) => next();

app.post("/tasks/render", renderMiddleware, async (req, res) => {
  let request;
  try {
    request = parseRenderRequest(req.body);
  } catch (error) {
    res.status(400).json({ error: "invalid_request", detail: error instanceof Error ? error.message : String(error) });
    return;
  }

  try {
    const serveUrl = await ensureBundled(); // Task 11: cached bundle, not per-request
    const outputPath = resolveOutputPath(config.outputDir, request.outputFile);
    const inputProps = { timeline: request.timeline, sources: request.sources };
    const composition = await selectComposition({ serveUrl, id: COMPOSITION_ID, inputProps });

    await renderMedia({
      serveUrl,
      composition,
      codec: "h264",
      outputLocation: outputPath,
      inputProps,
      onProgress: ({ progress }: { progress: number }) => {
        if (Math.round(progress * 100) % 10 === 0) console.log("render progress", Math.round(progress * 100));
      },
    });

    res.json({ outputPath, durationInFrames: composition.durationInFrames });
  } catch (error) {
    console.error("render failed", error);
    res.status(500).json({ error: "render_failed", detail: error instanceof Error ? error.message : String(error) });
  }
});

app.listen(port, () => {
  console.log(`Mosaé render service listening on port ${port}`);
});
