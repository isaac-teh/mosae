import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Uses the same librosa.beat.beat_track analysis as poc/lyria/analyze.py.
// Install poc/lyria/requirements.txt in the active Python environment first.
const root = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const fixture = join(root, "services/api/fixtures/music");
const arg = (name: string, fallback: string) => {
  const index = process.argv.indexOf(name);
  return index < 0 ? fallback : process.argv[index + 1] ?? fallback;
};
const source = resolve(arg("--source", process.env.PIXABAY_MUSIC_DIR ?? "/Users/isaacteh/mosae-music-import"));
const bucket = arg("--bucket", "");
const python = process.env.PYTHON ?? "python3";
const manifest = JSON.parse(readFileSync(join(fixture, "pixabay-manifest.json"), "utf8")) as Record<string, { mood: string; name: string; description: string; sourceId: string; artist: string }>;
const output = join(source, ".mosae-normalized");
mkdirSync(output, { recursive: true });
const tracks: Record<string, unknown>[] = [];
for (const [filename, meta] of Object.entries(manifest)) {
  const input = join(source, filename);
  if (!existsSync(input)) throw new Error(`Missing source track: ${input}`);
  const duration = Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", input], { encoding: "utf8" }).trim());
  const outputFile = join(output, `pixabay-${meta.sourceId}.mp3`);
  const ffmpegArgs = ["-y", "-v", "error", "-i", input, "-vn", "-ar", "44100", "-b:a", "192k"];
  if (duration > 180) ffmpegArgs.push("-t", "180", "-af", "afade=t=out:st=177:d=3");
  ffmpegArgs.push(outputFile);
  execFileSync("ffmpeg", ffmpegArgs);
  const result = JSON.parse(execFileSync(python, ["-c", "import json,librosa,numpy as np,sys; y,sr=librosa.load(sys.argv[1],sr=None,mono=True); tempo,frames=librosa.beat.beat_track(y=y,sr=sr,units='frames'); times=librosa.frames_to_time(frames,sr=sr); print(json.dumps({'durationSec':round(len(y)/sr,3),'bpm':round(float(np.asarray(tempo).reshape(-1)[0]),2),'beatsSec':[round(float(t),3) for t in times]}))", outputFile], { encoding: "utf8" }));
  const file = `pixabay-${meta.sourceId}.mp3`;
  tracks.push({ id: `pixabay-${meta.sourceId}`, name: meta.name, description: meta.description, cadence: meta.mood, file, ...result, source: "Pixabay", sourceId: meta.sourceId, artist: meta.artist, licence: "Pixabay Content License", sourceUrl: `https://pixabay.com/music/search/${meta.sourceId}/` });
  if (bucket) execFileSync("gcloud", ["storage", "cp", outputFile, `gs://${bucket}/library/music/${file}`]);
  else console.log(`DRY RUN: would upload ${outputFile} to gs://<bucket>/library/music/${file}`);
}
const libraryFile = join(fixture, "library.json");
const library = JSON.parse(readFileSync(libraryFile, "utf8")) as { note: string; tracks: Record<string, unknown>[] };
library.tracks = [...library.tracks.filter((track) => !String(track.id).startsWith("pixabay-")), ...tracks];
writeFileSync(libraryFile, `${JSON.stringify(library, null, 2)}\n`);
console.log(`Updated soundtrack metadata for ${tracks.length} tracks; normalized MP3s remain outside the repository.`);
