# Collage review gallery

Run from the repository root:

```sh
npm run gallery -w @mosae/video
```

Open `http://127.0.0.1:4178`. The page previews all 48 layout × motion combinations with `@remotion/player`. Choose an effect from the selector to preview it across the gallery. Keep, tweak, and block reviews are saved in this browser's `localStorage`; **Export JSON** downloads the current decisions in `docs/design/collage-review.json` shape. A tweak asks for a short note.

When `poc/gemini/samples/trip/` is present, Vite serves a curated set of its place-focused Pexels photos to the gallery. The checked-in abstract SVGs in `public/photos/` are used when that sample folder is absent. Posed family/reference portraits from `trip1` are intentionally excluded. The page makes no paid API calls. Clear the browser key `mosae-collage-review-v1` to reset reviews.

Regenerate the actual `<Collage>` stills and combined contact sheet with:

```sh
node packages/video/scripts/render-collage-stills.mjs
```

This runs `npx remotion still` for each layout and for the combined sheet at frame 80. It uses the trip samples when present, and falls back to the checked-in SVG artwork when those sample photos are unavailable.
