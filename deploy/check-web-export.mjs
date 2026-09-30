#!/usr/bin/env node
import { lstatSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const inside = (parent, candidate) => {
  const relative = path.relative(parent, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
};

export function checkWebExport(exportArg, projectArg, expectedApiUrl) {
  if (!exportArg || !projectArg || !expectedApiUrl) {
    throw new Error("Usage: check-web-export.mjs <export-dir> <project-root> <expected-api-url>");
  }

  const exportDir = realpathSync(exportArg);
  const projectRoot = realpathSync(projectArg);
  if (!inside(projectRoot, exportDir)) throw new Error("Web export directory is outside the project");

  const files = [];
  function collect(directory) {
    for (const name of readdirSync(directory)) {
      const file = path.join(directory, name);
      const relative = path.relative(exportDir, file);
      if (relative.includes("______")) throw new Error(`Invalid marker in exported path: ${relative}`);

      const info = lstatSync(file);
      const realFile = realpathSync(file);
      if (!inside(projectRoot, realFile)) throw new Error(`Export path resolves outside the project: ${relative}`);
      if (info.isDirectory() || (info.isSymbolicLink() && lstatSync(realFile).isDirectory())) {
        collect(realFile);
      } else if (info.isFile() || info.isSymbolicLink()) {
        files.push({ file: realFile, relative });
      }
    }
  }

  function localAssetPath(rawUrl, sourceFile) {
    const decoded = decodeURIComponent(rawUrl.split(/[?#]/, 1)[0]);
    if (!decoded || decoded.startsWith("#") || decoded.startsWith("data:")) return null;
    if (/^[a-z][a-z\d+.-]*:/i.test(decoded) || decoded.startsWith("//")) return null;
    const target = decoded.startsWith("/")
      ? path.resolve(exportDir, `.${decoded}`)
      : path.resolve(path.dirname(sourceFile), decoded);
    return target;
  }

  collect(exportDir);
  const jsFiles = files.filter(({ file }) => /\.(?:js|mjs|cjs)$/i.test(file));
  const javascript = jsFiles.map(({ file }) => readFileSync(file, "utf8")).join("\n");
  const knownInertThirdPartyLocalhost = [
    {
      name: "Firebase Auth requestUri fallback (not used by the app's anonymous sign-in flow)",
      pattern: /requestUri:"http:\/\/localhost",returnSecureToken:!0/g,
      count: 2,
    },
    {
      name: "Firebase Auth email-method lookup continueUri fallback (no email auth API is used by the app)",
      pattern: /continueUri:M\(\)\?L\(\):'http:\/\/localhost'/g,
      count: 1,
    },
    {
      name: "Firebase Auth popup default origin (the app uses anonymous sign-in, not popup auth)",
      pattern: /t=t\|\|"http:\/\/localhost",u\.scrollbars='yes'/g,
      count: 1,
    },
    {
      name: "Firebase Auth redirect URL parser default (the app has no redirect auth flow)",
      pattern: /hostname:'localhost',path:n,queryParams:\{\},scheme:'http'/g,
      count: 1,
    },
    {
      name: "Expo Router React Server Components origin fallback (the app does not use RSC)",
      pattern: /\?\?"http:\/\/localhost:3000"\)\.hash/g,
      count: 1,
    },
    {
      name: "Remotion transparent-video proxy (requires window.remotion_proxyPort, unset by the app)",
      pattern: /`http:\/\/localhost:\$\{window\.remotion_proxyPort\}\/proxy\?src=\$\{encodeURIComponent/g,
      count: 2,
    },
  ];
  let hostScanJavascript = javascript;
  for (const allowed of knownInertThirdPartyLocalhost) {
    const matches = [...javascript.matchAll(allowed.pattern)];
    if (matches.length !== allowed.count) {
      throw new Error(`Unexpected ${allowed.name}: expected ${allowed.count}, found ${matches.length}`);
    }
    hostScanJavascript = hostScanJavascript.replace(allowed.pattern, "");
  }
  const localHost = /localhost|127\.0\.0\.1|:(?:1808\d|1909\d|1919\d|8085|9099|9199)(?!\d)/i;
  if (localHost.test(hostScanJavascript)) {
    throw new Error("Exported JavaScript contains a localhost, loopback, or emulator host");
  }
  if (!javascript.includes(expectedApiUrl)) {
    throw new Error(`Exported JavaScript does not contain the expected API URL: ${expectedApiUrl}`);
  }
  const emulatorsEnabled = /(?:EXPO_PUBLIC_USE_EMULATORS\s*[:=]\s*["']?true\b|["']true["']\s*===?\s*["']true["']|\buseEmulators\s*[:=]\s*(?:!0|true|["']true["']))/i;
  if (emulatorsEnabled.test(javascript)) {
    throw new Error("Exported JavaScript has EXPO_PUBLIC_USE_EMULATORS inlined as true");
  }

  for (const { file, relative } of files) {
    const contents = readFileSync(file);
    if (contents.includes(Buffer.from("______"))) {
      throw new Error(`Invalid marker in exported file: ${relative}`);
    }

    if (!/\.(?:html?|css|js|mjs|cjs|json)$/i.test(file)) continue;
    const text = contents.toString("utf8");
    const candidates = [];
    for (const match of text.matchAll(/url\(\s*(['"]?)([^'"\s)]+)\1\s*\)/gi)) candidates.push(match[2]);
    for (const match of text.matchAll(/\b(?:src|href)\s*=\s*(['"])(.*?)\1/gi)) candidates.push(match[2]);
    for (const match of text.matchAll(/(['"`])((?:file:\/\/|\/|\.\.?\/)[^'"`\s]+)\1/g)) {
      const url = match[2];
      if (/(?:\/assets\/|\/_expo\/static\/|\.(?:ttf|otf|woff2?|png|jpe?g|gif|svg|webp|mp4|m4a)(?:[?#]|$))/i.test(url)) candidates.push(url);
    }

    for (const url of candidates) {
      if (url.startsWith("file://")) throw new Error(`File URL points outside the web export: ${relative}`);
      const target = localAssetPath(url, file);
      if (target && !inside(exportDir, target)) {
        throw new Error(`Local asset URL resolves outside the web export: ${relative}`);
      }
    }
  }
  return files.length;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const [exportArg, projectArg, expectedApiUrl] = process.argv.slice(2);
    const count = checkWebExport(exportArg, projectArg, expectedApiUrl);
    console.log(`Checked ${count} exported files for invalid paths, asset URLs, and production config`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Invalid web export");
    process.exit(1);
  }
}
