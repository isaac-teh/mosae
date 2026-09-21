import sharp from "sharp";
import { BLUR_THRESHOLD, type QualityFacts } from "../domain/media.js";
import { PermanentIngestError } from "./errors.js";
import { isDecodeFailure } from "./errorClass.js";

/**
 * The 75th-percentile tile score, not a whole-frame score. That keeps
 * intentionally shallow-focus food and portrait shots, where part of the frame is
 * crisp, while still rejecting a uniformly defocused frame. Calibrated on the PoC
 * trip set: the sharpest kept photo scored 180.9 and the defocused control 3.1.
 */
function tileSharpness(gray: Buffer, width: number, height: number): number {
  const tiles: number[] = [];
  for (let ty = 0; ty < 4; ty += 1) {
    for (let tx = 0; tx < 4; tx += 1) {
      const x0 = Math.floor((tx * width) / 4);
      const x1 = Math.floor(((tx + 1) * width) / 4);
      const y0 = Math.floor((ty * height) / 4);
      const y1 = Math.floor(((ty + 1) * height) / 4);
      let n = 0;
      let sum = 0;
      let sum2 = 0;
      for (let y = Math.max(1, y0); y < Math.min(height - 1, y1); y += 1) {
        for (let x = Math.max(1, x0); x < Math.min(width - 1, x1); x += 1) {
          const i = y * width + x;
          const laplacian = 4 * gray[i] - gray[i - 1] - gray[i + 1] - gray[i - width] - gray[i + width];
          n += 1;
          sum += laplacian;
          sum2 += laplacian * laplacian;
        }
      }
      if (n) tiles.push(sum2 / n - (sum / n) ** 2);
    }
  }
  tiles.sort((a, b) => a - b);
  return tiles[Math.floor(tiles.length * 0.75)] ?? 0;
}

/** Difference hash: one bit per horizontal neighbour comparison on a 9x8 grayscale. */
async function differenceHash(file: string): Promise<string> {
  const pixels = await sharp(file, { failOn: "none" }).rotate().resize(9, 8, { fit: "fill" }).grayscale().raw().toBuffer();
  let bits = "";
  for (let y = 0; y < 8; y += 1) {
    for (let x = 0; x < 8; x += 1) bits += pixels[y * 9 + x] > pixels[y * 9 + x + 1] ? "1" : "0";
  }
  let hex = "";
  for (let i = 0; i < 64; i += 4) hex += parseInt(bits.slice(i, i + 4), 2).toString(16);
  return hex;
}

export function hammingDistance(a: string, b: string): number {
  let differing = BigInt(`0x${a}`) ^ BigInt(`0x${b}`);
  let count = 0;
  while (differing > 0n) {
    count += Number(differing & 1n);
    differing >>= 1n;
  }
  return count;
}

export async function analyzeImage(file: string): Promise<QualityFacts> {
  try {
    const { data, info } = await sharp(file, { failOn: "none" })
      .rotate()
      .resize(512, 512, { fit: "inside", withoutEnlargement: true })
      .grayscale()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const sharpness = tileSharpness(data, info.width, info.height);
    let total = 0;
    for (let i = 0; i < data.length; i += 1) total += data[i];
    const exposure = data.length ? total / data.length : 0;

    return { sharpness, exposure, blurry: sharpness < BLUR_THRESHOLD, dHash: await differenceHash(file) };
  } catch (error) {
    if (!isDecodeFailure(error)) throw error;
    throw new PermanentIngestError("unsupported_image", error instanceof Error ? error.message : String(error));
  }
}
