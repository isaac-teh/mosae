import { exiftool } from "exiftool-vendored";
import tzlookup from "tz-lookup";
import type { GeoPoint, MediaFacts, MediaKind } from "../domain/media.js";
import { PermanentIngestError } from "./errors.js";
import { defaultRun, isTimeout, type Runner } from "./run.js";

export function formatLocal(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(date);
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
  return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}:${part("second")}`;
}

/** QuickTime stores location as ISO 6709, for example "+35.6895+139.6917+025.000/". */
export function parseIso6709(value: string | undefined): GeoPoint | null {
  const match = value?.trim().match(/^([+-]\d+(?:\.\d+)?)([+-]\d+(?:\.\d+)?)/);
  if (!match) return null;
  const lat = Number(match[1]);
  const lng = Number(match[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}

export function swapsAxes(input: { exifOrientation?: number; rotationDeg?: number }): boolean {
  if (input.exifOrientation !== undefined && input.exifOrientation >= 5 && input.exifOrientation <= 8) return true;
  const turns = Math.abs(input.rotationDeg ?? 0) % 180;
  return turns === 90;
}

const pad = (n: number) => String(n).padStart(2, "0");

function exifWallClock(value: unknown): string | null {
  if (typeof value === "string") {
    const match = value.match(/^(\d{4})[:-](\d{2})[:-](\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
    return match ? `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}` : null;
  }
  const dt = value as { year?: number; month?: number; day?: number; hour?: number; minute?: number; second?: number } | null;
  if (!dt || typeof dt.year !== "number" || typeof dt.month !== "number" || typeof dt.day !== "number") return null;
  const hour = dt.hour ?? 12;
  return `${dt.year}-${pad(dt.month)}-${pad(dt.day)}T${pad(hour)}:${pad(dt.minute ?? 0)}:${pad(dt.second ?? 0)}`;
}

function orientation(value: unknown): number | undefined {
  if (typeof value === "number") return value;
  return {
    "Mirror horizontal and rotate 90 CW": 5,
    "Rotate 90 CW": 6,
    "Mirror horizontal and rotate 270 CW": 7,
    "Rotate 270 CW": 8,
  }[String(value)];
}

async function probePhoto(file: string): Promise<MediaFacts> {
  let tags: Awaited<ReturnType<typeof exiftool.read>>;
  try {
    tags = await exiftool.read(file);
  } catch (error) {
    throw new PermanentIngestError("unreadable_media", error instanceof Error ? error.message : String(error));
  }
  const width = Number(tags.ImageWidth ?? 0);
  const height = Number(tags.ImageHeight ?? 0);
  if (!(width > 0) || !(height > 0)) throw new PermanentIngestError("unreadable_media", "image has no readable dimensions");

  const swapped = swapsAxes({ exifOrientation: orientation(tags.Orientation) });
  const localTime = exifWallClock(tags.DateTimeOriginal ?? tags.CreateDate);
  const lat = typeof tags.GPSLatitude === "number" ? tags.GPSLatitude : null;
  const lng = typeof tags.GPSLongitude === "number" ? tags.GPSLongitude : null;
  return { kind: "photo", width: swapped ? height : width, height: swapped ? width : height, durationSec: null, localTime, timeSource: localTime ? "exif" : "none", gps: lat !== null && lng !== null ? { lat, lng } : null, camera: [tags.Make, tags.Model].filter(Boolean).join(" ") || null };
}

type FfprobeOutput = { format?: { duration?: string; tags?: Record<string, string> }; streams?: { codec_type?: string; width?: number; height?: number; tags?: Record<string, string>; side_data_list?: { rotation?: number }[] }[] };

function tag(tags: Record<string, string> | undefined, name: string): string | undefined {
  if (!tags) return undefined;
  const key = Object.keys(tags).find((k) => k.toLowerCase() === name.toLowerCase());
  return key ? tags[key] : undefined;
}

async function probeVideo(file: string, run: Runner): Promise<MediaFacts> {
  let stdout: string;
  try {
    ({ stdout } = await run("ffprobe", ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", file], { timeoutMs: 60_000 }));
  } catch (error) {
    if (isTimeout(error)) throw error;
    throw new PermanentIngestError("unreadable_media", `ffprobe failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  const info = JSON.parse(stdout) as FfprobeOutput;
  const stream = info.streams?.find((s) => s.codec_type === "video");
  const durationSec = Number(info.format?.duration ?? 0);
  if (!stream?.width || !stream.height) throw new PermanentIngestError("unreadable_media", "no video stream");
  if (!Number.isFinite(durationSec) || durationSec <= 0) throw new PermanentIngestError("unreadable_media", "video has no positive duration");
  const rotation = stream.side_data_list?.find((d) => d.rotation !== undefined)?.rotation ?? Number(tag(stream.tags, "rotate") ?? 0);
  const swapped = swapsAxes({ rotationDeg: rotation });
  const created = tag(info.format?.tags, "creation_time") ?? tag(stream.tags, "creation_time");
  const gps = parseIso6709(tag(info.format?.tags, "com.apple.quicktime.location.ISO6709") ?? tag(info.format?.tags, "location"));
  const instant = created ? new Date(created) : null;
  const validInstant = instant && !Number.isNaN(instant.getTime()) ? instant : null;
  let localTime: string | null = null;
  let timeSource: MediaFacts["timeSource"] = "none";
  if (validInstant) {
    let zone: string | null = null;
    if (gps) try { zone = tzlookup(gps.lat, gps.lng); } catch { zone = null; }
    localTime = formatLocal(validInstant, zone ?? "UTC");
    timeSource = zone ? "video-gps" : "video-utc";
  }
  return { kind: "video", width: swapped ? stream.height : stream.width, height: swapped ? stream.width : stream.height, durationSec, localTime, timeSource, gps, camera: [tag(info.format?.tags, "com.apple.quicktime.make"), tag(info.format?.tags, "com.apple.quicktime.model")].filter(Boolean).join(" ") || null };
}

export async function probeMedia(file: string, kind: MediaKind, run: Runner = defaultRun): Promise<MediaFacts> {
  return kind === "photo" ? probePhoto(file) : probeVideo(file, run);
}

/** exiftool-vendored keeps a helper process alive; end it on shutdown and in tests. */
export async function closeProbe(): Promise<void> {
  await exiftool.end();
}
