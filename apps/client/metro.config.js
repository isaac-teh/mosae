const { getDefaultConfig } = require("expo/metro-config");
const { withNativeWind } = require("nativewind/metro");
const config = getDefaultConfig(__dirname);
// Firebase JS SDK ships .cjs files that Metro does not resolve by default.
config.resolver.sourceExts.push("cjs");
module.exports = withNativeWind(config, { input: "./global.css" });
