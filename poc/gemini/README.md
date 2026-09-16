# Gemini media understanding PoC

Requires Node 22, ffmpeg, ffprobe, exiftool, and `GEMINI_API_KEY` in the repository-root `.env`.

```sh
export PATH="/opt/homebrew/opt/node@22/bin:$PATH"
cd poc/gemini
npm install
node --env-file=../../.env node_modules/.bin/tsx 01-ingest.ts trip
node --env-file=../../.env node_modules/.bin/tsx 02-analyze.ts trip
node --env-file=../../.env node_modules/.bin/tsx 03-catalog.ts trip
node --env-file=../../.env node_modules/.bin/tsx 04-story.ts trip
node --env-file=../../.env node_modules/.bin/tsx 05-compose.ts trip
node --env-file=../../.env node_modules/.bin/tsx 06-preview.ts trip
node --env-file=../../.env node_modules/.bin/tsx 07-report.ts
node --env-file=../../.env node_modules/.bin/tsx 09-segments.ts trip
npm run explore
```

`npm run all -- <set>` runs the same pipeline with defaults. Use `--model gemini-3.1-flash-lite` on analysis to create the comparison folder. Each API request is structured JSON, Zod-validated, token and cost logged in `out/<set>/<model>/calls.jsonl`; uploaded Files API videos are deleted after analysis.

## Explorer

After cataloging a set, build the finer shot and transcript index once per set. Existing unchanged entries in `segments.json` are reused, so repeated runs do not embed them again.

```sh
node --env-file=../../.env node_modules/.bin/tsx 09-segments.ts trip
node --env-file=../../.env node_modules/.bin/tsx 09-segments.ts creator
npm run explore
```

Open `http://localhost:4000`. The explorer embeds searches on the server and serves seekable local media, so the API key never reaches the browser. Try `girl eating something sweet` on `trip`, or `typing on a laptop` on `creator`; filters narrow results by entry kind, media kind, and day.
