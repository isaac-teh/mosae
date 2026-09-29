const { getDefaultConfig } = require("expo/metro-config");
const { withNativeWind } = require("nativewind/metro");
const config = getDefaultConfig(__dirname);
// Firebase JS SDK ships .cjs files that Metro does not resolve by default.
config.resolver.sourceExts.push("cjs");
if (!config.resolver.assetExts.includes("mp4")) config.resolver.assetExts.push("mp4");
// Workspace packages use NodeNext .js specifiers in TypeScript source. Metro
// serves those sources directly, so retry a relative .js import as .ts/.tsx.
config.resolver.resolveRequest = (context, moduleName, platform) => {
  try { return context.resolveRequest(context, moduleName, platform); }
  catch (error) {
    if (moduleName.startsWith(".") && moduleName.endsWith(".js")) {
      return context.resolveRequest(context, moduleName.slice(0, -3), platform);
    }
    throw error;
  }
};
module.exports = withNativeWind(config, { input: "./global.css" });
