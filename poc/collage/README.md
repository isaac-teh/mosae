# Collage spike (throwaway)

A Remotion sketch of one collage form — photos as physical prints scattered on a
table — plus an end-to-end film that splices collages into a real `poc/gemini`
composition. Kept as evidence for the findings in `docs/ARCHITECTURE.md`.

Nothing here is wired into the app. It sits deliberately outside the npm
workspaces, so the repository's `npm run typecheck` and `npm test` ignore it.

## Run it

Remotion resolves from the repository root's hoisted `node_modules`, so there is
nothing to install here.

```sh
export PATH="/opt/homebrew/opt/node@22/bin:$PATH"
cd poc/collage
MEDIA="$(cd ../gemini/samples/trip && pwd)"

# a still, fully settled
npx remotion still src/root.tsx PhotoTable out/still.png \
  --frame=120 --props='{"seed":"gen-a"}' --public-dir="$MEDIA"

# the five-second landing
npx remotion render src/root.tsx PhotoTable out/six.mp4 \
  --props='{"seed":"gen-a"}' --public-dir="$MEDIA"

# the four-cell variant
npx remotion render src/root.tsx PhotoTable4 out/four.mp4 \
  --props='{"seed":"gen-a"}' --public-dir="$MEDIA"
```

`--public-dir` is required: a `remotion.config.ts` in this folder is not picked
up, because the CLI resolves its config against the entry point rather than the
working directory. `--props` accepts `seed`, `cardWidth` and `landingFrames`.

## The end-to-end film

`buildFilm.mjs` reads a `poc/gemini` run's `timeline.json` and `catalog.json`,
lays the clips out in time, and splices in one collage per place built from
photos that edit never used. `src/Film.tsx` renders the result: video with its
source trim and audio, stills with a slow push, collages, and the cuts,
crossfades and dips the composer chose.

```sh
node buildFilm.mjs --run gemini-3-5-flash-lite --set trip
npx remotion render src/root.tsx Film out/trip-film.mp4 --public-dir="$MEDIA"
```

The composer never specified transition lengths, so `buildFilm.mjs` picks them
once (0.6s crossfade, 0.8s dip) rather than leaving each clip to invent one.

This is not the `Timeline` contract. It is the POC's own clip shape, reshaped
just enough to watch; the real renderer is `packages/video/src/Timeline.tsx`.

## Checking the envelope

A seeded form is only safe if *every* seed stays on canvas, and the ambient
drift is part of the envelope: the wrapper scales and slides the whole table
after each card has been clamped. Render a sweep at the worst-drift frame and
count near-white pixels along each edge; anything above zero means a card is
bleeding off the frame.

```sh
for s in gen-a gen-b gen-c gen-d gen-e; do
  npx remotion still src/root.tsx PhotoTable4 "out/sweep-$s.png" \
    --frame=149 --props="{\"seed\":\"$s\"}" --public-dir="$MEDIA"
done

for f in out/sweep-*.png; do
  echo -n "$f  "
  for crop in "2:1920:0:0" "2:1920:1078:0" "1080:2:0:0" "1080:2:0:1918"; do
    ffmpeg -v error -i "$f" -vf "crop=$crop,format=gray" -f rawvideo - \
      | od -An -tu1 -v | tr -s ' ' '\n' | grep -v '^$' \
      | awk '$1>190{n++} END{printf "%d ", n+0}'
  done
  echo
done
```

This found a real bug on the four-cell layout that looking at the pictures did not.

## Files

| File | What it is |
|---|---|
| `src/PhotoTable.tsx` | The form: card, shadows, seeded scatter, landing, drift |
| `src/root.tsx` | Registers the film and the 6-cell and 4-cell collage compositions |
| `src/Film.tsx` | End-to-end film: clips, transitions, audio, collages |
| `buildFilm.mjs` | Turns a `poc/gemini` run into film props, splicing collages in |
