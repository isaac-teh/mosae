import { bundle } from "@remotion/bundler";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Keep these paths and bundle options in sync with services/render/src/index.ts.
const entryPoint = new URL("../../../packages/video/src/index.tsx", import.meta.url).pathname;
const publicDir = process.env.MOSAE_REMOTION_PUBLIC_DIR
  ?? new URL("../../../apps/client/assets/demo", import.meta.url).pathname;
const outDir = await mkdtemp(join(tmpdir(), "mosae-remotion-bundle-"));

console.log(`Bundling entryPoint=${entryPoint}`);
console.log(`Using publicDir=${publicDir}`);
console.log(`Writing bundle to ${outDir}`);
const serveUrl = await bundle({ entryPoint, publicDir, outDir });
console.log(`REMOTION_BUNDLE_OK serveUrl=${serveUrl}`);
