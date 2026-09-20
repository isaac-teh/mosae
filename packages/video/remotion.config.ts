import path from "node:path";
import { Config } from "@remotion/cli/config";

// The spike deliberately reuses the existing local demo media. Production renders
// will receive project-specific signed media URLs instead.
Config.setPublicDir(path.resolve("../../apps/client/assets/demo"));
Config.setVideoImageFormat("jpeg");
