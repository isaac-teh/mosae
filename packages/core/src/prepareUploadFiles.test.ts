import { afterEach, describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import piexif from "piexifjs";
import * as exifr from "exifr";
import { prepareUploadFiles } from "./prepareUploadFiles";

describe("prepareUploadFiles", () => {
  const originalBitmap = globalThis.createImageBitmap;
  const originalDocument = globalThis.document;
  const originalCreateElement = globalThis.document.createElement;
  const originalTimezone = process.env.TZ;

  afterEach(() => {
    Object.defineProperty(globalThis, "createImageBitmap", { configurable: true, value: originalBitmap });
    Object.defineProperty(globalThis, "document", { configurable: true, value: originalDocument });
    Object.defineProperty(globalThis.document, "createElement", { configurable: true, value: originalCreateElement });
    process.env.TZ = originalTimezone;
    vi.restoreAllMocks();
  });

  it("resizes a large photo to 2560px and keeps EXIF capture date and GPS", async () => {
    const sourceJpeg = await readFile(path.resolve(__dirname, "../../../e2e/fixtures/photo-1.jpg"));
    const originalUrl = `data:image/jpeg;base64,${sourceJpeg.toString("base64")}`;
    const sourceExif: any = { "0th": {}, Exif: {}, GPS: {} };
    sourceExif.Exif[piexif.ExifIFD.DateTimeOriginal] = "2020:04:03 12:34:56";
    sourceExif.GPS[piexif.GPSIFD.GPSLatitudeRef] = "N";
    sourceExif.GPS[piexif.GPSIFD.GPSLatitude] = [[1, 1], [21, 1], [756, 100]];
    sourceExif.GPS[piexif.GPSIFD.GPSLongitudeRef] = "E";
    sourceExif.GPS[piexif.GPSIFD.GPSLongitude] = [[103, 1], [49, 1], [1152, 100]];
    const taggedUrl = piexif.insert(piexif.dump(sourceExif), originalUrl);
    const taggedBytes = Buffer.from(taggedUrl.split(",")[1]!, "base64");
    process.env.TZ = "Pacific/Auckland";
    const parsed = await exifr.parse(new Blob([taggedBytes]), { gps: true, reviveValues: false }) as Record<string, any>;
    expect(parsed.DateTimeOriginal).toBe("2020:04:03 12:34:56");
    expect(parsed.GPSLatitude).toBeTruthy();
    expect(parsed.GPSLongitude).toBeTruthy();
    expect(parsed.latitude).toBeCloseTo(1.3521, 4);
    expect(parsed.longitude).toBeCloseTo(103.819866, 4);

    const outputBlob = new Blob([sourceJpeg], { type: "image/jpeg" });
    let encodedWidth = 0;
    let encodedHeight = 0;
    Object.defineProperty(globalThis, "createImageBitmap", { configurable: true, value: vi.fn(async () => ({ width: 4000, height: 3000, close: vi.fn() })) });
    Object.defineProperty(globalThis.document, "createElement", { configurable: true, value: () => {
      const canvas: any = { width: 0, height: 0, getContext: () => ({ drawImage: vi.fn() }), toBlob: (callback: (blob: Blob) => void) => { encodedWidth = canvas.width; encodedHeight = canvas.height; callback(outputBlob); } };
      return canvas;
    } });

    const source = new File([taggedBytes, new Uint8Array(1_600_000)], "big.jpg", { type: "image/jpeg" });
    const [result] = await prepareUploadFiles([source]);
    expect(encodedWidth).toBe(2560);
    expect(encodedHeight).toBe(1920);
    expect(result).not.toBe(source);
    expect(result.name).toBe("big.jpg");
    expect(result.type).toBe("image/jpeg");
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(result);
    });
    const metadata = piexif.load(dataUrl);
    expect(metadata.Exif?.[piexif.ExifIFD.DateTimeOriginal]).toBe("2020:04:03 12:34:56");
    expect(metadata.GPS?.[piexif.GPSIFD.GPSLatitudeRef]).toBe("N");
    expect(metadata.GPS?.[piexif.GPSIFD.GPSLongitudeRef]).toBe("E");
    const roundTripped = await exifr.parse(result, { gps: true, reviveValues: false }) as Record<string, any>;
    expect(roundTripped.DateTimeOriginal).toBe("2020:04:03 12:34:56");
    expect(roundTripped.latitude).toBeCloseTo(1.3521, 4);
    expect(roundTripped.longitude).toBeCloseTo(103.819866, 4);
  });

  it("keeps small images and videos unchanged", async () => {
    const photo = new File([new Uint8Array(100)], "small.jpg", { type: "image/jpeg" });
    const video = new File([new Uint8Array(1_600_000)], "clip.mp4", { type: "video/mp4" });
    const result = await prepareUploadFiles([photo, video]);
    expect(result[0]).toBe(photo);
    expect(result[1]).toBe(video);
  });

  it("JPEG-compresses a large PNG that is already within the dimension limit", async () => {
    const jpeg = await readFile(path.resolve(__dirname, "../../../e2e/fixtures/photo-1.jpg"));
    let encodedWidth = 0;
    let encodedHeight = 0;
    let encodedType = "";
    let encodedQuality = 0;
    Object.defineProperty(globalThis, "createImageBitmap", { configurable: true, value: vi.fn(async () => ({ width: 2048, height: 1536, close: vi.fn() })) });
    Object.defineProperty(globalThis.document, "createElement", { configurable: true, value: () => {
      const canvas: any = {
        width: 0, height: 0,
        getContext: () => ({ drawImage: vi.fn() }),
        toBlob: (callback: (blob: Blob) => void, type: string, quality: number) => {
          encodedWidth = canvas.width;
          encodedHeight = canvas.height;
          encodedType = type;
          encodedQuality = quality;
          callback(new Blob([jpeg], { type }));
        },
      };
      return canvas;
    } });
    const source = new File([jpeg, new Uint8Array(1_600_000)], "wide.png", { type: "image/png" });

    const [result] = await prepareUploadFiles([source]);

    expect(encodedWidth).toBe(2048);
    expect(encodedHeight).toBe(1536);
    expect(encodedType).toBe("image/jpeg");
    expect(encodedQuality).toBe(0.88);
    expect(result).not.toBe(source);
    expect(result.type).toBe("image/jpeg");
    expect(result.size).toBeLessThan(source.size);
  });

  it("limits simultaneous large-image decodes to the preparation pool size", async () => {
    const jpeg = await readFile(path.resolve(__dirname, "../../../e2e/fixtures/photo-1.jpg"));
    let active = 0;
    let maximum = 0;
    Object.defineProperty(globalThis, "createImageBitmap", { configurable: true, value: vi.fn(async () => {
      active++;
      maximum = Math.max(maximum, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      return { width: 3000, height: 2000, close: () => { active--; } };
    }) });
    Object.defineProperty(globalThis.document, "createElement", { configurable: true, value: () => ({
      width: 0, height: 0, getContext: () => ({ drawImage: vi.fn() }), toBlob: (callback: (blob: Blob) => void) => callback(new Blob([jpeg], { type: "image/jpeg" })),
    }) });
    const files = Array.from({ length: 7 }, (_, index) => new File([jpeg, new Uint8Array(1_500_000)], `large-${index}.jpg`, { type: "image/jpeg" }));
    await prepareUploadFiles(files);
    expect(maximum).toBe(2);
  });
});
