#!/usr/bin/env node
import { createReadStream, realpathSync, statSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";

const MIME = new Map([
  [".html", "text/html; charset=utf-8"], [".js", "text/javascript; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"], [".css", "text/css; charset=utf-8"],
  [".json", "application/json"], [".svg", "image/svg+xml"], [".png", "image/png"],
  [".jpg", "image/jpeg"], [".jpeg", "image/jpeg"], [".webp", "image/webp"],
  [".woff", "font/woff"], [".woff2", "font/woff2"], [".ttf", "font/ttf"],
  [".mp4", "video/mp4"], [".m4a", "audio/mp4"],
]);

export async function smokeWebExport(exportArg) {
  if (!exportArg) throw new Error("Usage: smoke-web-export.mjs <export-dir>");
  const root = realpathSync(exportArg);
  if (!statSync(path.join(root, "index.html")).isFile()) throw new Error("Web export is missing index.html");

  const server = http.createServer((request, response) => {
    let pathname;
    try { pathname = decodeURIComponent(new URL(request.url ?? "/", "http://static.invalid").pathname); }
    catch { response.writeHead(400).end(); return; }
    let file = path.resolve(root, `.${pathname}`);
    if (!file.startsWith(`${root}${path.sep}`) && file !== root) { response.writeHead(403).end(); return; }
    try {
      if (!statSync(file).isFile()) file = path.join(root, "index.html");
    } catch { file = path.join(root, "index.html"); }
    response.setHeader("Content-Type", MIME.get(path.extname(file).toLowerCase()) ?? "application/octet-stream");
    createReadStream(file).on("error", () => { if (!response.headersSent) response.writeHead(404); response.end(); }).pipe(response);
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Unable to bind static smoke server");
  const origin = `http://127.0.0.1:${address.port}`;
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    const errors = [];
    const badRequests = [];
    page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
    page.on("console", (message) => { if (message.type() === "error") errors.push(`console: ${message.text()}`); });
    page.on("request", (request) => {
      try {
        const url = new URL(request.url());
        const local = url.hostname === "localhost" || /^127\./.test(url.hostname);
        if (local && url.origin !== origin) badRequests.push(request.url());
      } catch {}
    });

    const response = await page.goto(`${origin}/`, { waitUntil: "domcontentloaded", timeout: 30000 });
    if (!response?.ok()) throw new Error(`Web entry returned HTTP ${response?.status() ?? "no response"}`);
    await page.getByText("Try with a demo trip", { exact: true }).waitFor({ state: "visible", timeout: 20000 });
    const body = await page.locator("body").evaluate((element) => ({ text: element.innerText.trim(), childCount: element.children.length }));
    if (!body.text || body.childCount === 0) throw new Error("Web entry rendered an empty body");
    await page.waitForTimeout(500);
    if (badRequests.length) errors.push(`unexpected local requests: ${badRequests.join(", ")}`);
    if (errors.length) throw new Error(errors.join("\n"));
    console.log(`Web boot smoke passed: ${origin}/ rendered “Try with a demo trip” with no browser errors or unexpected local requests`);
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  smokeWebExport(process.argv[2]).catch((error) => {
    console.error(error instanceof Error ? error.message : "Web boot smoke failed");
    process.exitCode = 1;
  });
}
