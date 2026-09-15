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
```

`npm run all -- <set>` runs the same pipeline with defaults. Use `--model gemini-3.1-flash-lite` on analysis to create the comparison folder. Each API request is structured JSON, Zod-validated, token and cost logged in `out/<set>/<model>/calls.jsonl`; uploaded Files API videos are deleted after analysis.
