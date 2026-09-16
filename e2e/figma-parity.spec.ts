import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";
import { figmaScenarios } from "./figma-scenarios";

// Figma and Chrome rasterize text differently, so the bar is 3% here; approved renders
// are locked at 1% in parity.spec.ts.
const MAX_DIFF_RATIO = 0.03;
const outDir = path.join(__dirname, "test-results", "figma-parity");
const only = process.env.SCREEN;

for (const scenario of figmaScenarios.filter((s) => !only || s.name === only)) {
  test(`figma parity ${scenario.name}`, async ({ page }) => {
    const baseline = path.join(__dirname, "baseline", "figma", `${scenario.name}.png`);
    test.skip(!fs.existsSync(baseline), `no Figma baseline exported yet for ${scenario.name}`);
    await page.setViewportSize({ width: 390, height: scenario.height });
    await scenario.run(page);
    const actual = PNG.sync.read(await page.screenshot({ fullPage: true }));
    const expected = PNG.sync.read(fs.readFileSync(baseline));
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, `${scenario.name}-actual.png`), PNG.sync.write(actual));

    expect({ width: actual.width, height: actual.height }).toEqual({ width: expected.width, height: expected.height });

    const diff = new PNG({ width: expected.width, height: expected.height });
    const changed = pixelmatch(expected.data, actual.data, diff.data, expected.width, expected.height, { threshold: 0.1 });
    fs.writeFileSync(path.join(outDir, `${scenario.name}-diff.png`), PNG.sync.write(diff));
    expect(changed / (expected.width * expected.height)).toBeLessThanOrEqual(MAX_DIFF_RATIO);
  });
}
