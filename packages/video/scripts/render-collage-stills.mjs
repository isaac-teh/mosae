import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const packageRoot=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const repository=resolve(packageRoot,"../..");
const tripDir=resolve(repository,"poc/gemini/samples/trip");
const galleryPublic=resolve(packageRoot,"gallery/public");
const out=resolve(repository,"docs/design/collage-library");
const files=["d01-tokyo-photo-7210063.jpg","d03-tokyo-photo-5690552.jpg","d04-tokyo-photo-31223297.jpg","d05-kyoto-photo-1673978.jpg","d05-kyoto-photo-26946364.jpg","d05-kyoto-photo-30094291.jpg","d06-kyoto-photo-35568183.jpg","d09-osaka-photo-25050466.jpg"];
const fallback=!files.every(f=>existsSync(resolve(tripDir,f)));
const publicDir=fallback?galleryPublic:tripDir;
const entry="src/collage/stills.tsx";
mkdirSync(out,{recursive:true}); mkdirSync(resolve(out,"samples"),{recursive:true});
function run(args){const r=spawnSync("npx",["remotion",...args],{cwd:packageRoot,stdio:"inherit",env:{...process.env,MOSAE_COLLAGE_STILL_PLACEHOLDERS:fallback?"1":"0"}});if(r.error)throw r.error;if(r.status!==0)process.exit(r.status??1);}
for(const layout of ["photo-table","travel-journal","torn-paper","polaroid-garland","film-negative","postcard-stack","editorial-story","route-map","round-trip","souvenir-board","ticket-stubs","window-arches"]){run(["still",entry,`Collage-${layout}`,resolve(out,`${layout}.png`),"--frame=125",`--public-dir=${publicDir}`]);}
run(["still",entry,"CollageContactSheet",resolve(out,"contact-sheet.png"),"--frame=125",`--public-dir=${publicDir}`]);
for(const [id,name] of [["SamplePhotoTable","photo-table-print-drop"],["SampleJournal","travel-journal-page-turn"],["SampleFilm","film-negative-parallax-glide"]])run(["render",entry,id,resolve(out,"samples",`${name}.mp4`),"--codec=h264",`--public-dir=${publicDir}`]);
