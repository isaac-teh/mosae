import { defineConfig, devices } from "@playwright/test";

const phone = { width: 390, height: 844 };
const tallPhone = { width: 412, height: 915 };

export default defineConfig({
  testDir: ".",
  testMatch: ["editor-design-review.spec.ts", "chat-film-touch.spec.ts", "ios-fullscreen.spec.ts", "editor-batch-3.spec.ts", "device-upload.spec.ts"],
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:18778",
    deviceScaleFactor: 1,
  },
  projects: [
    { name: "chromium-390x844", use: { ...devices["Desktop Chrome"], viewport: phone } },
    { name: "chromium-mobile", use: { ...devices["Pixel 7"], viewport: phone } },
    { name: "chromium-412x915", use: { ...devices["Pixel 7"], viewport: tallPhone } },
    { name: "webkit-390x844", use: { ...devices["iPhone 13"], viewport: phone } },
    { name: "webkit-412x915", use: { ...devices["iPhone 13"], viewport: tallPhone } },
  ],
});
