import type { Config } from "tailwindcss";

// Palette and type pulled from the Mosaé Figma file (Fy98tbWFllxppbFwTWhU81).
const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        canvas: "#fcf9f4",
        surface: { DEFAULT: "#ffffff", muted: "#f6f3ee", sunken: "#f0ede9", pill: "#ebe8e3" },
        track: "#e5e2dd",
        line: "#ebe8e3",
        ink: { DEFAULT: "#1c1c19", soft: "#59413b", faint: "#8c716a" },
        honey: { DEFAULT: "#855300", tint: "rgba(255,221,184,0.5)", deep: "#2a1700" },
        brand: { DEFAULT: "#a83212", bright: "#ca4a28", tint: "#ffdbd2", deep: "#3c0800", dot: "#e0bfb7" },
      },
      fontFamily: {
        sans: ["var(--font-jakarta)", "system-ui", "sans-serif"],
        display: ["var(--font-fraunces)", "Georgia", "serif"],
        serif: ["var(--font-newsreader)", "Georgia", "serif"],
      },
    },
  },
  plugins: [],
};
export default config;
