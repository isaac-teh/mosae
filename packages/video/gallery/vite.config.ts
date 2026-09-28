import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig({
  root: resolve(__dirname),
  server: { host: "127.0.0.1", port: 4178 },
  resolve: { alias: { "@mosae/video/collage": resolve(__dirname, "../src/collage") } },
});
