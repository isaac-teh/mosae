import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { exiftool } from "exiftool-vendored";
import sharp from "sharp";

const exec = promisify(execFile);

export async function tempDir(): Promise<{ dir: string; cleanup: () => Promise<void> }> {
  const dir = await mkdtemp(path.join(tmpdir(), "mosae-test-"));
  return { dir, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

export type JpegOptions = {
  width?: number;
  height?: number;
  /** "noise" is sharp and detailed; "flat" is a single colour. */
  kind?: "noise" | "flat";
  color?: string;
  /** EXIF orientation 1 to 8. */
  orientation?: number;
  /** EXIF format, for example "2026:05:03 18:12:33". */
  dateTimeOriginal?: string;
  gps?: { lat: number; lng: number };
};

export async function makeJpeg(dir: string, name: string, opts: JpegOptions = {}): Promise<string> {
  const { width = 320, height = 240 } = opts;
  const file = path.join(dir, name);
  const canvas = opts.kind === "flat"
    ? sharp({ create: { width, height, channels: 3, background: opts.color ?? "#808080" } })
    : sharp({ create: { width, height, channels: 3, background: "#808080", noise: { type: "gaussian", mean: 128, sigma: 60 } } });
  await canvas.jpeg({ quality: 90 }).withMetadata(opts.orientation ? { orientation: opts.orientation } : {}).toFile(file);
  if (opts.dateTimeOriginal || opts.gps) {
    const tags: Record<string, unknown> = {};
    if (opts.dateTimeOriginal) tags.DateTimeOriginal = opts.dateTimeOriginal;
    if (opts.gps) {
      tags.GPSLatitude = Math.abs(opts.gps.lat);
      tags.GPSLatitudeRef = opts.gps.lat >= 0 ? "N" : "S";
      tags.GPSLongitude = Math.abs(opts.gps.lng);
      tags.GPSLongitudeRef = opts.gps.lng >= 0 ? "E" : "W";
    }
    // If this exiftool-vendored release types write() differently, adjust this
    // helper only; the assertions in the tests depend on the resulting tags.
    await exiftool.write(file, tags as never, { writeArgs: ["-overwrite_original"] });
  }
  return file;
}

export type VideoOptions = {
  seconds?: number;
  size?: string;
  /** ISO 8601 UTC, for example "2026-05-03T09:12:33Z". */
  creationTime?: string;
  /** ISO 6709, for example "+35.6895+139.6917/". */
  location?: string;
};

export async function makeVideo(dir: string, name: string, opts: VideoOptions = {}): Promise<string> {
  const { seconds = 2, size = "320x240" } = opts;
  const file = path.join(dir, name);
  const args = ["-y", "-loglevel", "error", "-f", "lavfi", "-i", `testsrc=duration=${seconds}:size=${size}:rate=15`, "-f", "lavfi", "-i", `sine=frequency=440:duration=${seconds}`, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest"];
  if (opts.creationTime) args.push("-metadata", `creation_time=${opts.creationTime}`);
  if (opts.location) args.push("-metadata", `location=${opts.location}`);
  args.push(file);
  await exec("ffmpeg", args);
  return file;
}

/** One solid colour per segment, so each colour change is a real scene cut. */
export async function makeSceneVideo(dir: string, name: string, colors: string[], secondsEach = 2): Promise<string> {
  const file = path.join(dir, name);
  const inputs = colors.flatMap((c) => ["-f", "lavfi", "-i", `color=c=${c}:s=320x240:d=${secondsEach}:r=15`]);
  const graph = `${colors.map((_, i) => `[${i}:v]`).join("")}concat=n=${colors.length}:v=1:a=0[v]`;
  await exec("ffmpeg", ["-y", "-loglevel", "error", ...inputs, "-filter_complex", graph, "-map", "[v]", "-c:v", "libx264", "-pix_fmt", "yuv420p", file]);
  return file;
}
