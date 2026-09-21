import { writeFile } from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeProbe, formatLocal, parseIso6709, probeMedia, swapsAxes } from "./probe.js";
import { PermanentIngestError } from "./errors.js";
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

describe("formatLocal", () => {
  it("renders an instant as wall-clock time in the given zone", () => {
    expect(formatLocal(new Date("2026-05-03T09:12:33Z"), "Asia/Tokyo")).toBe("2026-05-03T18:12:33");
  });

  it("crosses midnight into the next local day and never prints hour 24", () => {
    expect(formatLocal(new Date("2026-05-03T15:00:00Z"), "Asia/Tokyo")).toBe("2026-05-04T00:00:00");
  });
});

describe("parseIso6709", () => {
  it("reads latitude and longitude from a QuickTime location string", () => {
    expect(parseIso6709("+35.6895+139.6917/")).toEqual({ lat: 35.6895, lng: 139.6917 });
    expect(parseIso6709("-33.8688+151.2093+020.000/")).toEqual({ lat: -33.8688, lng: 151.2093 });
  });

  it("returns null for missing, malformed or out-of-range values", () => {
    expect(parseIso6709(undefined)).toBeNull();
    expect(parseIso6709("not a location")).toBeNull();
    expect(parseIso6709("+95.0000+139.0000/")).toBeNull();
  });
});

describe("swapsAxes", () => {
  it("swaps for EXIF orientations 5 to 8 and quarter-turn video rotations only", () => {
    expect(swapsAxes({})).toBe(false);
    expect(swapsAxes({ exifOrientation: 1 })).toBe(false);
    expect(swapsAxes({ exifOrientation: 6 })).toBe(true);
    expect(swapsAxes({ exifOrientation: 3 })).toBe(false);
    expect(swapsAxes({ rotationDeg: 90 })).toBe(true);
    expect(swapsAxes({ rotationDeg: 270 })).toBe(true);
    expect(swapsAxes({ rotationDeg: 180 })).toBe(false);
  });
});

describe("probeMedia photo", () => {
  it("reads EXIF capture time and GPS as wall-clock time", async () => {
    const file = await makeJpeg(dir, "tokyo.jpg", { dateTimeOriginal: "2026:05:03 18:12:33", gps: { lat: 35.6895, lng: 139.6917 } });
    const facts = await probeMedia(file, "photo");
    expect(facts).toMatchObject({ kind: "photo", width: 320, height: 240, durationSec: null, localTime: "2026-05-03T18:12:33", timeSource: "exif" });
    expect(facts.gps?.lat).toBeCloseTo(35.6895, 3);
    expect(facts.gps?.lng).toBeCloseTo(139.6917, 3);
  });

  it("reports oriented dimensions for a rotated photo", async () => {
    const file = await makeJpeg(dir, "rotated.jpg", { width: 300, height: 200, orientation: 6 });
    const facts = await probeMedia(file, "photo");
    expect(facts).toMatchObject({ width: 200, height: 300 });
  });

  it("returns no capture time for a photo without EXIF dates", async () => {
    const file = await makeJpeg(dir, "screenshot.jpg");
    expect(await probeMedia(file, "photo")).toMatchObject({ localTime: null, timeSource: "none", gps: null });
  });

  it("rejects an unreadable image as a permanent failure", async () => {
    const file = path.join(dir, "corrupt.jpg");
    await writeFile(file, Buffer.from("this is not an image"));
    await expect(probeMedia(file, "photo")).rejects.toMatchObject({ name: "PermanentIngestError", reason: "unreadable_media" });
  });
});

describe("probeMedia video", () => {
  it("converts the UTC creation time to local time using the GPS location", async () => {
    const file = await makeVideo(dir, "tokyo.mp4", { seconds: 2, creationTime: "2026-05-03T09:12:33Z", location: "+35.6895+139.6917/" });
    const facts = await probeMedia(file, "video");
    expect(facts).toMatchObject({ kind: "video", width: 320, height: 240, localTime: "2026-05-03T18:12:33", timeSource: "video-gps" });
    expect(facts.durationSec).toBeGreaterThan(1.7);
    expect(facts.durationSec).toBeLessThan(2.4);
    expect(facts.gps?.lat).toBeCloseTo(35.6895, 3);
  });

  it("keeps the UTC wall clock when the video carries no location", async () => {
    const file = await makeVideo(dir, "utc.mp4", { creationTime: "2026-05-03T09:12:33Z" });
    expect(await probeMedia(file, "video")).toMatchObject({ localTime: "2026-05-03T09:12:33", timeSource: "video-utc", gps: null });
  });

  it("returns no capture time for a video without metadata", async () => {
    const file = await makeVideo(dir, "plain.mp4");
    expect(await probeMedia(file, "video")).toMatchObject({ localTime: null, timeSource: "none" });
  });

  it("rejects an unreadable video as a permanent failure", async () => {
    const file = path.join(dir, "corrupt.mp4");
    await writeFile(file, Buffer.from("not a video at all"));
    await expect(probeMedia(file, "video")).rejects.toBeInstanceOf(PermanentIngestError);
  });

  it("rejects a video with no positive duration as a permanent failure", async () => {
    const fake = async () => ({
      stdout: JSON.stringify({ format: { duration: "0.000000" }, streams: [{ codec_type: "video", width: 320, height: 240 }] }),
      stderr: "",
    });
    await expect(probeMedia("ignored.mp4", "video", fake)).rejects.toMatchObject({ reason: "unreadable_media" });
  });
});
