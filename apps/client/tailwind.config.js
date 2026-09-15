/** Palette and type pulled from the Mosaé Figma file (Fy98tbWFllxppbFwTWhU81). @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: "class",
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"], presets: [require("nativewind/preset")],
  theme: { extend: { colors: { canvas: "#fcf9f4", surface: { DEFAULT: "#ffffff", muted: "#f6f3ee", sunken: "#f0ede9", pill: "#ebe8e3" }, track: "#e5e2dd", line: "#ebe8e3", ink: { DEFAULT: "#1c1c19", soft: "#59413b", faint: "#8c716a" }, honey: { DEFAULT: "#855300", tint: "rgba(255,221,184,0.5)", deep: "#2a1700" }, brand: { DEFAULT: "#a83212", bright: "#ca4a28", tint: "#ffdbd2", deep: "#3c0800", dot: "#e0bfb7" } }, fontFamily: { sans: ["PlusJakartaSans_400Regular"], "sans-medium": ["PlusJakartaSans_500Medium"], "sans-semibold": ["PlusJakartaSans_600SemiBold"], "sans-bold": ["PlusJakartaSans_700Bold"], serif: ["Newsreader_400Regular"], "serif-italic": ["Newsreader_400Regular_Italic"], display: ["Fraunces_600SemiBold"] } } }, plugins: [],
};
