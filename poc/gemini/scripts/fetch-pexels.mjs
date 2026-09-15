// Downloads the "Japan trip" and creator B-roll sample sets from Pexels.
// Usage: node --env-file=../../.env scripts/fetch-pexels.mjs   (run from poc/gemini)
import fs from "node:fs";
import path from "node:path";

const KEY = process.env.PEXELS_API_KEY;
if (!KEY) throw new Error("PEXELS_API_KEY missing");

const ROOT = path.resolve("samples");

// [set, day, place, query, photos, videos]
const PLAN = [
  ["trip", 1, "tokyo", "tokyo street night", 4, 1],
  ["trip", 1, "tokyo", "shibuya crossing", 2, 1],
  ["trip", 2, "tokyo", "japanese ramen", 4, 1],
  ["trip", 3, "tokyo", "family travel japan", 5, 1],
  ["trip", 4, "tokyo", "tokyo train", 3, 1],
  ["trip", 5, "kyoto", "kyoto temple", 4, 1],
  ["trip", 6, "kyoto", "fushimi inari", 3, 1],
  ["trip", 7, "kyoto", "kimono women kyoto", 3, 0],
  ["trip", 8, "osaka", "osaka dotonbori", 3, 1],
  ["trip", 9, "osaka", "japanese street food", 4, 1],
  ["trip", 10, "osaka", "child birthday cake", 3, 1],
  ["creator", 0, "", "coffee shop b-roll", 0, 3],
  ["creator", 0, "", "laptop working desk", 0, 2],
  ["creator", 0, "", "city walking vlog", 0, 2],
];

async function api(url) {
  const res = await fetch(url, { headers: { Authorization: KEY } });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

async function download(url, dest) {
  if (fs.existsSync(dest)) return;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
}

// Prefer a ~720p rendition to keep token and download size down.
function pickVideoFile(files) {
  const mp4 = files.filter((f) => f.file_type === "video/mp4" && f.width && f.height);
  mp4.sort((a, b) => Math.abs(Math.min(a.width, a.height) - 720) - Math.abs(Math.min(b.width, b.height) - 720));
  return mp4[0];
}

const manifest = [];
const seen = new Set();

for (const [set, day, place, query, photoCount, videoCount] of PLAN) {
  const dir = path.join(ROOT, set);
  if (photoCount) {
    const { photos } = await api(`https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=${photoCount + 5}`);
    for (const p of photos.filter((p) => !seen.has(`p${p.id}`)).slice(0, photoCount)) {
      seen.add(`p${p.id}`);
      const file = `${set === "trip" ? `d${String(day).padStart(2, "0")}-${place}-` : ""}photo-${p.id}.jpg`;
      await download(p.src.large2x, path.join(dir, file));
      manifest.push({ set, day, place, query, kind: "photo", file, source: p.url, author: p.photographer });
    }
  }
  if (videoCount) {
    const { videos } = await api(`https://api.pexels.com/videos/search?query=${encodeURIComponent(query)}&per_page=${videoCount + 5}&max_duration=40`);
    for (const v of videos.filter((v) => !seen.has(`v${v.id}`)).slice(0, videoCount)) {
      seen.add(`v${v.id}`);
      const pick = pickVideoFile(v.video_files);
      if (!pick) continue;
      const file = `${set === "trip" ? `d${String(day).padStart(2, "0")}-${place}-` : ""}video-${v.id}.mp4`;
      await download(pick.link, path.join(dir, file));
      manifest.push({ set, day, place, query, kind: "video", file, duration: v.duration, source: v.url, author: v.user.name });
    }
  }
  console.log(`done: ${set} ${query}`);
}

fs.writeFileSync(path.join(ROOT, "pexels-manifest.json"), JSON.stringify(manifest, null, 2));
console.log(`${manifest.length} files`);
