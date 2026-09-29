import express from "express";
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import { createBundleOnce } from "./renderTimeline.js";
import { renderRoute, type RenderCallbackPayload } from "./renderRoute.js";
import { mkdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { loadConfig } from "./config.js";
import { requireServiceCaller } from "./auth/requireServiceCaller.js";
import { GoogleAuth } from "google-auth-library";

const config = loadConfig();
// The API expects render on 8081 (`services/api/src/config.ts:37`), not the
// default 8080 which is the API's own port. `start-all.sh` passes PORT=8081;
// this keeps the two from colliding if someone forgets to set it.
const port = Number(process.env.PORT || 8081);
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

const reportToApi = config.apiServiceUrl
  ? async (event: RenderCallbackPayload): Promise<void> => {
      const audience = config.apiServiceUrl!;
      const client = await new GoogleAuth().getIdTokenClient(audience);
      const token = await client.idTokenProvider.fetchIdToken(audience);
      const response = await fetch(`${audience}/internal/render-callback`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify(event),
      });
      if (!response.ok) throw new Error(`API render callback failed with ${response.status}`);
    }
  : undefined;

app.post("/tasks/render", renderMiddleware, renderRoute({
  bundle: bundleOnce,
  selectComposition: (args) => selectComposition(args as never) as never,
  renderMedia: (args) => renderMedia(args as never) as never,
  outputDir: config.outputDir,
  mediaBaseUrl: `http://127.0.0.1:${port}`,
  ...(reportToApi ? { callback: reportToApi } : {}),
  upload: async (uploadUrl, filePath) => {
    const body = await readFile(filePath);
    const response = await fetch(uploadUrl, { method: "PUT", headers: { "content-type": "video/mp4" }, body });
    if (!response.ok) throw new Error(`upload failed with ${response.status}`);
  },
}));

app.listen(port, () => {
  console.log(`Mosaé render service listening on port ${port}`);
});
