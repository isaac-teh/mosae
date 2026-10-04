import { afterEach, describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import piexif from "piexifjs";
import * as exifr from "exifr";
import { MAX_UPLOAD_IMAGE_SIDE, PREPARATION_CONCURRENCY, RAW_UPLOAD_MAX_FILES, UPLOAD_JPEG_QUALITY, prepareUploadFiles } from "./prepareUploadFiles";

describe("prepareUploadFiles", () => {
  const originalBitmap = globalThis.createImageBitmap;
  const originalWorker = globalThis.Worker;
  const originalOffscreenCanvas = globalThis.OffscreenCanvas;
  const originalCreateObjectURL = URL.createObjectURL;
  const originalRevokeObjectURL = URL.revokeObjectURL;
  const originalDocument = globalThis.document;
  const originalCreateElement = globalThis.document.createElement;
  const originalTimezone = process.env.TZ;

  it("uses the faster shared photo preparation settings", () => {
    expect(MAX_UPLOAD_IMAGE_SIDE).toBe(2048);
    expect(UPLOAD_JPEG_QUALITY).toBe(0.82);
    expect(PREPARATION_CONCURRENCY).toBe(2);
    expect(RAW_UPLOAD_MAX_FILES).toBe(50);
  });

  it("emits each large-batch prepared file immediately as well as aggregate preparation progress", async () => {
    const files = Array.from({ length: 50 }, (_, i) => new File([new Uint8Array(10)], `${i}.jpg`, { type: "image/jpeg" }));
    const preparedFiles: { index: number; file: File }[] = [];
    const counts: number[] = [];
    await prepareUploadFiles(files, (prepared) => counts.push(prepared), (index, file) => { preparedFiles.push({ index, file }); });

    expect(preparedFiles).toHaveLength(50);
    expect(counts).toEqual(Array.from({ length: 50 }, (_, i) => i + 1));
  });

  afterEach(() => {
    Object.defineProperty(globalThis, "createImageBitmap", { configurable: true, value: originalBitmap });
    Object.defineProperty(globalThis, "Worker", { configurable: true, value: originalWorker });
    Object.defineProperty(globalThis, "OffscreenCanvas", { configurable: true, value: originalOffscreenCanvas });
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: originalCreateObjectURL });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: originalRevokeObjectURL });
    Object.defineProperty(globalThis, "document", { configurable: true, value: originalDocument });
    Object.defineProperty(globalThis.document, "createElement", { configurable: true, value: originalCreateElement });
    process.env.TZ = originalTimezone;
    vi.restoreAllMocks();
  });

  it("resizes a large photo to 2048px and keeps EXIF capture date, offset, and GPS", async () => {
    const sourceJpeg = await readFile(path.resolve(__dirname, "../../../e2e/fixtures/photo-1.jpg"));
    const originalUrl = `data:image/jpeg;base64,${sourceJpeg.toString("base64")}`;
    const sourceExif: any = { "0th": {}, Exif: {}, GPS: {} };
    sourceExif.Exif[piexif.ExifIFD.DateTimeOriginal] = "2020:04:03 12:34:56";
    (piexif as any).TAGS.Exif[0x9011] = { name: "OffsetTimeOriginal", type: "Ascii" };
    sourceExif.Exif[0x9011] = "+08:00";
    sourceExif.GPS[piexif.GPSIFD.GPSLatitudeRef] = "N";
    sourceExif.GPS[piexif.GPSIFD.GPSLatitude] = [[1, 1], [21, 1], [756, 100]];
    sourceExif.GPS[piexif.GPSIFD.GPSLongitudeRef] = "E";
    sourceExif.GPS[piexif.GPSIFD.GPSLongitude] = [[103, 1], [49, 1], [1152, 100]];
    const taggedUrl = piexif.insert(piexif.dump(sourceExif), originalUrl);
    const taggedBytes = Buffer.from(taggedUrl.split(",")[1]!, "base64");
    process.env.TZ = "Pacific/Auckland";
    const parsed = await exifr.parse(new Blob([taggedBytes]), { gps: true, reviveValues: false }) as Record<string, any>;
    expect(parsed.OffsetTimeOriginal).toBe("+08:00");
    expect(parsed.DateTimeOriginal).toBe("2020:04:03 12:34:56");
    expect(parsed.GPSLatitude).toBeTruthy();
    expect(parsed.GPSLongitude).toBeTruthy();
    expect(parsed.latitude).toBeCloseTo(1.3521, 4);
    expect(parsed.longitude).toBeCloseTo(103.819866, 4);

    const outputBlob = new Blob([sourceJpeg], { type: "image/jpeg" });
    let encodedWidth = 0;
    let encodedHeight = 0;
    Object.defineProperty(globalThis, "OffscreenCanvas", { configurable: true, value: class {} });
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: () => "blob:resize-worker" });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
    Object.defineProperty(globalThis, "Worker", { configurable: true, value: class {
      onmessage: ((event: MessageEvent<{ blob: Blob }>) => void) | null = null;
      postMessage(options: { width: number; height: number }) { encodedWidth = options.width; encodedHeight = options.height; this.onmessage?.({ data: { blob: outputBlob } } as MessageEvent<{ blob: Blob }>); }
      terminate() {}
    } });
    Object.defineProperty(globalThis, "createImageBitmap", { configurable: true, value: vi.fn(async () => ({ width: 4000, height: 3000, close: vi.fn() })) });
    Object.defineProperty(globalThis.document, "createElement", { configurable: true, value: () => {
      const canvas: any = { width: 0, height: 0, getContext: () => ({ drawImage: vi.fn() }), toBlob: (callback: (blob: Blob) => void) => { encodedWidth = canvas.width; encodedHeight = canvas.height; callback(outputBlob); } };
      return canvas;
    } });

    const source = new File([taggedBytes, new Uint8Array(1_600_000)], "big.jpg", { type: "image/jpeg" });
    const [result] = await prepareUploadFiles([source, ...Array.from({ length: 49 }, (_, i) => new File(["x"], `small-${i}.jpg`, { type: "image/jpeg" }))]);
    expect(encodedWidth).toBe(2048);
    expect(encodedHeight).toBe(1536);
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
    expect(metadata.Exif?.[0x9011]).toBe("+08:00");
    expect(metadata.GPS?.[piexif.GPSIFD.GPSLatitudeRef]).toBe("N");
    expect(metadata.GPS?.[piexif.GPSIFD.GPSLongitudeRef]).toBe("E");
    expect(metadata.GPS?.[piexif.GPSIFD.GPSLatitude]).toEqual(sourceExif.GPS[piexif.GPSIFD.GPSLatitude]);
    expect(metadata.GPS?.[piexif.GPSIFD.GPSLongitude]).toEqual(sourceExif.GPS[piexif.GPSIFD.GPSLongitude]);
    const roundTripped = await exifr.parse(result, { gps: true, reviveValues: false }) as Record<string, any>;
    expect(roundTripped.DateTimeOriginal).toBe("2020:04:03 12:34:56");
    expect(roundTripped.OffsetTimeOriginal).toBe("+08:00");
    expect(roundTripped.latitude).toBeCloseTo(1.3521, 4);
    expect(roundTripped.longitude).toBeCloseTo(103.819866, 4);
  });

  it("passes all accepted files through byte-identically below the raw upload threshold", async () => {
    const files = Array.from({ length: 49 }, (_, i) => new File([new Uint8Array([i, 2, 3])], `f${i}.jpg`, { type: "image/jpeg" }));
    const progress = vi.fn();
    const result = await prepareUploadFiles(files, progress);
    expect(result).toEqual(files);
    expect(result[0]).toBe(files[0]);
    expect(progress).not.toHaveBeenCalled();
  });

  it("falls back to the raw file when both shrink decoders fail", async () => {
    const source = new File([new Uint8Array(1_600_000)], "large.jpg", { type: "image/jpeg" });
    Object.defineProperty(globalThis, "createImageBitmap", { configurable: true, value: vi.fn(async () => { throw new Error("decode_unsupported"); }) });
    const files = [source, ...Array.from({ length: 49 }, (_, i) => new File(["x"], `small-${i}.jpg`, { type: "image/jpeg" }))];
    const result = await prepareUploadFiles(files);
    expect(result[0]).toBe(source);
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

    const [result] = await prepareUploadFiles([source, ...Array.from({ length: 49 }, (_, i) => new File(["x"], `small-${i}.jpg`, { type: "image/jpeg" }))]);

    expect(encodedWidth).toBe(2048);
    expect(encodedHeight).toBe(1536);
    expect(encodedType).toBe("image/jpeg");
    expect(encodedQuality).toBe(0.82);
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
    await prepareUploadFiles([...files, ...Array.from({ length: 43 }, (_, i) => new File(["x"], `small-${i}.jpg`, { type: "image/jpeg" }))]);
    expect(maximum).toBe(2);
  });
});
