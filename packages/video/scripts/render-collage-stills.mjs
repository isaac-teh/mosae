import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repository = resolve(packageRoot, "../..");
const publicDir = resolve(repository, "poc/gemini/samples/trip");
const outputDir = resolve(repository, "docs/design/collage-library");
const entry = "src/collage/stills.tsx";
const layouts = ["photo-table", "triptych", "hero-plus-two", "grid-4", "filmstrip", "polaroid-stack", "split-screen", "single-framed"];
const galleryPublic = resolve(packageRoot, "gallery/public");
const tripPhotoFiles = [
  "d01-tokyo-photo-7210063.jpg", "d03-tokyo-photo-5690552.jpg", "d04-tokyo-photo-31223297.jpg", "d05-kyoto-photo-1673978.jpg",
  "d05-kyoto-photo-26946364.jpg", "d05-kyoto-photo-30094291.jpg", "d06-kyoto-photo-35568183.jpg", "d09-osaka-photo-25050466.jpg",
];
const usePlaceholders = !tripPhotoFiles.every((file) => existsSync(resolve(publicDir, file)));
const remotionPublic = usePlaceholders ? galleryPublic : publicDir;
mkdirSync(outputDir, { recursive: true });

function render(id, output) {
  const result = spawnSync("npx", ["remotion", "still", entry, id, output, "--frame=80", `--public-dir=${remotionPublic}`], {
    cwd: packageRoot,
    stdio: "inherit",
    env: { ...process.env, MOSAE_COLLAGE_STILL_PLACEHOLDERS: usePlaceholders ? "1" : "0" },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

for (const layout of layouts) render(`Collage-${layout}`, resolve(outputDir, `${layout}.png`));
render("CollageContactSheet", resolve(outputDir, "contact-sheet.png"));
