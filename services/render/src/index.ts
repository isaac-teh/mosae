import express from "express";
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import { parseRenderRequest, renderTimeline } from "./renderTimeline.js";

const port = Number(process.env.PORT || 8080);
const app = express();
app.use(express.json({ limit: "8mb" }));

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.post("/tasks/render", async (req, res) => {
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
      sources: Object.fromEntries(Object.entries(request.sources).map(([key, source]) => [key, `public/${source}`])),
    }, {
      bundle: (entry) => bundle({
        entryPoint: entry,
        publicDir: process.env.MOSAE_REMOTION_PUBLIC_DIR ?? new URL("../../../apps/client/assets/demo", import.meta.url).pathname,
      }),
      selectComposition: (args) => selectComposition(args as never) as never,
      renderMedia: (args) => renderMedia(args as never) as never,
      onProgress: (fraction) => {
        if (Math.round(fraction * 100) % 10 === 0) console.log("render progress", Math.round(fraction * 100));
      },
    });
    res.json(result);
  } catch (error) {
    console.error("render failed", error);
    res.status(500).json({ error: "render_failed", detail: error instanceof Error ? error.message : String(error) });
  }
});

app.listen(port, () => {
  console.log(`Mosaé render service listening on port ${port}`);
});
