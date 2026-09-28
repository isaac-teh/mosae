# Collage review gallery

Start from the repository root with `npm run gallery --workspace=@mosae/video`, then open the Vite URL (usually `http://localhost:5173`). The gallery uses the curated Pexels travel photos in `poc/gemini/samples/trip`; if those photos are not present, it falls back to the included SVG sample art. It never reads `trip1`.

Choose an effect in the toolbar, review each layout × motion Player, and mark it **Keep**, **Tweak** (with a note), or **Block**. Reviews save in browser local storage. **Export JSON** downloads the `docs/design/collage-review.json` shape with one verdict record per layout/motion pair.

To regenerate actual Remotion stills, the contact sheet, and three five-second examples, run `node packages/video/scripts/render-collage-stills.mjs` from the repository root. Outputs go to `docs/design/collage-library/`.
