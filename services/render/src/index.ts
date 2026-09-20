import express from "express";
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import { parseRenderRequest, renderTimeline } from "./renderTimeline.js";
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
    const result = await renderTimeline({
      ...request,
      sources: Object.fromEntries(Object.entries(request.sources).map(([key, source]) => [key, source.startsWith("http") ? source : `http://127.0.0.1:${port}/media/${source}`])),
    }, {
      bundle: (entry) => bundle({
        entryPoint: entry,
        publicDir,
      }),
      selectComposition: (args) => selectComposition(args as never) as never,
      renderMedia: (args) => renderMedia(args as never) as never,
      onProgress: (fraction) => {
        if (Math.round(fraction * 100) % 10 === 0) console.log("render progress", Math.round(fraction * 100));
      },
    }, config.outputDir);
    res.json(result);
  } catch (error) {
    console.error("render failed", error);
    res.status(500).json({ error: "render_failed", detail: error instanceof Error ? error.message : String(error) });
  }
});

app.listen(port, () => {
  console.log(`Mosaé render service listening on port ${port}`);
});
