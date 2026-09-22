// Turns a poc/gemini composition into props for the Film composition, inserting
// one collage shot per place from photos the edit left on the floor.
//
//   node buildFilm.mjs [--run gemini-3-5-flash-lite] [--set trip]
//
// Writes out/film.json. Nothing here is production code: the real pipeline
// composes a validated Timeline, and this only reshapes an existing POC result
// so it can be watched.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const at = args.indexOf(`--${name}`);
  return at >= 0 ? args[at + 1] : fallback;
};

const set = flag("set", "trip");
const run = flag("run", "gemini-3-5-flash-lite");
const geminiDir = path.resolve("../gemini");
const runDir = path.join(geminiDir, "out", set, run);

const timeline = JSON.parse(readFileSync(path.join(runDir, "timeline.json"), "utf8"));
const catalog = JSON.parse(readFileSync(path.join(runDir, "catalog.json"), "utf8"));
const byId = new Map(catalog.items.map((item) => [item.id, item]));

/** Transition lengths the composer never specified. Chosen once, here, not per clip. */
const CROSSFADE_SEC = 0.6;
const DIP_SEC = 0.8;
/** A six-card landing needs about this long before it has finished arriving. */
const COLLAGE_SEC = 4.5;
const COLLAGE_CELLS = 6;

const durationOf = (clip) =>
  clip.sourceInSec !== undefined ? clip.sourceOutSec - clip.sourceInSec : clip.holdSec;

const ordered = [...timeline.clips].sort((a, b) => a.order - b.order);

// --- the photos this edit never used, grouped by place -----------------------

const used = new Set(ordered.map((clip) => clip.itemId));
const leftovers = new Map();
for (const item of catalog.items) {
  if (item.kind !== "photo" || used.has(item.id) || item.excluded) continue;
  if (!leftovers.has(item.place)) leftovers.set(item.place, []);
  leftovers.get(item.place).push(item);
}

/** The place a clip belongs to, read off the catalog rather than the id. */
const placeOf = (clip) => byId.get(clip.itemId)?.place ?? "unknown";

/** The index of the last clip in each contiguous run of one place. */
const placeEnds = [];
ordered.forEach((clip, index) => {
  const next = ordered[index + 1];
  if (!next || placeOf(next) !== placeOf(clip)) placeEnds.push({ index, place: placeOf(clip) });
});

// --- build the clip list, splicing a collage in after each place -------------

const clips = [];
const pushSource = (clip) => {
  const item = byId.get(clip.itemId);
  if (!item) throw new Error(`timeline references ${clip.itemId}, which the catalog does not hold`);
  clips.push({
    id: `c${clips.length}`,
    kind: item.kind === "video" ? "video" : "photo",
    files: [item.file],
    durationSec: Number(durationOf(clip).toFixed(3)),
    sourceInSec: clip.sourceInSec,
    audio: clip.audio === "keep" ? "keep" : "mute",
    transitionIn: clips.length === 0 ? "cut" : clip.transition,
    label: item.id,
  });
};

ordered.forEach((clip, index) => {
  pushSource(clip);

  const end = placeEnds.find((candidate) => candidate.index === index);
  if (!end) return;
  const spare = leftovers.get(end.place) ?? [];
  if (spare.length < COLLAGE_CELLS) return;

  // Sharpest first, so a collage is not built out of the weakest frames.
  const cells = [...spare].sort((a, b) => b.sharpness - a.sharpness).slice(0, COLLAGE_CELLS);
  clips.push({
    id: `c${clips.length}`,
    kind: "collage",
    files: cells.map((item) => item.file),
    durationSec: COLLAGE_SEC,
    audio: "mute",
    // A collage is a held beat, so it earns a soft entry rather than a hard cut.
    transitionIn: "crossfade",
    seed: `${set}:${end.place}`,
    label: `collage:${end.place}`,
  });
});

// --- lay them out in time ----------------------------------------------------

let cursor = 0;
for (const clip of clips) {
  const overlap = clip.transitionIn === "crossfade" ? CROSSFADE_SEC : 0;
  clip.startSec = Number(Math.max(0, cursor - overlap).toFixed(3));
  cursor = clip.startSec + clip.durationSec;
}

const film = {
  set,
  run,
  fps: 30,
  width: 1080,
  height: 1920,
  crossfadeSec: CROSSFADE_SEC,
  dipSec: DIP_SEC,
  durationSec: Number(cursor.toFixed(3)),
  clips,
};

mkdirSync("out", { recursive: true });
writeFileSync("out/film.json", JSON.stringify(film, null, 1));

const collages = clips.filter((clip) => clip.kind === "collage");
const sourceSec = ordered.reduce((total, clip) => total + durationOf(clip), 0);
console.log(`${run} / ${set}`);
console.log(`  source edit   ${ordered.length} clips, ${sourceSec.toFixed(1)}s`);
console.log(`  collages      ${collages.length} (${collages.map((c) => c.label.split(":")[1]).join(", ")})`);
console.log(`  photos added  ${collages.length * COLLAGE_CELLS} of ${[...leftovers.values()].flat().length} unused`);
console.log(`  film          ${clips.length} clips, ${film.durationSec.toFixed(1)}s`);
console.log("  wrote out/film.json");
