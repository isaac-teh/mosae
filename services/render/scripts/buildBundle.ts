import { bundle } from "@remotion/bundler";
import { mkdir } from "node:fs/promises";

const entryPoint = new URL("../../../packages/video/src/index.tsx", import.meta.url).pathname;
const publicDir = process.env.MOSAE_REMOTION_PUBLIC_DIR ?? "/app/apps/client/assets/demo";
const outDir = process.env.MOSAE_REMOTION_BUNDLE_OUT_DIR ?? "/app/remotion-bundle";

await mkdir(outDir, { recursive: true });
console.log(`Bundling Remotion composition to ${outDir}`);
await bundle({ entryPoint, publicDir, outDir, webpackOverride: (config) => ({ ...config, resolve: { ...config.resolve, extensionAlias: { ...config.resolve?.extensionAlias, ".js": [".js", ".ts", ".tsx"] } } }) });
console.log(`REMOTION_BUNDLE_OK serveUrl=${outDir}`);
