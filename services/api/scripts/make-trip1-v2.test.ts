import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { exiftool } from "exiftool-vendored";

const SAMPLES_DIR = resolve(process.env.SAMPLES_DIR ?? "/Users/isaacteh/Projects/Triiz/mosae/poc/gemini/samples");
const DIR = join(SAMPLES_DIR, "trip1-v2");
const LABELS = new URL("../fixtures/cast/trip1-v2.json", import.meta.url);

describe.skipIf(!existsSync(DIR))("trip1-v2 test set", () => {
  it("has dates on every photo over 3 days, GPS on 8, and labels keyed by new bytes", async () => {
    try {
      const files = (await readdir(DIR)).filter((f) => f.endsWith(".jpg")).sort();
      expect(files).toHaveLength(15);
      const labels = JSON.parse(await readFile(LABELS, "utf8")) as {
        photos: Record<string, { bbox: number[]; personId?: string; expect?: string }[]>;
      };
      const days = new Set<string>();
      let withGps = 0;
      for (const file of files) {
        const path = join(DIR, file);
        const tags = await exiftool.read(path);
        const taken = String(tags.DateTimeOriginal);
        days.add(taken.slice(0, 10).replaceAll(":", "-"));
        if (tags.GPSLatitude != null) withGps++;
        const hash = createHash("sha256").update(await readFile(path)).digest("hex");
        const faces = labels.photos[hash];
        expect(faces, `${file} label hash`).toBeDefined();
        expect(faces!.every((face) => face.expect === "subject" || face.expect === "background"), `${file} face expectations`).toBe(true);
        if (file.startsWith("x-")) {
          for (const face of faces!) {
            expect(face.bbox).toHaveLength(4);
            expect(face.bbox.every((v) => Number.isFinite(v) && v >= 0 && v <= 1)).toBe(true);
          }
        }
      }
      expect(days).toEqual(new Set(["2026-06-01", "2026-06-02", "2026-06-03"]));
      expect(withGps).toBe(8);
      const hashFor = async (file: string) => createHash("sha256").update(await readFile(join(DIR, file))).digest("hex");
      const photobomb = labels.photos[await hashFor("x-photobomb.jpg")];
      expect(photobomb).toHaveLength(4);
      expect(photobomb!.filter((face) => face.personId && face.expect === "subject")).toHaveLength(3);
      const pastedFace = photobomb!.find((face) => !face.personId && face.expect === "background");
      expect(pastedFace).toBeDefined();
      expect(pastedFace!.bbox[2] - pastedFace!.bbox[0]).toBeGreaterThan(0.05);
      expect(pastedFace!.bbox[2] - pastedFace!.bbox[0]).toBeLessThan(0.08);
      const distant = labels.photos[await hashFor("x-distant.jpg")];
      expect(distant).toHaveLength(1);
      expect(distant![0]).toMatchObject({ expect: "background" });
      expect(distant![0].personId).toBeUndefined();
      expect(distant![0].bbox[2] - distant![0].bbox[0]).toBeLessThan(0.02);
    } finally {
      await exiftool.end();
    }
  });
});
