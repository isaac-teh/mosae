# Mosaé video spike

This workspace proves the execution half of Mosaé’s proposed film pipeline: a
typed edit decision list is translated into a deterministic, frame-accurate
Remotion composition and rendered as an MP4.

```sh
npm run studio -w @mosae/video
npm run render -w @mosae/video
```

`src/edit.ts` is the hand-authored decision list. It contains two trimmed video
segments, two photo holds with slow zoom, two 12-frame crossfades, and a hard
cut. The video uses the existing app demo assets through `remotion.config.ts`,
so the spike introduces no copied media.

`src/Film.tsx` is deliberately generic: it executes clips and an optional
soundtrack with fade-in/out values from the decision list. The current fixture
does not specify a soundtrack because the checked-in demo MP4 has no audio and
the repository has no licensed music asset. Adding a licensed track to the
project is enough to exercise that already-wired path.

The next integration step is to make the AI composer produce this constrained
schema, validate it against analysed shot boundaries, and send only a valid
decision list to the renderer.
