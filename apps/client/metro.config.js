const { getDefaultConfig } = require("expo/metro-config");
const { withNativeWind } = require("nativewind/metro");
const config = getDefaultConfig(__dirname);
// Firebase JS SDK ships .cjs files that Metro does not resolve by default.
config.resolver.sourceExts.push("cjs");
if (!config.resolver.assetExts.includes("mp4")) config.resolver.assetExts.push("mp4");
module.exports = withNativeWind(config, { input: "./global.css" });
