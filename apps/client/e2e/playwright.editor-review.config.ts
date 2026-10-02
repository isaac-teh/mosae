import { defineConfig, devices } from "@playwright/test";

const phone = { width: 390, height: 844 };
const tallPhone = { width: 412, height: 870 };

export default defineConfig({
  testDir: ".",
  testMatch: ["editor-design-review.spec.ts"],
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:18778",
    deviceScaleFactor: 1,
  },
  projects: [
    { name: "chromium-390x844", use: { ...devices["Desktop Chrome"], viewport: phone } },
    { name: "chromium-412x870", use: { ...devices["Desktop Chrome"], viewport: tallPhone } },
    { name: "webkit-390x844", use: { ...devices["iPhone 14"], viewport: phone } },
    { name: "webkit-412x870", use: { ...devices["iPhone 14"], viewport: tallPhone } },
  ],
});
