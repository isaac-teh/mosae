import path from "node:path";
import sharp from "sharp";
import { PermanentIngestError } from "./errors.js";
import { defaultRun, isTimeout, type Runner } from "./run.js";

export const THUMB_MAX = 512;
export const RENDER_MAX = 2048;
export const PROXY_HEIGHT = 360;

export type PhotoDerivatives = { thumb: string; render: string };

/** sharp's prebuilt libvips cannot decode HEVC-coded HEIC, which is what iPhones write. */
const NEEDS_HEIF = /heif|heic|codec|unsupported image format/i;

async function encode(source: string, outDir: string): Promise<PhotoDerivatives> {
  const render = path.join(outDir, "render.jpg");
  const thumb = path.join(outDir, "thumb.jpg");
  await sharp(source, { failOn: "none" })
    .rotate()
    .resize(RENDER_MAX, RENDER_MAX, { fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 88 })
    .toFile(render);
  await sharp(render)
    .resize(THUMB_MAX, THUMB_MAX, { fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 78 })
    .toFile(thumb);
  return { thumb, render };
}

/**
 * Orientation is applied once here, so every consumer downstream (the UI, the
 * renderer, Gemini) sees an upright image and never has to know about EXIF.
 */
export async function makePhotoDerivatives(input: string, outDir: string, run: Runner = defaultRun): Promise<PhotoDerivatives> {
  try {
    return await encode(input, outDir);
  } catch (first) {
    const message = first instanceof Error ? first.message : String(first);
    if (!NEEDS_HEIF.test(message)) throw new PermanentIngestError("unsupported_image", message);
    const converted = path.join(outDir, "converted.jpg");
    try {
      await run("heif-convert", [input, converted], { timeoutMs: 120_000 });
      return await encode(converted, outDir);
    } catch (error) {
      if (isTimeout(error)) throw error;
      throw new PermanentIngestError("unsupported_image", message);
    }
  }
}

export type VideoDerivatives = { proxy: string; thumb: string };

/**
 * A 360p proxy at a low frame rate keeps duration and audio in sync, so every
 * timestamp taken from the proxy is valid on the original. Audio is kept because
 * transcription in the next phase reads the proxy.
 */
export async function makeVideoDerivatives(
  input: string,
  outDir: string,
  durationSec: number,
  run: Runner = defaultRun,
): Promise<VideoDerivatives> {
  const proxy = path.join(outDir, "proxy.mp4");
  const thumb = path.join(outDir, "video-thumb.jpg");
  try {
    await run("ffmpeg", [
      "-y", "-hide_banner", "-loglevel", "error",
      "-i", input,
      "-vf", `fps=12,scale=-2:'min(${PROXY_HEIGHT},ih)'`,
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "30", "-pix_fmt", "yuv420p",
      "-c:a", "aac", "-b:a", "64k",
      "-movflags", "+faststart",
      proxy,
    ]);
    const at = Math.min(0.5, Math.max(0, durationSec / 2));
    await run("ffmpeg", [
      "-y", "-hide_banner", "-loglevel", "error",
      "-ss", String(at), "-i", proxy,
      "-frames:v", "1", "-vf", `scale=${THUMB_MAX}:-2`,
      thumb,
    ]);
  } catch (error) {
    if (isTimeout(error)) throw error;
    throw new PermanentIngestError("unreadable_media", error instanceof Error ? error.message : String(error));
  }
  return { proxy, thumb };
}
