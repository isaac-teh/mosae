import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";
import { scenarios } from "./scenarios";

const MAX_DIFF_RATIO = 0.01;
const outDir = path.join(__dirname, "test-results", "parity");

for (const scenario of scenarios) {
  test(`parity ${scenario.name}`, async ({ page }) => {
    await scenario.run(page);
    const actual = PNG.sync.read(await page.screenshot({ fullPage: true }));
    const expected = PNG.sync.read(fs.readFileSync(path.join(__dirname, "baseline", `${scenario.name}.png`)));

    expect({ width: actual.width, height: actual.height }).toEqual({ width: expected.width, height: expected.height });

    const diff = new PNG({ width: expected.width, height: expected.height });
    const changed = pixelmatch(expected.data, actual.data, diff.data, expected.width, expected.height, { threshold: 0.1 });
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, `${scenario.name}-actual.png`), PNG.sync.write(actual));
    fs.writeFileSync(path.join(outDir, `${scenario.name}-diff.png`), PNG.sync.write(diff));

    expect(changed / (expected.width * expected.height)).toBeLessThanOrEqual(MAX_DIFF_RATIO);
  });
}
