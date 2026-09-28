/**
 * Draft cast labels for a project's photos.
 *
 * Reads every photo shot in `projects/<projectId>/shots`, maps each shot's
 * asset to the SHA-256 of its original bytes, and writes a LabelFile whose
 * `photos` map is keyed by that hash with one entry per non-background face
 * (personId left as "?" for the human to fill in). Prints one line per face so
 * the partner can read off appearance text while labelling.
 *
 * Runs against the Firestore + Storage emulators: set FIRESTORE_EMULATOR_HOST
 * and FIREBASE_STORAGE_EMULATOR_HOST, then:
 *
 *   npx tsx scripts/draftCastLabels.ts <projectId> [outFile]
 *
 * No Gemini calls are made — this only hashes bytes and reads stored faces.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import type { Firestore } from "firebase-admin/firestore";

type Bucket = ReturnType<ReturnType<typeof getStorage>["bucket"]>;
import { projectPhotoHashes, firestorePhotoHashDeps } from "../src/cast/photoHash.js";
import type { LabelFile } from "../src/cast/labelledIdentity.js";

type Face = {
  bbox: [number, number, number, number];
  prominence?: "primary" | "secondary" | "background";
  ageBand?: string;
  appearance?: string;
};

type ShotData = {
  assetId: string;
  analysis?: { kind: string; faces?: Face[] } | null;
};

function fail(message: string): never {
  console.error(`draftCastLabels: ${message}`);
  process.exit(1);
}

async function main(): Promise<void> {
  const [, , projectId, outFileArg] = process.argv;

  if (!projectId) {
    fail("usage: npx tsx scripts/draftCastLabels.ts <projectId> [outFile]");
  }

  // Emulator-only bootstrap, mirroring services/api/src/firebase/admin.ts.
  const emulatorHost = process.env.FIREBASE_STORAGE_EMULATOR_HOST;
  if (!process.env.FIRESTORE_EMULATOR_HOST || !emulatorHost) {
    fail("set FIRESTORE_EMULATOR_HOST and FIREBASE_STORAGE_EMULATOR_HOST before running");
  }

  initializeApp({ projectId: "demo-mosae" });
  const db = getFirestore();
  // The admin app has no default bucket; name it, as the API does.
  const bucket: Bucket = getStorage().bucket(process.env.FIREBASE_STORAGE_BUCKET ?? "demo-mosae.appspot.com");

  // Hash every photo asset once, then map assetId -> hash.
  const deps = firestorePhotoHashDeps(db, bucket);
  const hashes = await projectPhotoHashes(deps, projectId);
  const storageByAsset = new Map<string, string>();
  for (const asset of await deps.listAssets(projectId)) {
    if (asset.storagePath) storageByAsset.set(asset.id, asset.storagePath);
  }

  // Read every shot in the project.
  const shotsSnap = await db.collection("projects").doc(projectId).collection("shots").get();
  const shots = shotsSnap.docs.map((doc) => doc.data() as ShotData);

  const photos: LabelFile["photos"] = {};
  let faceCount = 0;

  for (const shot of shots) {
    const analysis = shot.analysis;
    if (!analysis || analysis.kind !== "photo" || !Array.isArray(analysis.faces)) continue;

    const hash = hashes.get(shot.assetId);
    if (!hash) {
      console.warn(`draftCastLabels: no hash for asset ${shot.assetId}, skipping shot`);
      continue;
    }

    const storagePath = storageByAsset.get(shot.assetId) ?? shot.assetId;
    const base = path.basename(storagePath);

    for (let i = 0; i < analysis.faces.length; i++) {
      const face = analysis.faces[i];
      if (face.prominence === "background") continue;

      (photos[hash] ??= []).push({ bbox: face.bbox, personId: "?" });

      const ageBand = face.ageBand ?? "";
      const appearance = face.appearance ?? "";
      console.log(
        `${base}\tface ${i}\tbbox=[${face.bbox.join(", ")}]\tageBand=${ageBand || "-"}\tappearance="${appearance}"`,
      );
      faceCount++;
    }
  }

  const labelFile: LabelFile = { people: {}, photos };

  const outFile = outFileArg ?? path.join("fixtures", "cast", `draft-${projectId}.json`);
  mkdirSync(path.dirname(outFile), { recursive: true });
  writeFileSync(outFile, `${JSON.stringify(labelFile, null, 2)}\n`);

  console.log(
    `\ndraftCastLabels: ${shots.length} shots, ${faceCount} non-background faces across ` +
      `${Object.keys(photos).length} photos -> ${outFile}`,
  );
}

main().catch((error) => {
  fail(error instanceof Error ? error.message : String(error));
});
