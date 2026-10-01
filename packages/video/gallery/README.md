# Collage review gallery

Start from the repository root with `npm run gallery --workspace=@mosae/video`, then open the Vite URL (usually `http://127.0.0.1:4178`). The gallery uses the curated Pexels travel photos in `poc/gemini/samples/trip`; if those photos are not present, it falls back to the included SVG sample art. It never reads `trip1`.

Choose an effect in the toolbar, review each layout × motion Player, and mark it **Keep**, **Tweak** (with a note), or **Block**. Reviews save in browser local storage. **Export JSON** downloads the `docs/design/collage-review.json` shape with one verdict record per layout/motion pair.

The gallery contains the thirteen combinations marked keep in `docs/design/collage-review.json`. To regenerate actual Remotion stills, the contact sheet, and one five-second example for each retained layout, run `node packages/video/scripts/render-collage-stills.mjs` from the repository root. Outputs go to `docs/design/collage-library/`.

The October 1 review retains Travel mosaic · print-drop (8 photos) and Travel story · focus-relay (5 photos) from the sample extension. Travel mosaic uses the reference’s measured stepped diagonal poses, vertical offsets, abrupt landings, progressive title reveal, and stationary hold. Travel story has no template caption text or caption shading. Both support portrait and landscape and adapt to smaller photo counts. Updated previews are in `docs/design/collage-library/2026-10-01/`.

Both Film negative combinations were removed after user review.

Botanical scrapbook · tape-slap and Nine-photo grid · print-drop were rebuilt for another review. The scrapbook uses layered paper, individual frame/leaf/tape timing, the OFL Pinyon Script font, and a final photo fade; the grid uses the measured cubic tumble entrances from its supplied clip. Current comparison videos and stills are in `docs/design/collage-library/2026-10-01/rebuilt/`.
