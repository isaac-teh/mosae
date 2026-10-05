import { expect, test, type Page } from "@playwright/test";
import path from "node:path";

const editorUrl = "/editor?projectId=fixture&generationId=demo-film&planId=demo&repository=fixture";
const screenshotPath = (name: string) => path.join("/tmp", `mosae-editor-final-${name}.png`);

async function openEditor(page: Page) {
  await page.goto(editorUrl);
  await expect(page.getByRole("button", { name: "Select clip clip-1" })).toBeVisible();
  await expect(page.getByLabel("Unified timeline")).toBeVisible();
}

async function filmDuration(page: Page) {
  const text = await page.getByText(/^\d+:\d{2} \/ \d+:\d{2}$/).textContent();
  const match = text?.match(/\/ (\d+):(\d{2})$/);
  if (!match) throw new Error(`Unable to read film duration from ${text}`);
  return Number(match[1]) * 60 + Number(match[2]);
}

async function waitForDecodedPhoto(page: Page) {
  const photo = page.locator("[data-photo-media], [data-collage-media]").first();
  await expect(photo).toBeVisible();
  await expect.poll(() => photo.evaluate((node) => node instanceof HTMLImageElement ? node.complete && node.naturalWidth > 0 : true)).toBe(true);
}

test("starts in Ask mode with no music action; selected photos can be removed and replaced", async ({ page }) => {
  await openEditor(page);
  await page.screenshot({ path: screenshotPath("default"), scale: "css" });
  await expect(page.getByRole("button", { name: "Ask AI", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Music", exact: true })).toHaveCount(0);

  await page.getByRole("button", { name: "Select clip clip-3" }).click();
  await expect(page.getByRole("button", { name: "Remove", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Replace", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Remove", exact: true }).click();
  await page.getByRole("button", { name: "Remove clip" }).click();
  await expect(page.getByRole("button", { name: "Select clip clip-3" })).toHaveCount(0);
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByRole("button", { name: "Select clip clip-3" })).toBeVisible();

  const restoredPhoto = page.getByRole("button", { name: "Select clip clip-3" });
  if (await restoredPhoto.getAttribute("aria-pressed") !== "true") await restoredPhoto.click();
  await page.getByRole("button", { name: "Replace", exact: true }).click();
  await expect(page.getByText("Replace moment")).toBeVisible();
  const choices = page.getByRole("button", { name: /^Replace with / });
  await expect(choices.first()).toBeVisible();
  const prior = await page.getByRole("button", { name: "Select clip clip-3" }).getAttribute("aria-label");
  await choices.first().click();
  await expect(page.getByRole("button", { name: "Undo" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Select clip clip-3" })).toBeVisible();
  await expect(page.getByText("Saved", { exact: true })).toBeVisible({ timeout: 10_000 });
  await page.screenshot({ path: screenshotPath("replace-photo"), scale: "css" });
  expect(prior).toBe("Select clip clip-3");
});

test("collage layout has six geometries and changing count preserves total duration", async ({ page }) => {
  await openEditor(page);
  const before = await filmDuration(page);
  await page.getByRole("button", { name: "Select clip collage-1" }).click();
  await page.getByRole("button", { name: "Layout", exact: true }).click();
  await expect(page.getByText("Number of photos")).toBeVisible();
  await page.getByRole("button", { name: "Decrease number of photos" }).click();
  await expect(page.getByLabel("3 photos")).toBeVisible();
  await waitForDecodedPhoto(page);
  await page.screenshot({ path: screenshotPath("layout-open"), scale: "css" });
  const geometries = ["Wide top + two bottom", "Two top + wide bottom", "Three stacked rows", "Tall left + two right", "Two left + tall right", "Three columns"];
  for (const layout of geometries) {
    const choice = page.getByRole("button", { name: `Layout ${layout}` });
    await expect(choice).toBeVisible();
    await choice.click();
    await expect(choice).toHaveAttribute("aria-pressed", "true");
  }
  const increase = page.getByRole("button", { name: "Increase number of photos" });
  await increase.click();
  await expect(page.getByLabel("4 photos")).toBeVisible();
  const decrease = page.getByRole("button", { name: "Decrease number of photos" });
  await decrease.click();
  await decrease.click();
  await expect(page.getByLabel("2 photos")).toBeVisible();
  await expect.poll(() => filmDuration(page)).toBe(before);
  await expect(page.getByRole("button", { name: "Undo" })).toBeEnabled();
  await page.screenshot({ path: screenshotPath("collage-geometries-count"), scale: "css" });
});

test("collage cells can be cleared, replaced, and restored through undo", async ({ page }) => {
  await openEditor(page);
  const before = await filmDuration(page);
  await page.getByRole("button", { name: "Select clip collage-1" }).click();
  await page.getByRole("button", { name: "Layout", exact: true }).click();
  await page.getByRole("button", { name: "Layout Three columns", exact: true }).click();
  await page.getByRole("button", { name: "Close collage" }).click();
  const tools = page.getByLabel("Editor tools");
  for (let index = 1; index <= 4; index += 1) {
    const cell = page.getByRole("button", { name: `Select collage cell slot-${index}` });
    await expect(cell).toBeVisible();
    await cell.click();
    await tools.getByRole("button", { name: "Remove", exact: true }).click();
  }
  await expect.poll(() => filmDuration(page)).toBe(before);
  await expect(page.locator("img[data-collage-media], video[data-collage-media]")).toHaveCount(0);
  await expect(page.locator("[data-collage-cell]")).toHaveCount(4);
  await page.screenshot({ path: screenshotPath("collage-all-empty"), scale: "css" });
  const emptyCell = page.getByRole("button", { name: "Select collage cell slot-1" });
  await emptyCell.click();
  await tools.getByRole("button", { name: "Replace" }).click();
  await expect(page.getByText("Replace cell")).toBeVisible();
  const choices = page.getByRole("button", { name: /^Replace with / });
  await expect(choices.first()).toBeVisible();
  await choices.first().click();
  await expect(page.getByRole("button", { name: "Undo" })).toBeEnabled();
  await expect.poll(() => filmDuration(page)).toBe(before);
  await waitForDecodedPhoto(page);
  await page.screenshot({ path: screenshotPath("collage-replace-cell"), scale: "css" });
});

test("two-pointer photo crop and rotation persist across save and can be undone", async ({ page }) => {
  await openEditor(page);
  await page.getByRole("button", { name: "Select clip clip-3" }).click();
  await waitForDecodedPhoto(page);
  await page.screenshot({ path: screenshotPath("single-photo-selected"), scale: "css" });
  const target = page.locator('[data-photo-clip="clip-3"]');
  await expect(target).toBeVisible();
  await target.evaluate((node) => {
    const element = node as HTMLElement & { setPointerCapture?: (pointerId: number) => void };
    element.setPointerCapture = () => {};
    const dispatch = (type: string, pointerId: number, clientX: number, clientY: number) => {
      element.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId, pointerType: "touch", clientX, clientY }));
    };
    dispatch("pointerdown", 41, 160, 300);
    dispatch("pointerdown", 42, 220, 300);
    dispatch("pointermove", 42, 255, 335);
    dispatch("pointerup", 41, 160, 300);
    dispatch("pointerup", 42, 255, 335);
  });
  await expect(page.getByRole("button", { name: "Undo" })).toBeEnabled();
  await expect(page.getByText("Saved", { exact: true })).toBeVisible({ timeout: 10_000 });
  await expect.poll(() => page.locator("[data-photo-media]").first().getAttribute("style")).toMatch(/scale\(1\.[1-9].*rotate\((?!0deg)/);
  await page.screenshot({ path: screenshotPath("photo-crop-rotate"), scale: "css" });
  const media = page.locator("[data-photo-media]").first();
  await page.getByRole("button", { name: "Undo" }).click();
  await expect.poll(() => media.getAttribute("style")).toMatch(/scale\(1\) rotate\(0deg\)/);
  await page.getByRole("button", { name: "Redo" }).click();
  await expect(page.getByText("Saved", { exact: true })).toBeVisible({ timeout: 10_000 });
  await page.reload();
  await page.getByRole("button", { name: "Select clip clip-3" }).click();
  await expect.poll(() => page.locator("[data-photo-media]").first().getAttribute("style")).toMatch(/scale\(1\.[1-9].*rotate\((?!0deg)/);
});

test("music search, mood filtering, preview selection, confirm, and cancel are isolated", async ({ page }) => {
  await openEditor(page);
  const picker = page.getByRole("button", { name: "Open soundtrack picker" });
  await picker.click();
  await expect(page.getByText("Replace music")).toBeVisible();
  await expect(page.getByRole("button", { name: "Preview Okinawa Ukulele & String Trio", exact: true })).toBeVisible();
  await page.getByLabel("Search soundtracks").fill("piano");
  await expect(page.getByRole("button", { name: "Preview Piano & Ambient", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Preview Okinawa Ukulele & String Trio", exact: true })).toHaveCount(0);
  await page.getByLabel("Search soundtracks").fill("");
  await page.getByLabel("Soundtrack mood Acoustic Heirloom").click();
  await expect(page.getByRole("button", { name: "Preview Okinawa Ukulele & String Trio", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Preview Piano & Ambient", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Preview Okinawa Ukulele & String Trio", exact: true }).click();
  await expect(page.getByText("Okinawa Ukulele & String Trio").last()).toBeVisible();
  await expect(page.getByRole("button", { name: "Pause soundtrack preview" })).toBeVisible();
  await page.getByRole("button", { name: "Pause soundtrack preview" }).click();
  await page.getByRole("button", { name: "Play soundtrack preview" }).click();
  await expect(page.getByRole("button", { name: "Pause soundtrack preview" })).toBeVisible();
  await expect.poll(() => page.locator("[data-soundtrack-preview]").evaluate((node) => (node as HTMLAudioElement).currentTime)).toBeGreaterThan(0);
  await page.screenshot({ path: screenshotPath("music-selected"), scale: "css" });
  await page.screenshot({ path: screenshotPath("music-picker"), scale: "css" });
  await page.getByLabel("Close soundtrack").click();
  await expect(page.getByRole("button", { name: "Open soundtrack picker" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Music track/ })).toHaveCount(0);

  await page.getByRole("button", { name: "Open soundtrack picker" }).click();
  await page.getByRole("button", { name: "Preview Okinawa Ukulele & String Trio", exact: true }).click();
  await page.getByLabel("Confirm soundtrack").click();
  await expect(page.getByRole("button", { name: /^Music track Okinawa Ukulele & String Trio/ })).toBeVisible();
  await page.getByRole("button", { name: /^Music track Okinawa Ukulele & String Trio/ }).click();
  await page.getByRole("button", { name: "Replace", exact: true }).click();
  await expect(page.getByText("Replace music")).toBeVisible();
  await page.getByRole("button", { name: "Preview Piano & Ambient", exact: true }).first().click();
  await page.getByLabel("Confirm soundtrack").click();
  await expect(page.getByRole("button", { name: /^Music track Piano & Ambient/ })).toBeVisible();
  await expect(page.getByText("Saved", { exact: true })).toBeVisible({ timeout: 10_000 });
});

test("soundtrack picker handles missing plan metadata without breaking the editor", async ({ page }) => {
  await page.goto("/editor?projectId=fixture&generationId=demo-film&planId=missing&repository=fixture");
  await expect(page.getByRole("button", { name: "Select clip clip-1" })).toBeVisible();
  await page.getByRole("button", { name: "Open soundtrack picker" }).click();
  await expect(page.getByText("No soundtracks found")).toBeVisible();
  await expect(page.getByLabel("Confirm soundtrack")).toBeDisabled();
  await page.getByLabel("Close soundtrack").click();
  await expect(page.getByLabel("Unified timeline")).toBeVisible();
});

test("music volume maps exact mute and unity, saves, and survives reload and undo", async ({ page }) => {
  await openEditor(page);
  await page.getByRole("button", { name: "Open soundtrack picker" }).click();
  await page.getByRole("button", { name: "Preview Okinawa Ukulele & String Trio", exact: true }).click();
  await page.getByLabel("Confirm soundtrack").click();
  const music = page.getByRole("button", { name: /^Music track Okinawa Ukulele & String Trio/ });
  await music.click();
  await page.getByRole("button", { name: "Volume", exact: true }).click();
  await expect(page.getByText("Audio volume")).toBeVisible();
  const slider = page.getByRole("slider", { name: "Music volume" });
  await slider.fill("0");
  await expect(page.getByLabel("Volume 0 percent")).toBeVisible();
  await page.screenshot({ path: screenshotPath("volume-sheet-muted"), scale: "css" });
  await page.getByLabel("Apply audio volume").click();
  await expect(page.getByText("Saved", { exact: true })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole("button", { name: "Undo" })).toBeEnabled();
  await page.screenshot({ path: screenshotPath("music-volume-muted"), scale: "css" });
  await page.reload();
  await expect(page.getByRole("button", { name: /^Music track Okinawa Ukulele & String Trio/ })).toBeVisible();
  await page.getByRole("button", { name: /^Music track Okinawa Ukulele & String Trio/ }).click();
  await page.getByRole("button", { name: "Volume", exact: true }).click();
  await expect(page.getByLabel("Volume 0 percent")).toBeVisible();
  await page.getByRole("slider", { name: "Music volume" }).fill("100");
  await expect(page.getByLabel("Volume 100 percent")).toBeVisible();
  await page.getByLabel("Apply audio volume").click();
  await expect(page.getByText("Saved", { exact: true })).toBeVisible({ timeout: 10_000 });
  await page.getByRole("button", { name: "Undo" }).click();
  await page.getByRole("button", { name: /^Music track Okinawa Ukulele & String Trio/ }).click();
  await page.getByRole("button", { name: "Volume", exact: true }).click();
  await expect(page.getByLabel("Volume 0 percent")).toBeVisible();
});

test("music label remains accessible after timeline scroll and Save opens render status", async ({ page }) => {
  await openEditor(page);
  await page.getByRole("button", { name: "Open soundtrack picker" }).click();
  await page.getByRole("button", { name: "Preview Okinawa Ukulele & String Trio", exact: true }).click();
  await page.getByLabel("Confirm soundtrack").click();
  const timeline = page.getByLabel("Unified timeline");
  await timeline.evaluate((node) => { node.scrollLeft = node.scrollWidth; node.dispatchEvent(new Event("scroll", { bubbles: true })); });
  await expect(page.getByRole("button", { name: /^Music track Okinawa Ukulele & String Trio/ })).toBeVisible();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText(/^(Preparing|Rendering|Ready)$/)).toBeVisible({ timeout: 30_000 });
});

test("existing collage library styles use rendered previews and preserve photos, duration, and undo", async ({ page }) => {
  await openEditor(page);
  const before = await filmDuration(page);
  await page.getByRole("button", { name: "Select clip collage-1", exact: true }).click();
  await page.getByRole("button", { name: "Layout", exact: true }).click();
  await page.getByRole("button", { name: "Collage Styles", exact: true }).click();
  for (const name of ["Photo table", "Torn paper mosaic", "Polaroid garland", "Postcard stack", "Route map", "Botanical scrapbook", "Nine-photo grid", "Travel mosaic", "Travel story"]) {
    const button = page.getByRole("button", { name: `Layout ${name}`, exact: true });
    await button.click();
    await expect(button).toHaveAttribute("aria-pressed", "true");
    const preview = page.getByLabel(`${name} style preview`, { exact: true });
    await expect(preview).toBeVisible();
    await expect.poll(() => preview.evaluate((node) => node instanceof HTMLImageElement ? node.complete && node.naturalWidth > 0 : Boolean(node.querySelector("img")?.naturalWidth))).toBe(true);
    await expect(page.locator("[data-collage-media]")).toHaveCount(4);
    expect(await filmDuration(page)).toBe(before);
  }
  await expect(page.getByRole("button", { name: "Layout Film negative", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Layout Torn paper mosaic", exact: true }).click();
  await page.getByRole("button", { name: "Motion Tape slap", exact: true }).click();
  await expect(page.getByRole("button", { name: "Motion Tape slap", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.screenshot({ path: screenshotPath("collage-library-styles"), scale: "css" });
  await page.getByRole("button", { name: "Close collage", exact: true }).click();
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await page.getByRole("button", { name: "Layout", exact: true }).click();
  await page.getByRole("button", { name: "Collage Styles", exact: true }).click();
  await expect(page.getByRole("button", { name: "Motion Print drop", exact: true })).toHaveAttribute("aria-pressed", "true");
});

test("collage Layout drawer expands and lets the last style scroll into view", async ({ page }) => {
  await openEditor(page);
  await page.getByRole("button", { name: "Select clip collage-1", exact: true }).click();
  await page.getByRole("button", { name: "Layout", exact: true }).click();
  const handle = page.getByRole("button", { name: "Toggle layout drawer" });
  const panel = handle.locator("xpath=..");
  const collapsedHeight = (await panel.boundingBox())?.height;
  if (!collapsedHeight) throw new Error("Collage drawer has no measurable height");
  const handlePoint = await handle.boundingBox();
  if (!handlePoint) throw new Error("Collage drawer handle is missing");
  await handle.evaluate((node) => {
    const y = node.getBoundingClientRect().y + node.getBoundingClientRect().height / 2;
    const start = new Event("touchstart", { bubbles: true });
    Object.defineProperty(start, "pageY", { value: y });
    node.dispatchEvent(start);
    const end = new Event("touchend", { bubbles: true });
    Object.defineProperty(end, "pageY", { value: y - 300 });
    node.dispatchEvent(end);
  });
  await expect.poll(async () => (await panel.boundingBox())?.height ?? 0).toBeGreaterThan(collapsedHeight + 100);
  await page.getByRole("button", { name: "Collage Styles", exact: true }).click();
  const lastStyle = page.getByRole("button", { name: "Layout Travel story", exact: true });
  await lastStyle.scrollIntoViewIfNeeded();
  await expect(lastStyle).toBeInViewport();
  await lastStyle.click();
  await expect(lastStyle).toHaveAttribute("aria-pressed", "true");
});
