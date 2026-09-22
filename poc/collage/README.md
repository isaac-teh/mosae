# Collage spike (throwaway)

A Remotion sketch of one collage form: photos as physical prints scattered on a
table. It answered three questions and is kept only as evidence for them; the
findings that outlive the code are in `docs/ARCHITECTURE.md`.

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
| `src/root.tsx` | Registers the 6-cell and 4-cell compositions |
