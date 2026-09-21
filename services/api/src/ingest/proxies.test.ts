import { copyFile, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PermanentIngestError } from "./errors.js";
import { closeProbe, probeMedia } from "./probe.js";
import { makePhotoDerivatives, makeVideoDerivatives } from "./proxies.js";
import { makeJpeg, makeVideo, tempDir } from "./testMedia.js";

let dir: string;
let cleanup: () => Promise<void>;

beforeAll(async () => {
  ({ dir, cleanup } = await tempDir());
});
afterAll(async () => {
  await closeProbe();
  await cleanup();
});

async function size(file: string) {
  const { width, height } = await sharp(file).metadata();
  return { width: width ?? 0, height: height ?? 0 };
}

describe("makePhotoDerivatives", () => {
  it("fits the thumbnail within 512px and the render copy within 2048px", async () => {
    const input = await makeJpeg(dir, "big.jpg", { width: 3000, height: 2000 });
    const out = await tempDir();
    const made = await makePhotoDerivatives(input, out.dir);
    const thumb = await size(made.thumb);
    const render = await size(made.render);
    expect(Math.max(thumb.width, thumb.height)).toBe(512);
    expect(Math.max(render.width, render.height)).toBe(2048);
    expect(thumb.width / thumb.height).toBeCloseTo(1.5, 1);
    await out.cleanup();
  });

  it("never enlarges a small photo", async () => {
    const input = await makeJpeg(dir, "small.jpg", { width: 200, height: 100 });
    const out = await tempDir();
    const made = await makePhotoDerivatives(input, out.dir);
    expect(await size(made.thumb)).toEqual({ width: 200, height: 100 });
    expect(await size(made.render)).toEqual({ width: 200, height: 100 });
    await out.cleanup();
  });

  it("applies EXIF orientation to both derivatives", async () => {
    const input = await makeJpeg(dir, "rotated.jpg", { width: 300, height: 200, orientation: 6 });
    const out = await tempDir();
    const made = await makePhotoDerivatives(input, out.dir);
    expect(await size(made.thumb)).toEqual({ width: 200, height: 300 });
    expect(await size(made.render)).toEqual({ width: 200, height: 300 });
    await out.cleanup();
  });

  it("falls back to heif-convert for an image sharp cannot decode", async () => {
    const heic = path.join(dir, "photo.heic");
    await writeFile(heic, Buffer.from("pretend this is an HEVC HEIC"));
    const decodable = await makeJpeg(dir, "converted-source.jpg", { width: 640, height: 480 });
    const run = vi.fn(async (_command: string, args: string[]) => {
      await copyFile(decodable, args[1]);
      return { stdout: "", stderr: "" };
    });
    const out = await tempDir();
    const made = await makePhotoDerivatives(heic, out.dir, run);
    expect(run).toHaveBeenCalledWith("heif-convert", [heic, path.join(out.dir, "converted.jpg")], expect.anything());
    expect(await size(made.thumb)).toEqual({ width: 512, height: 384 });
    await out.cleanup();
  });

  it("rethrows a heif-convert timeout so the task is retried", async () => {
    const heic = path.join(dir, "photo.heic");
    await writeFile(heic, Buffer.from("garbage"));
    const run = vi.fn().mockRejectedValue(Object.assign(new Error("heif-convert timed out"), { killed: true }));
    const out = await tempDir();
    const error = await makePhotoDerivatives(heic, out.dir, run).catch((error) => error);
    expect(error).not.toBeInstanceOf(PermanentIngestError);
    expect(error.message).toBe("heif-convert timed out");
    await out.cleanup();
  });

  it("fails permanently when neither sharp nor heif-convert can decode the image", async () => {
    const bad = path.join(dir, "bad.heic");
    await writeFile(bad, Buffer.from("garbage"));
    const run = vi.fn().mockRejectedValue(Object.assign(new Error("heif-convert: cannot read"), { code: 1 }));
    const out = await tempDir();
    await expect(makePhotoDerivatives(bad, out.dir, run)).rejects.toMatchObject({ name: "PermanentIngestError", reason: "unsupported_image" });
    await out.cleanup();
  });

  it.each([
    [Object.assign(new Error("spawn ENOMEM"), { code: "ENOMEM" })],
    [Object.assign(new Error("terminated"), { signal: "SIGKILL" })],
    [new Error("boom")],
  ])("keeps environmental and unknown HEIC conversion failures retryable", async (error) => {
    const heic = path.join(dir, "retry.heic");
    await writeFile(heic, Buffer.from("garbage"));
    const out = await tempDir();
    const run = vi.fn().mockRejectedValue(error);
    const caught = await makePhotoDerivatives(heic, out.dir, run).catch((failure) => failure);
    expect(caught).not.toBeInstanceOf(PermanentIngestError);
    expect(caught).toMatchObject({ message: error.message });
    await out.cleanup();
  });

  it("keeps a rejected HEIC conversion input permanent", async () => {
    const heic = path.join(dir, "permanent.heic");
    await writeFile(heic, Buffer.from("garbage"));
    const out = await tempDir();
    const run = vi.fn().mockRejectedValue(Object.assign(new Error("command failed"), { code: 1 }));
    await expect(makePhotoDerivatives(heic, out.dir, run)).rejects.toMatchObject({ reason: "unsupported_image" });
    await out.cleanup();
  });
});

