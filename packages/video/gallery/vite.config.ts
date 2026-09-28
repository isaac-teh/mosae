import { defineConfig, type Plugin } from "vite";
import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { resolve, basename, extname } from "node:path";
import { TRIP_PHOTO_FILES } from "./src/tripPhotos";

const repository = resolve(__dirname, "../../..");
const tripSamples = resolve(repository, "poc/gemini/samples/trip");
const tripPhotos = TRIP_PHOTO_FILES.filter((file) => {
  const path = resolve(tripSamples, file);
  return path.startsWith(`${tripSamples}/`) && existsSync(path) && statSync(path).isFile();
});

let isBuild = false;
const samplePhotoServer: Plugin = {
  name: "collage-trip-sample-photos",
  configResolved(config) { isBuild = config.command === "build"; },
  buildStart() {
    if (!isBuild) return;
    for (const file of tripPhotos) this.emitFile({ type: "asset", fileName: `__collage_trip__/${file}`, source: readFileSync(resolve(tripSamples, file)) });
  },
  configureServer(server) {
    server.middlewares.use((request, response, next) => {
      const match = request.url?.match(/^\/__collage_trip__\/([^/?]+)$/);
      if (!match) return next();
      const file = basename(decodeURIComponent(match[1]));
      if (!tripPhotos.includes(file as typeof tripPhotos[number])) return next();
      response.setHeader("Content-Type", extname(file) === ".jpg" ? "image/jpeg" : "application/octet-stream");
      createReadStream(resolve(tripSamples, file)).pipe(response);
    });
  },
};

export default defineConfig({
  root: resolve(__dirname),
  server: { host: "127.0.0.1", port: 4178 },
  resolve: { alias: { "@mosae/video/collage": resolve(__dirname, "../src/collage") } },
  define: { __COLLAGE_TRIP_PHOTOS__: JSON.stringify(tripPhotos.map((file) => `/__collage_trip__/${file}`)) },
  plugins: [samplePhotoServer],
});
