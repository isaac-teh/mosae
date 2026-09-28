import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname) } },
  esbuild: { jsx: "automatic" },
  test: { environment: "jsdom", setupFiles: ["./tests/setup-act.ts"], env: { NODE_ENV: "development" }, include: ["tests/**/*.test.{ts,tsx}"] },
});
