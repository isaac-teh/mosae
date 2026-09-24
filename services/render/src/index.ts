import express from "express";
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import { createBundleOnce } from "./renderTimeline.js";
import { renderRoute } from "./renderRoute.js";
import { mkdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { loadConfig } from "./config.js";
import { requireServiceCaller } from "./auth/requireServiceCaller.js";

const config = loadConfig();
const port = Number(process.env.PORT || 8080);
const publicDir = process.env.MOSAE_REMOTION_PUBLIC_DIR ?? new URL("../../../apps/client/assets/demo", import.meta.url).pathname;
const app = express();
app.use(express.json({ limit: "8mb" }));
// Live again: `resolveMediaUrls` rewrites every non-URL source to this mount.
app.use("/media", express.static(publicDir));
mkdirSync(config.outputDir, { recursive: true });

// The bundle is built once per process, not once per request — a webpack build
// per film adds ten to thirty seconds to every render.
const bundleOnce = createBundleOnce((entryPoint) => bundle({ entryPoint, publicDir }));

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

const renderMiddleware = config.serviceCaller
  ? requireServiceCaller(config.serviceCaller)
  // Local development runs without service identity tokens.
  : (_req: express.Request, _res: express.Response, next: express.NextFunction) => next();

app.post("/tasks/render", renderMiddleware, renderRoute({
  bundle: bundleOnce,
  selectComposition: (args) => selectComposition(args as never) as never,
  renderMedia: (args) => renderMedia(args as never) as never,
  outputDir: config.outputDir,
  mediaBaseUrl: `http://127.0.0.1:${port}`,
  upload: async (uploadUrl, filePath) => {
    const body = await readFile(filePath);
    const response = await fetch(uploadUrl, { method: "PUT", headers: { "content-type": "video/mp4" }, body });
    if (!response.ok) throw new Error(`upload failed with ${response.status}`);
  },
}));

app.listen(port, () => {
  console.log(`Mosaé render service listening on port ${port}`);
});
