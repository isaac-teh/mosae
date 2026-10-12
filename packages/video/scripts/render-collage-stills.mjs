import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const packageRoot=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const repository=resolve(packageRoot,"../..");
const tripDir=resolve(repository,"poc/gemini/samples/trip");
const galleryPublic=resolve(packageRoot,"gallery/public");
const out=resolve(repository,"docs/design/collage-library");
const files=["d01-tokyo-photo-7210063.jpg","d03-tokyo-photo-5690552.jpg","d04-tokyo-photo-31223297.jpg","d05-kyoto-photo-1673978.jpg","d05-kyoto-photo-26946364.jpg","d05-kyoto-photo-30094291.jpg","d06-kyoto-photo-35568183.jpg","d09-osaka-photo-25050466.jpg","d01-tokyo-photo-1510610.jpg"];
const fallback=!files.every(f=>existsSync(resolve(tripDir,f)));
const publicDir=fallback?galleryPublic:tripDir;
const entry="src/collage/stills.tsx";
mkdirSync(out,{recursive:true}); mkdirSync(resolve(out,"samples"),{recursive:true});
function run(args){const r=spawnSync("npx",["remotion",...args],{cwd:packageRoot,stdio:"inherit",env:{...process.env,MOSAE_COLLAGE_STILL_PLACEHOLDERS:fallback?"1":"0"}});if(r.error)throw r.error;if(r.status!==0)process.exit(r.status??1);}
const layouts=["photo-table","torn-paper","polaroid-garland","postcard-stack","route-map","travel-mosaic","travel-story","botanical-scrapbook","nine-photo-grid"];
const samples=[["photo-table","stack-deal"],["torn-paper","print-drop"],["polaroid-garland","focus-relay"],["postcard-stack","stack-deal"],["route-map","stack-deal"],["travel-mosaic","print-drop"],["travel-story","focus-relay"],["botanical-scrapbook","tape-slap"],["nine-photo-grid","print-drop"]];
for(const file of readdirSync(out))if(file.endsWith(".png")&&file!=="contact-sheet.png"&&file!=="mixed-orientation.png"&&!layouts.includes(file.slice(0,-4)))rmSync(resolve(out,file),{force:true});
for(const file of readdirSync(resolve(out,"samples")))if(file.endsWith(".mp4"))rmSync(resolve(out,"samples",file),{force:true});
run(["still",entry,"Collage-mixed-orientation",resolve(out,"mixed-orientation.png"),"--frame=75",`--public-dir=${galleryPublic}`]);
for(const layout of layouts){run(["still",entry,`Collage-${layout}`,resolve(out,`${layout}.png`),"--frame=125",`--public-dir=${publicDir}`]);}
run(["still",entry,"CollageContactSheet",resolve(out,"contact-sheet.png"),"--frame=125",`--public-dir=${publicDir}`]);
for(const [layout,motion] of samples)run(["render",entry,`Sample-${layout}`,resolve(out,"samples",`${layout}-${motion}.mp4`),"--codec=h264",`--public-dir=${publicDir}`]);
