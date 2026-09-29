#!/usr/bin/env node
import { lstatSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import path from "node:path";

const [exportArg, projectArg] = process.argv.slice(2);
if (!exportArg || !projectArg) {
  console.error("Usage: check-web-export.mjs <export-dir> <project-root>");
  process.exit(2);
}

const exportDir = realpathSync(exportArg);
const projectRoot = realpathSync(projectArg);
const inside = (parent, candidate) => {
  const relative = path.relative(parent, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
};

if (!inside(projectRoot, exportDir)) {
  console.error("Web export directory is outside the project");
  process.exit(1);
}

const files = [];
function collect(directory) {
  for (const name of readdirSync(directory)) {
    const file = path.join(directory, name);
    const relative = path.relative(exportDir, file);
    if (relative.includes("______")) {
      throw new Error(`Invalid marker in exported path: ${relative}`);
    }

    const info = lstatSync(file);
    const realFile = realpathSync(file);
    if (!inside(projectRoot, realFile)) {
      throw new Error(`Export path resolves outside the project: ${relative}`);
    }
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

try {
  collect(exportDir);
  for (const { file, relative } of files) {
    const contents = readFileSync(file);
    if (contents.includes(Buffer.from("______"))) {
      throw new Error(`Invalid marker in exported file: ${relative}`);
    }

    if (!/\.(?:html?|css|js|mjs|json)$/i.test(file)) continue;
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
} catch (error) {
  console.error(error instanceof Error ? error.message : "Invalid web export");
  process.exit(1);
}

console.log(`Checked ${files.length} exported files for invalid paths and asset URLs`);
