const { chromium } = require("playwright");
const { createServer } = require("vite");
const sharp = require("sharp");
const http = require("node:http");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const COUNT = 15;

async function makeFixtures(directory) {
  for (let index = 0; index < COUNT; index++) {
    const width = 3200, height = 2400;
    let seed = 0x1234abcd + index;
    const pixels = Buffer.alloc(width * height * 3);
    for (let i = 0; i < pixels.length; i += 3) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      const noise = seed >>> 24;
      const x = ((i / 3) % width) / width;
      const y = Math.floor(i / 3 / width) / height;
      pixels[i] = (noise * 0.28 + x * 180) | 0;
      pixels[i + 1] = (noise * 0.22 + y * 190) | 0;
      pixels[i + 2] = (noise * 0.2 + (1 - x) * 150) | 0;
    }
    await sharp(pixels, { raw: { width, height, channels: 3 } })
      .jpeg({ quality: 92 })
      .withExif({ IFD0: { Make: "Mosae benchmark" }, Exif: { DateTimeOriginal: "2020:04:03 12:34:56" }, GPS: { GPSLatitude: "1/1,21/1,756/100", GPSLatitudeRef: "N", GPSLongitude: "103/1,49/1,1152/100", GPSLongitudeRef: "E" } })
      .toFile(path.join(directory, `photo-${String(index + 1).padStart(2, "0")}.jpg`));
  }
}

async function main() {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "mosae-upload-speed-"));
  const vite = await createServer({ root: ROOT, configFile: false, logLevel: "error", server: { host: "127.0.0.1", port: 18810, strictPort: true } });
  const receiver = http.createServer((request, response) => {
    if (request.method === "OPTIONS") { response.writeHead(204, { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST", "Access-Control-Allow-Headers": "content-type" }).end(); return; }
    if (request.method !== "POST" || !request.url.startsWith("/upload/")) { response.writeHead(404).end(); return; }
    request.on("data", () => {});
    request.on("end", () => { response.writeHead(204, { "Access-Control-Allow-Origin": "*" }).end(); });
  });
  let browser;
  try {
    await makeFixtures(temp);
    await vite.listen();
    await new Promise((resolve, reject) => receiver.listen(18811, "127.0.0.1", resolve).once("error", reject));
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Network.enable");
    await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 150, downloadThroughput: 4 * 1024 * 1024 / 8, uploadThroughput: 3 * 1024 * 1024 / 8, connectionType: "cellular4g" });
    await page.goto("http://127.0.0.1:18810/e2e/upload-speed-bench.html");
    await page.locator("#files").setInputFiles(Array.from({ length: COUNT }, (_, index) => path.join(temp, `photo-${String(index + 1).padStart(2, "0")}.jpg`)));
    const fixtureSizes = await page.locator("#files").evaluate((input) => Array.from(input.files, (file) => file.size));
    const baseline = await page.evaluate(() => window.runUploadSet(false));
    const after = await page.evaluate(() => window.runUploadSet(true));
    console.log(JSON.stringify({ profile: "CDP cellular4g, 150ms RTT, 3Mbps upload / 4Mbps download", fixtures: COUNT, fixtureBytes: fixtureSizes.reduce((sum, size) => sum + size, 0), fixtureMinBytes: Math.min(...fixtureSizes), baseline, after, improvementPercent: Math.round((1 - after.milliseconds / baseline.milliseconds) * 100) }, null, 2));
  } finally {
    if (browser) await browser.close();
    await new Promise((resolve) => receiver.close(resolve));
    await vite.close();
    await fs.rm(temp, { recursive: true, force: true });
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
