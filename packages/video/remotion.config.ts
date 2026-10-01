import path from "node:path";
import { Config } from "@remotion/cli/config";

// The spike deliberately reuses the existing local demo media. Production renders
// will receive project-specific signed media URLs instead.
Config.setPublicDir(process.env.MOSAE_REMOTION_PUBLIC_DIR ?? path.resolve("../../apps/client/assets/demo"));
Config.setVideoImageFormat("jpeg");
// Workspace contracts use ESM .js imports backed by TypeScript source files.
Config.overrideWebpackConfig((config) => ({
  ...config,
  resolve: {
    ...config.resolve,
    extensionAlias: { ...config.resolve?.extensionAlias, ".js": [".js", ".ts", ".tsx"] },
  },
}));
