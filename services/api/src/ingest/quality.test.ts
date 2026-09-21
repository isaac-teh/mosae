import { writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BLUR_THRESHOLD } from "../domain/media.js";
import { analyzeImage, hammingDistance } from "./quality.js";
import { makeJpeg, tempDir } from "./testMedia.js";

let dir: string;
let cleanup: () => Promise<void>;

beforeAll(async () => {
  ({ dir, cleanup } = await tempDir());
});
afterAll(async () => {
  await cleanup();
});

async function gradient(name: string, increasing: boolean): Promise<string> {
  const width = 64;
  const height = 64;
  const pixels = Buffer.alloc(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) pixels[y * width + x] = increasing ? x * 4 : 255 - x * 4;
  }
  const file = path.join(dir, name);
  await sharp(pixels, { raw: { width, height, channels: 1 } }).jpeg({ quality: 95 }).toFile(file);
  return file;
}

describe("analyzeImage", () => {
  it("scores a detailed image above the blur threshold", async () => {
    const facts = await analyzeImage(await makeJpeg(dir, "detail.jpg", { kind: "noise", width: 600, height: 400 }));
    expect(facts.sharpness).toBeGreaterThan(BLUR_THRESHOLD);
    expect(facts.blurry).toBe(false);
  });

  it("flags a heavily blurred image as blurry", async () => {
    const source = await makeJpeg(dir, "to-blur.jpg", { kind: "noise", width: 600, height: 400 });
    const blurred = path.join(dir, "blurred.jpg");
    await sharp(source).blur(30).jpeg().toFile(blurred);
    const facts = await analyzeImage(blurred);
    expect(facts.sharpness).toBeLessThan(BLUR_THRESHOLD);
    expect(facts.blurry).toBe(true);
  });

  it("scores a flat single-colour image as essentially zero sharpness", async () => {
    const facts = await analyzeImage(await makeJpeg(dir, "flat.jpg", { kind: "flat", color: "#808080" }));
    expect(facts.sharpness).toBeLessThan(1);
    expect(facts.blurry).toBe(true);
  });

  it("measures exposure as mean luminance", async () => {
    const black = await analyzeImage(await makeJpeg(dir, "black.jpg", { kind: "flat", color: "#000000" }));
    const white = await analyzeImage(await makeJpeg(dir, "white.jpg", { kind: "flat", color: "#ffffff" }));
    expect(black.exposure).toBeLessThan(5);
    expect(white.exposure).toBeGreaterThan(250);
  });

  it("produces a 16-character hex hash, identical for identical images", async () => {
    const a = await analyzeImage(await gradient("a.jpg", true));
    const b = await analyzeImage(await gradient("b.jpg", true));
    expect(a.dHash).toMatch(/^[0-9a-f]{16}$/);
    expect(hammingDistance(a.dHash, b.dHash)).toBe(0);
  });

  it("separates opposite gradients by a large hash distance", async () => {
    const up = await analyzeImage(await gradient("up.jpg", true));
    const down = await analyzeImage(await gradient("down.jpg", false));
    expect(hammingDistance(up.dHash, down.dHash)).toBeGreaterThan(40);
  });

  it("rejects an undecodable image as a permanent failure", async () => {
    const file = path.join(dir, "bad.jpg");
    await writeFile(file, Buffer.from("not an image"));
    await expect(analyzeImage(file)).rejects.toMatchObject({ name: "PermanentIngestError", reason: "unsupported_image" });
  });
});

describe("hammingDistance", () => {
  it("counts differing bits across two 64-bit hashes", () => {
    expect(hammingDistance("0000000000000000", "0000000000000000")).toBe(0);
    expect(hammingDistance("0000000000000000", "ffffffffffffffff")).toBe(64);
    expect(hammingDistance("0000000000000001", "0000000000000003")).toBe(1);
  });
});
