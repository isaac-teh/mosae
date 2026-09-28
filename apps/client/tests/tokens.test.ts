import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const config = require("../tailwind.config.js");
const colors = config.theme.extend.colors;
const themeColors = [
  "surface", "surface-raised", "surface-sunken", "ink", "ink-muted", "line", "line-strong",
  "action", "on-action", "action-hover", "action-pressed", "ink-tint", "bubble-you", "accent",
  "on-accent", "tile", "positive", "critical", "focus-ring", "screen", "on-screen",
  "on-screen-muted", "scrim",
];

describe("design system v13 tokens", () => {
  it("maps every theme color and typography token", () => {
    for (const color of themeColors) expect(colors).toHaveProperty(color);
    expect(config.theme.extend.fontFamily.title).toContain("Literata_600SemiBold");
    expect(config.theme.extend.fontSize.title).toEqual(["28px", { lineHeight: "34px" }]);
  });

  it("defines every theme color in the light and dark CSS variable blocks", () => {
    const css = readFileSync(resolve(__dirname, "../global.css"), "utf8");
    const light = css.match(/:root\s*\{([^}]*)\}/)?.[1] ?? "";
    const dark = css.match(/\.dark\s*\{([^}]*)\}/)?.[1] ?? "";
    for (const color of themeColors) {
      expect(light, `Light is missing --color-${color}`).toMatch(new RegExp(`--color-${color}\\s*:`));
      expect(dark, `Dark is missing --color-${color}`).toMatch(new RegExp(`--color-${color}\\s*:`));
    }
  });
});
