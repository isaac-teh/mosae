import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { initializeApp } from "firebase-admin/app";
import { getStorage } from "firebase-admin/storage";

type SeedObject = { source: string; destination: string; contentType: string };

export function requireStorageEmulator(): string {
  const host = process.env.FIREBASE_STORAGE_EMULATOR_HOST?.trim();
  if (!host) {
    throw new Error("FIREBASE_STORAGE_EMULATOR_HOST must be set; refusing to seed real storage");
  }
  return host;
}

async function filesWithExtension(directory: string, extension: ".jpg" | ".mp3"): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(extension))
    .map((entry) => path.join(directory, entry.name))
    .sort();
}

async function collectObjects(apiRoot: string): Promise<SeedObject[]> {
  const demoPhotos = path.join(apiRoot, "fixtures/demo/trip1-v2/photos");
  const objects: SeedObject[] = [];

  for (const source of await filesWithExtension(path.join(apiRoot, "fixtures/music"), ".mp3")) {
    objects.push({ source, destination: `library/music/${path.basename(source)}`, contentType: "audio/mpeg" });
  }
  for (const source of await filesWithExtension(demoPhotos, ".jpg")) {
    objects.push({ source, destination: `library/demo/trip1-v2/${path.basename(source)}`, contentType: "image/jpeg" });
  }
  for (const variant of ["render", "thumb"] as const) {
    for (const source of await filesWithExtension(path.join(demoPhotos, "variants", variant), ".jpg")) {
      objects.push({
        source,
        destination: `library/demo/trip1-v2/variants/${variant}/${path.basename(source)}`,
        contentType: "image/jpeg",
      });
    }
  }
  return objects;
}

export async function seedDemoLocal(): Promise<{ uploaded: number; skipped: number; total: number }> {
  const emulatorHost = requireStorageEmulator();
  // Firebase Admin maps FIREBASE_STORAGE_EMULATOR_HOST to STORAGE_EMULATOR_HOST
  // only when the latter is unset. Force it here so an inherited override can
  // never route this command to a real GCS endpoint.
  process.env.STORAGE_EMULATOR_HOST = `http://${emulatorHost}`;

  const bucketName = process.env.FIREBASE_STORAGE_BUCKET ?? "demo-mosae.appspot.com";
  const app = initializeApp({
    projectId: process.env.FIREBASE_PROJECT_ID ?? "demo-mosae",
    storageBucket: bucketName,
  });
  const bucket = getStorage(app).bucket(bucketName);
  const apiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const objects = await collectObjects(apiRoot);
  let uploaded = 0;
  let skipped = 0;

  for (const object of objects) {
    const file = bucket.file(object.destination);
    const [exists] = await file.exists();
    if (exists) {
      const [metadata] = await file.getMetadata();
      if (Number(metadata.size) === (await stat(object.source)).size) {
        skipped++;
        continue;
      }
    }
    await bucket.upload(object.source, {
      destination: object.destination,
      metadata: { contentType: object.contentType },
    });
    uploaded++;
  }

  return { uploaded, skipped, total: objects.length };
}

async function main(): Promise<void> {
  const bucketName = process.env.FIREBASE_STORAGE_BUCKET ?? "demo-mosae.appspot.com";
  const result = await seedDemoLocal();
  console.log(
    `seed:demo-local uploaded ${result.uploaded}, skipped ${result.skipped} (same size), total ${result.total} objects in gs://${bucketName}`,
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    console.error(`seed:demo-local: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
