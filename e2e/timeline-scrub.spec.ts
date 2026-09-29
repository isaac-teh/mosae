import { expect, test, type Page } from "@playwright/test";

async function openPlayingEditor(page: Page) {
  await page.setViewportSize({ width: 412, height: 870 });
  await page.goto("/editor?projectId=fixture&generationId=demo-film&planId=demo&repository=fixture");
  await expect(page.getByRole("button", { name: "Select clip clip-3" })).toBeVisible();
  await page.getByRole("button", { name: "Select clip clip-3" }).click();
  await expect(page.getByText(/^0:07 \/ 0:/)).toBeVisible();
  await page.getByRole("button", { name: "Play preview" }).click();
  await expect.poll(async () => readTime(page)).toBeGreaterThan(8);
}

async function readTime(page: Page) {
  const text = await page.locator("text=/^0:\\d{2} \/ 0:/").first().textContent();
  return Number(text?.match(/^0:(\d{2})/)?.[1] ?? 0);
}

async function assertScrubAndResume(page: Page, rewind: () => Promise<void>, verifyAdvancing = true) {
  const before = await readTime(page);
  await rewind();
  await expect(page.getByRole("button", { name: "Play preview" })).toBeVisible();
  await expect.poll(async () => readTime(page)).toBeLessThan(before - 1);
  const scrubbed = await readTime(page);
  await page.getByRole("button", { name: "Play preview" }).click();
  await expect(page.getByRole("button", { name: "Play preview" })).toBeHidden();
  if (verifyAdvancing) await expect.poll(async () => readTime(page), { timeout: 4_000 }).toBeGreaterThan(scrubbed);
  else await expect.poll(async () => readTime(page)).toBeLessThan(before - 1);
}

test("touch swipe pauses, scrubs the playhead, and resumes from that time", async ({ page, context }) => {
  await openPlayingEditor(page);
  const timeline = page.getByLabel("Unified timeline");
  const box = await timeline.boundingBox();
  if (!box) throw new Error("timeline is not visible");
  const cdp = await context.newCDPSession(page);
  await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 1 });
  await assertScrubAndResume(page, async () => {
    const x = Math.round(box.x + box.width / 2);
    const y = Math.round(box.y + box.height / 2);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x + 120, y }] });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: false });
  }, false);
});

test("mouse drag pauses, scrubs the playhead, and resumes from that time", async ({ page }) => {
  await openPlayingEditor(page);
  const box = await page.getByLabel("Unified timeline").boundingBox();
  if (!box) throw new Error("timeline is not visible");
  await assertScrubAndResume(page, async () => {
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 120, y, { steps: 8 });
    await page.mouse.up();
  });
});

test("horizontal wheel pauses, scrubs the playhead, and resumes from that time", async ({ page }) => {
  await openPlayingEditor(page);
  const box = await page.getByLabel("Unified timeline").boundingBox();
  if (!box) throw new Error("timeline is not visible");
  await assertScrubAndResume(page, async () => {
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(-120, 0);
  });
});
