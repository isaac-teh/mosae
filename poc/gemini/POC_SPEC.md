# Gemini Media Understanding PoC

Throwaway spike.
Question it answers: can Gemini Lite models turn a messy folder of photos and videos into a trustworthy shot catalog, a story proposal, and a validated edit cut list, and what does it cost?
Product context: `docs/superpowers/specs/2026-09-14-media-understanding-design.md` (stages 1, 2, 3a, 3b). Read its sections on shot analysis, StoryProposal, and Timeline for field ideas, but this PoC is standalone and must not import from `apps/` or `services/`.

## Constraints

- Location: everything under `poc/gemini/`. Standalone npm package (`poc/gemini/package.json`), not a root workspace. TypeScript run with `tsx`. Node 22 (`export PATH="/opt/homebrew/opt/node@22/bin:$PATH"`).
- SDK: official `@google/genai` (latest). Auth: `GEMINI_API_KEY` from the repo root `.env` (load with `--env-file=../../.env`). Never print or log the key.
- Structured output: use `responseMimeType: "application/json"` with `responseSchema` (or `responseJsonSchema`) on every generation call, and validate every response with `zod`. On validation failure retry once, then record the failure.
- Models are config, not code: `config.ts` maps stage to model id. Defaults:
  - analyze: `gemini-3.5-flash-lite`
  - analyzeCompare: `gemini-3.1-flash-lite`
  - story: `gemini-3.5-flash-lite`
  - compose: `gemini-3.5-flash-lite`
  - embed: `gemini-embedding-2` (text only)
  Every script accepts `--model <id>` to override, so a stage can be rerun on another model.
- Cost controls: video `mediaResolution` LOW; thinking set to the lowest level the model allows for analysis; compact output schemas; no batch API.
- Cost logging: every API call appends one JSON line to `out/<run>/calls.jsonl` with stage, model, file, promptTokens, candidatesTokens, thoughtsTokens, totalTokens, latencyMs, estimatedUsd. Prices per 1M tokens (standard, paid tier) in `config.ts`:
  - gemini-3.5-flash-lite: input 0.30, output 2.50
  - gemini-3.1-flash-lite: input 0.25 (audio 0.50), output 1.50
  - gemini-3.8-flash: input 0.75, output 3.75
  - gemini-3.1-pro-preview: input 2.00 (4.00 over 200k prompt), output 12.00 (18.00 over 200k)
  - gemini-embedding-2: text 0.20
  Thinking tokens bill as output.
- Uploads: videos go through the Files API (wait for ACTIVE state; delete remote files at the end of a run). Photos may be sent inline as bytes.
- Concurrency limit 4 for analysis calls, with exponential backoff on 429/5xx.
- No em dash characters anywhere. Commit locally only, never push, no Co-Authored-By or agent name in commits. `samples/` and `out/` stay git-ignored.

## Inputs

- `samples/trip/` 41 photos + 10 videos, filenames `dNN-place-...`; EXIF/QuickTime capture time and GPS are synthetic but real tags. Includes `*-blurry.jpg` and `*-burst2/3.jpg` variants.
- `samples/creator/` `aroll-1..7.mp4` (talking to camera with speech) and Pexels B-roll `video-*.mp4`.
- `SOURCES.md` lists provenance.

## Pipeline (one script per step, each reads the previous step's JSON)

Run layout: `out/<set>/<model-slug>/...` so model comparisons sit side by side.

1. `01-ingest.ts <set>`: local only, no Gemini. For each file: kind, capture time (exiftool via `exiftool-vendored` or the installed `exiftool` CLI), GPS, dimensions, duration (ffprobe), sharpness score (variance of Laplacian on a downscaled grayscale frame, via ffmpeg or `sharp`), perceptual hash (dHash). Flag `blurry` below a threshold you calibrate on the samples and `duplicateOf` for near-identical hashes within 10 seconds. Output `ingest.json`. Excluded files are not sent to Gemini.
2. `02-analyze.ts <set> [--model]`: one call per kept file. Output per file:
   - photos: caption, subjects (people count, roles like child/adult, visible attributes that help re-identify the same person across shots, no names), setting, activities, emotion/mood, shotType (wide/medium/close/detail), aesthetics 1-5, keyMomentScore 1-5, tags.
   - videos: shots[] with startSec, endSec, shotType, camera (static/pan/handheld/drone...), role (A_ROLL speech-to-camera or B_ROLL), description, subjects, emotion, quality 1-5, usable flag with reason, plus transcript segments with startSec/endSec/text for any speech, and bestMomentSec.
   Output `analysis/<file>.json` and a merged `analysis.json`.
3. `03-catalog.ts <set>`: local only. Merge ingest + analysis into a chronological catalog grouped by day and place (cluster GPS within 2km, split days by local date), with compact per-item text lines suitable as LLM context. Also embed each item's text description with `gemini-embedding-2` and write `catalog.json` + `embeddings.json`, plus a similarity sanity check printing the 3 nearest neighbours for 5 items.
4. `04-story.ts <set> "<intent>" [--model]`: bounded story planner. Input: catalog text plus the user intent. Output StoryProposal: title, logline, targetDurationSec, chapters[] (title, purpose, itemIds with reasons), openingItemId, closingItemId, musicMood, excludedHighlights with reasons, and open questions for the user (e.g. who are key people). Every referenced id must exist in the catalog (validate in code).
   Default intents: trip "This was our first family trip to Japan for my daughter's birthday. Focus on moments of her having fun, the food we tried, and the quiet places we explored together." Target 90s. Creator: "Make a 60 second reel about a day of work, talking head as the spine with B-roll cutaways." Target 60s.
5. `05-compose.ts <set> [--model]`: structured cut list from proposal + catalog. Output Timeline: clips[] with itemId, sourceInSec, sourceOutSec (videos) or holdSec (photos), order, transition (cut/crossfade/dip), textOverlay optional, audio (keep/duck/mute), plus musicCues. Validate in code: ids exist, in/out within the real duration and within an analyzed shot, no zero or negative lengths, photo holds 1.5-5s, total duration within 10% of target, A_ROLL speech not cut mid-transcript-segment. Write `timeline.json` and `validation.json` (pass/fail with reasons). If validation fails, send the errors back to the model once for a repair attempt and record both attempts.
6. `06-preview.ts <set>`: render a rough preview MP4 of the timeline with ffmpeg (720p, simple cuts or crossfades, photos as held frames, no music) to `out/<set>/<model>/preview.mp4`, so a human can judge the edit.
7. `07-report.ts`: markdown report `out/REPORT.md` covering, per set and model: files kept/excluded and why, cost and tokens per stage and per minute of video, latency, validation results, and a side-by-side of `gemini-3.5-flash-lite` vs `gemini-3.1-flash-lite` analysis on the same files (shot counts, A/B-roll agreement, timestamps disagreeing by more than 1s).

Also add `npm run all -- <set>` running steps 1-7 with defaults, and `README.md` with setup and commands.

## Acceptance

- Both sets run end to end with the default models; analysis also runs with the compare model.
- `validation.json` passes for both sets (after at most one repair).
- Both `preview.mp4` files play and roughly follow the proposal.
- `out/REPORT.md` exists with real token and cost numbers.
- Blurry and burst duplicates are excluded by ingest.
- Typecheck (`tsc --noEmit`) clean.
- A short findings section in `out/REPORT.md`: where Lite was weak or strong, with concrete examples (file and field), and a recommendation per stage (stay Lite, or move up).
