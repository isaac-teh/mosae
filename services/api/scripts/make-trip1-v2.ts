// Builds trip1-v2 from copies of trip1 and two sample photos. The originals are
// left untouched; generated images live in the gitignored samples directory.
import { copyFile, mkdir, readFile, readdir, unlink, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import { join, resolve } from "node:path";
import { exiftool } from "exiftool-vendored";
import sharp from "sharp";

const SCRIPT_DIR = fileURLToPath(new URL(".", import.meta.url));
const API_DIR = resolve(SCRIPT_DIR, "..");
const SAMPLES_DIR = resolve(process.env.SAMPLES_DIR ?? "/Users/isaacteh/Projects/Triiz/mosae/poc/gemini/samples");
const OUT = join(SAMPLES_DIR, "trip1-v2");
const SRC_LABELS = join(API_DIR, "fixtures/cast/trip1.json");
const OUT_LABELS = join(API_DIR, "fixtures/cast/trip1-v2.json");

const PLACES = {
  beach: { lat: 1.2494, lng: 103.8303 },
  zoo: { lat: 1.4043, lng: 103.793 },
  hotel: { lat: 1.2566, lng: 103.821 },
  home: { lat: 1.2755, lng: 103.8073 },
} as const;

type Place = keyof typeof PLACES | null;
type Capture = { file: string; out: string; at: string; place: Place };

// The order below is intentionally shuffled relative to capture time. The
// 23:30/00:30 pair crosses midnight and therefore belongs to separate days.
export const PLAN: Capture[] = [
  { file: "trip1/pexels-vo-van-ti-n-2037497312-34133873.jpg", out: "d1-01.jpg", at: "2026:06:01 16:00:00", place: "beach" },
  { file: "trip1/pexels-vo-van-ti-n-2037497312-34133876.jpg", out: "d1-02.jpg", at: "2026:06:02 10:00:00", place: "zoo" },
  { file: "trip1/pexels-vo-van-ti-n-2037497312-34133877.jpg", out: "d1-03.jpg", at: "2026:06:03 15:00:00", place: "hotel" },
  { file: "trip1/pexels-vo-van-ti-n-2037497312-34133878.jpg", out: "d1-04.jpg", at: "2026:06:01 23:30:00", place: null },
  { file: "trip1/pexels-vo-van-ti-n-2037497312-34133880.jpg", out: "d1-05.jpg", at: "2026:06:02 00:30:00", place: null },
  { file: "trip1/pexels-vo-van-ti-n-2037497312-34133884.jpg", out: "d1-06.jpg", at: "2026:06:03 09:00:00", place: "beach" },
  { file: "trip1/pexels-vo-van-ti-n-2037497312-34133885.jpg", out: "d1-07.jpg", at: "2026:06:02 19:00:00", place: "zoo" },
  { file: "trip1/pexels-vo-van-ti-n-2037497312-34133887.jpg", out: "d1-08.jpg", at: "2026:06:01 08:00:00", place: "home" },
  { file: "trip1/pexels-vo-van-ti-n-2037497312-34133888.jpg", out: "d1-09.jpg", at: "2026:06:03 20:00:00", place: "hotel" },
  { file: "trip1/pexels-vo-van-ti-n-2037497312-34133920.jpg", out: "d1-10.jpg", at: "2026:06:02 13:00:00", place: "beach" },
  { file: "trip1/pexels-vo-van-ti-n-2037497312-34133922.jpg", out: "d1-11.jpg", at: "2026:06:01 11:00:00", place: null },
  { file: "trip1/pexels-vo-van-ti-n-2037497312-34133923.jpg", out: "d1-12.jpg", at: "2026:06:03 13:00:00", place: null },
  // Add a deterministic synthetic stranger to the family beach photo.
  { file: "trip1/pexels-vo-van-ti-n-2037497312-34133884.jpg", out: "x-photobomb.jpg", at: "2026:06:02 08:00:00", place: null },
  { file: "trip/d07-kyoto-photo-5472374.jpg", out: "x-distant.jpg", at: "2026:06:03 18:00:00", place: null },
  // Closest available stranger-subject case: foreground birthday child, with
  // other partygoers as incidental background faces.
  { file: "trip/d10-osaka-photo-30218071.jpg", out: "x-stranger.jpg", at: "2026:06:01 20:00:00", place: null },
];

const EXTRA_FACES: Record<string, { bbox: [number, number, number, number]; personId?: string; expect: "subject" | "background" }[]> = {
  // Face pixels in the rendered crop: source (520,320)-(665,450), crop
  // (475,280,350,430), resized to 300px wide at (1550,25) on 1920x1280.
  "x-photobomb.jpg": [
    { bbox: [0.82738, 0.04632, 0.89211, 0.13337], expect: "background" },
  ],
  // One far-bank face in a landscape frame; bbox is under 2% of image width.
  "x-distant.jpg": [
    { bbox: [0.215, 0.356, 0.226, 0.375], expect: "background" },
  ],
  "x-stranger.jpg": [
    { bbox: [0.136, 0.273, 0.36, 0.441], expect: "subject" },
    { bbox: [0, 0.405, 0.115, 0.535], expect: "background" },
    { bbox: [0.025, 0.53, 0.17, 0.618], expect: "background" },
    { bbox: [0.137, 0.748, 0.255, 0.82], expect: "background" },
    { bbox: [0.15, 0.91, 0.268, 1], expect: "background" },
  ],
};

const DEMOTED_SOURCE_FACES: Record<string, string[]> = {
  // Wide environmental beach walk: dad is the smallest, least prominent face.
  "trip1/pexels-vo-van-ti-n-2037497312-34133887.jpg": ["p-dad"],
};

function sha(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function main() {
  await mkdir(OUT, { recursive: true });
  for (const file of await readdir(OUT)) {
    if (file.endsWith(".jpg")) await unlink(join(OUT, file));
  }

  const labels = JSON.parse(await readFile(SRC_LABELS, "utf8")) as {
    people: Record<string, object>;
    photos: Record<string, { bbox: [number, number, number, number]; personId: string }[]>;
  };
  const next: {
    people: Record<string, object>;
    photos: Record<string, { bbox: [number, number, number, number]; personId?: string; expect: "subject" | "background" }[]>;
  } = { people: labels.people, photos: {} };

  try {
    for (const item of PLAN) {
      const src = join(SAMPLES_DIR, item.file);
      const dst = join(OUT, item.out);
      const before = sha(await readFile(src));
      if (item.out === "x-photobomb.jpg") {
        const stranger = join(SAMPLES_DIR, "trip/d07-kyoto-photo-27467505.jpg");
        const cutout = await sharp(stranger)
          .extract({ left: 475, top: 280, width: 350, height: 430 })
          .resize({ width: 300 })
          .jpeg({ quality: 92 })
          .toBuffer();
        await sharp(src)
          .composite([{ input: cutout, left: 1550, top: 25 }])
          .jpeg({ quality: 92 })
          .toFile(dst);
      } else {
        await copyFile(src, dst);
      }
      const gps = item.place ? PLACES[item.place] : null;
      await exiftool.write(dst, {
        DateTimeOriginal: item.at,
        OffsetTimeOriginal: "+08:00",
        GPSLatitude: gps?.lat ?? null,
        GPSLatitudeRef: gps ? "N" : null,
        GPSLongitude: gps?.lng ?? null,
        GPSLongitudeRef: gps ? "E" : null,
      }, { writeArgs: ["-overwrite_original"] });

      const after = sha(await readFile(dst));
      const sourceFaces = labels.photos[before];
      if (sourceFaces) {
        const demoted = DEMOTED_SOURCE_FACES[item.file] ?? [];
        next.photos[after] = sourceFaces.map((face) => ({
          ...face,
          expect: demoted.includes(face.personId) ? "background" : "subject",
        }));
      } else if (!item.out.startsWith("x-")) {
        throw new Error(`No source labels for ${item.file}`);
      }
      if (EXTRA_FACES[item.out]) {
        next.photos[after] = [...(next.photos[after] ?? []), ...EXTRA_FACES[item.out]];
      }
    }
    await writeFile(OUT_LABELS, `${JSON.stringify(next, null, 1)}\n`);
  } finally {
    await exiftool.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main();
}