describe("makeVideoDerivatives", () => {
  it("makes a 360p proxy that keeps the duration, and a 512px poster", async () => {
    const input = await makeVideo(dir, "clip.mp4", { seconds: 3, size: "640x480" });
    const out = await tempDir();
    const made = await makeVideoDerivatives(input, out.dir, 3);
    const proxy = await probeMedia(made.proxy, "video");
    expect(proxy.height).toBe(360);
    expect(proxy.durationSec).toBeGreaterThan(2.7);
    expect(proxy.durationSec).toBeLessThan(3.3);
    expect((await size(made.thumb)).width).toBe(512);
    await out.cleanup();
  });

  it("does not upscale a video smaller than 360p", async () => {
    const input = await makeVideo(dir, "tiny.mp4", { seconds: 2, size: "160x120" });
    const out = await tempDir();
    const made = await makeVideoDerivatives(input, out.dir, 2);
    expect((await probeMedia(made.proxy, "video")).height).toBe(120);
    await out.cleanup();
  });

  it("fails permanently for a video ffmpeg cannot read", async () => {
    const bad = path.join(dir, "bad.mp4");
    await writeFile(bad, Buffer.from("not a video"));
    const out = await tempDir();
    await expect(makeVideoDerivatives(bad, out.dir, 1)).rejects.toBeInstanceOf(PermanentIngestError);
    await out.cleanup();
  });

  it("rethrows a timeout as a transient error so the task is retried", async () => {
    const run = vi.fn().mockRejectedValue(Object.assign(new Error("timed out"), { killed: true }));
    const out = await tempDir();
    const error = await makeVideoDerivatives("in.mp4", out.dir, 1, run).catch((e) => e);
    expect(error).not.toBeInstanceOf(PermanentIngestError);
    expect(error.message).toBe("timed out");
    await out.cleanup();
  });

  it.each([
    [Object.assign(new Error("spawn ENOMEM"), { code: "ENOMEM" })],
    [Object.assign(new Error("terminated"), { signal: "SIGKILL" })],
    [new Error("boom")],
  ])("keeps environmental and unknown ffmpeg errors retryable", async (error) => {
    const out = await tempDir();
    const run = vi.fn().mockRejectedValue(error);
    const caught = await makeVideoDerivatives("in.mp4", out.dir, 1, run).catch((failure) => failure);
    expect(caught).not.toBeInstanceOf(PermanentIngestError);
    expect(caught).toMatchObject({ message: error.message });
    await out.cleanup();
  });

  it("keeps a rejected ffmpeg input permanent", async () => {
    const out = await tempDir();
    const run = vi.fn().mockRejectedValue(Object.assign(new Error("command failed"), { code: 1 }));
    await expect(makeVideoDerivatives("in.mp4", out.dir, 1, run)).rejects.toMatchObject({ reason: "unreadable_media" });
    await out.cleanup();
  });
});
