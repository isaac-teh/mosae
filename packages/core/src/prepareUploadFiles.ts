import * as exifr from "exifr";
import piexif from "piexifjs";

export const RESIZE_THRESHOLD_BYTES = 1_500_000;
export const MAX_UPLOAD_IMAGE_SIDE = 2048;
export const UPLOAD_JPEG_QUALITY = 0.82;
export const PREPARATION_CONCURRENCY = 3;

function rational(value: number): [number, number] {
  let denominator = 10_000;
  let numerator = Math.round(value * denominator);
  while (denominator > 1 && numerator % 10 === 0) {
    numerator /= 10;
    denominator /= 10;
  }
  return [numerator, denominator];
}

function dms(value: number): [[number, number], [number, number], [number, number]] {
  const absolute = Math.abs(value);
  const degrees = Math.floor(absolute);
  const minutesFloat = (absolute - degrees) * 60;
  const minutes = Math.floor(minutesFloat);
  return [[degrees, 1], [minutes, 1], rational((minutesFloat - minutes) * 60)];
}

function gpsCoordinate(value: unknown, reference: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return /[SW]/i.test(String(reference ?? "")) ? -Math.abs(value) : value;
  if (!Array.isArray(value) || value.length < 3) return null;
  const parts = value.map((part: any) => Array.isArray(part) ? Number(part[0]) / Number(part[1]) : Number(part));
  if (parts.some((part) => !Number.isFinite(part))) return null;
  const coordinate = parts[0] + parts[1] / 60 + parts[2] / 3600;
  return /[SW]/i.test(String(reference ?? "")) ? -coordinate : coordinate;
}

function gpsDms(value: unknown, coordinate: number): [[number, number], [number, number], [number, number]] {
  if (Array.isArray(value) && value.length >= 3) {
    return value.slice(0, 3).map((part: unknown) => {
      if (Array.isArray(part) && part.length >= 2) return [Number(part[0]), Number(part[1])];
      return rational(Number(part));
    }) as [[number, number], [number, number], [number, number]];
  }
  return dms(coordinate);
}

function exifFrom(parsed: Record<string, any> | undefined) {
  if (!parsed) return null;
  const exif: any = { "0th": {}, Exif: {}, GPS: {} };
  const date = parsed.DateTimeOriginal ?? parsed.CreateDate ?? parsed.ModifyDate;
  const rawDate = typeof date === "string" ? date.match(/^\d{4}:\d{2}:\d{2} \d{2}:\d{2}:\d{2}/)?.[0] : null;
  if (rawDate) {
    const formatted = rawDate;
    exif.Exif[piexif.ExifIFD.DateTimeOriginal] = formatted;
    exif.Exif[piexif.ExifIFD.DateTimeDigitized] = formatted;
    exif["0th"][piexif.ImageIFD.DateTime] = formatted;
    if (typeof parsed.OffsetTimeOriginal === "string" && /^[+-]\d{2}:\d{2}$/.test(parsed.OffsetTimeOriginal)) {
      (piexif as any).TAGS.Exif[0x9011] ??= { name: "OffsetTimeOriginal", type: "Ascii" };
      exif.Exif[0x9011] = parsed.OffsetTimeOriginal;
    }
  }
  const latitude = gpsCoordinate(parsed.latitude ?? parsed.GPSLatitude, parsed.GPSLatitudeRef);
  const longitude = gpsCoordinate(parsed.longitude ?? parsed.GPSLongitude, parsed.GPSLongitudeRef);
  if (latitude !== null && longitude !== null) {
    exif.GPS[piexif.GPSIFD.GPSLatitudeRef] = latitude < 0 ? "S" : "N";
    exif.GPS[piexif.GPSIFD.GPSLatitude] = gpsDms(parsed.GPSLatitude, latitude);
    exif.GPS[piexif.GPSIFD.GPSLongitudeRef] = longitude < 0 ? "W" : "E";
    exif.GPS[piexif.GPSIFD.GPSLongitude] = gpsDms(parsed.GPSLongitude, longitude);
    exif.GPS[piexif.GPSIFD.GPSVersionID] = [2, 3, 0, 0];
  }
  return Object.keys(exif.Exif).length || Object.keys(exif.GPS).length ? exif : null;
}

function imageFile(file: File): boolean {
  return /\.(jpe?g|png|heic|heif)$/i.test(file.name) || ["image/jpeg", "image/png", "image/heic", "image/heif"].includes(file.type.toLowerCase());
}

/** Prepare large photos for upload. Any unsupported decoder/canvas/EXIF case safely retains the original. */
export async function prepareUploadFiles(
  files: File[],
  onProgress?: (preparedFiles: number, totalFiles: number) => void,
  onFilePrepared?: (index: number, file: File) => void | Promise<void>,
): Promise<File[]> {
  const prepared = new Array<File>(files.length);
  let next = 0;
  let completed = 0;
  async function worker() {
    while (next < files.length) {
      const index = next++;
      const file = files[index];
      prepared[index] = await prepareOne(file);
      completed++;
      onProgress?.(completed, files.length);
      await onFilePrepared?.(index, prepared[index]!);
    }
  }
  const results = await Promise.allSettled(Array.from({ length: Math.min(PREPARATION_CONCURRENCY, files.length) }, worker));
  const failed = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
  if (failed) throw failed.reason;
  return prepared;
}

async function prepareOne(file: File): Promise<File> {
    if (!imageFile(file) || file.size < RESIZE_THRESHOLD_BYTES || typeof createImageBitmap !== "function") return file;
    let bitmap: ImageBitmap | undefined;
    try {
      const metadata = exifFrom(await exifr.parse(file, { gps: true, reviveValues: false }) as Record<string, any> | undefined);
      bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
      const scale = Math.min(1, MAX_UPLOAD_IMAGE_SIDE / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const context = canvas.getContext("2d");
      if (!context) return file;
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error("jpeg_encode_failed")), "image/jpeg", UPLOAD_JPEG_QUALITY));
      if (blob.size === 0) return file;
      let output = blob;
      if (metadata) {
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onerror = () => reject(reader.error ?? new Error("file_read_failed"));
          reader.onload = () => resolve(String(reader.result));
          reader.readAsDataURL(blob);
        });
        const inserted = piexif.insert(piexif.dump(metadata), dataUrl);
        const [, encoded] = inserted.split(",", 2);
        if (!encoded) return file;
        const binary = atob(encoded);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        output = new Blob([bytes], { type: "image/jpeg" });
      }
      const baseName = file.name.replace(/\.[^.]+$/, "");
      const resized = new File([output], `${baseName}.jpg`, { type: "image/jpeg", lastModified: file.lastModified });
      if (scale === 1 && resized.size >= file.size) return file;
      return resized;
    } catch {
      return file;
    } finally {
      bitmap?.close();
    }
}
