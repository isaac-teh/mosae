# Collage review gallery

Run from the repository root:

```sh
npm run gallery -w @mosae/video
```

Open `http://127.0.0.1:4178`. The page previews all 48 layout × motion combinations with `@remotion/player`. Choose an effect from the selector to preview it across the gallery. Keep, tweak, and block reviews are saved in this browser's `localStorage`; **Export JSON** downloads the current decisions in `docs/design/collage-review.json` shape. A tweak asks for a short note.

The gallery uses original abstract SVG placeholders checked into `public/photos/`; it does not use personal photos or call paid APIs. Clear the browser key `mosae-collage-review-v1` to reset reviews.
