# Mosaé

Mosaé turns a messy album of photos and videos into a directed story film.
You pick your memories, tell the AI what the story is about, review the moments it curated, direct the film, and save it.

## Quick start

```bash
npm install
```

Only want to see the story to film screens?
Start the web app and open a scene; no emulators or API needed:

```bash
npm run dev:web
# open http://localhost:8081/tell-story?projectId=p1&count=3
```

Full app including uploads, in three terminals (details in [Run everything locally](#run-everything-locally)):

```bash
# Terminal 1: Firebase emulators
export JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home
npx firebase emulators:start --only firestore,auth,storage --project demo-mosae

# Terminal 2: API on http://localhost:8080
FIREBASE_PROJECT_ID=demo-mosae FIREBASE_CLIENT_EMAIL= FIREBASE_PRIVATE_KEY= \
FIRESTORE_EMULATOR_HOST=127.0.0.1:8085 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 \
FIREBASE_STORAGE_EMULATOR_HOST=127.0.0.1:9199 FIREBASE_STORAGE_BUCKET=demo-mosae.appspot.com \
ALLOWED_ORIGINS=http://localhost:8081 SERVICE_URL=http://localhost:8080 PORT=8080 \
npm run dev:api

# Terminal 3: web app on http://localhost:8081
# (first time: create apps/client/.env.development.local, see step 3 below)
npm run dev:web
```

Stop each with Ctrl+C.

## Repository layout

| Path | What it is |
|------|------------|
| `apps/client` | Expo (React Native) app, web first, built with Expo Router and NativeWind |
| `packages/core` | Shared client logic: Firebase auth, uploads, API client, story repository |
| `services/api` | Express API for uploads, curation and background tasks (Cloud Run in production) |
| `e2e` | Playwright pixel parity and end-to-end tests |
| `poc/gemini` | Standalone Gemini media understanding proof of concept |
| `docs` | Specs, plans, backlog and Figma reference exports |

## Prerequisites

- Node 22: `export PATH="/opt/homebrew/opt/node@22/bin:$PATH"`
- Java 21 for the Firebase emulators: `export JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home`
- Firebase CLI (`npm i -g firebase-tools`, or use `npx firebase`)
- Install dependencies once from the repo root: `npm install`

## Run everything locally

Local development runs against the Firebase emulators, so no real Firebase project or keys are needed.
Use three terminals from the repo root.

### 1. Firebase emulators

```bash
export JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home
npx firebase emulators:start --only firestore,auth,storage --project demo-mosae
```

Auth runs on 9099, Firestore on 8085 and Storage on 9199.
Wait for "All emulators ready".

### 2. API (port 8080)

`services/api/.env` holds your own settings (for example `GEMINI_API_KEY`); copy it from `services/api/.env.example` the first time.
Point the API at the emulators with environment variables, which take precedence over `.env`:

```bash
FIREBASE_PROJECT_ID=demo-mosae FIREBASE_CLIENT_EMAIL= FIREBASE_PRIVATE_KEY= \
FIRESTORE_EMULATOR_HOST=127.0.0.1:8085 \
FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 \
FIREBASE_STORAGE_EMULATOR_HOST=127.0.0.1:9199 \
FIREBASE_STORAGE_BUCKET=demo-mosae.appspot.com \
ALLOWED_ORIGINS=http://localhost:8081 SERVICE_URL=http://localhost:8080 PORT=8080 \
npm run dev:api
```

Wait for "Mosaé API listening on port 8080".
The Storage emulator emits no finalize events, so this setup (no `TASKS_*` env vars, not production, both emulator hosts set) also starts a dev-only task runner: it polls the emulator for new uploads, replays finalize itself, and runs ingest, understand and cluster in-process instead of delivering them to Cloud Tasks. A watch for "Cloud Tasks not configured; running tasks in-process and polling the Storage emulator" at startup confirms it's on. Uploads become assets, then thumbnails, shots and events, within a few seconds with no manual step. If you ever need the one-shot version instead (for example, replaying uploads after restarting the API without the poller), run `npm run replay:finalize -w services/api`.

### 3. Web app (port 8081)

Create `apps/client/.env.development.local` once (it is git-ignored and overrides `.env.local`):

```bash
EXPO_PUBLIC_USE_EMULATORS=true
EXPO_PUBLIC_API_BASE_URL=http://localhost:8080
EXPO_PUBLIC_FIREBASE_API_KEY=AIzaSyDemoMosaeEmulatorKey000000000000000
EXPO_PUBLIC_FIREBASE_PROJECT_ID=demo-mosae
EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET=demo-mosae.appspot.com
```

Then start the app:

```bash
npm run dev:web
```

Open http://localhost:8081 and use a phone-width window (the layout is capped at 430px).
If you change an env file, restart with `npm run web -w apps/client -- --clear` so the new values are bundled.

## Ingest pipeline

After an upload finalizes, Mosaé creates an asset and queues `/tasks/ingest` for that asset. Ingest reads the original, then writes its results before marking the asset ingested. Once every closed upload session has no pending entries and every asset has either understood or failed, the project settles and queues `/tasks/cluster` to build events and find near-duplicates.
The project pass is guarded by a 5 minute lease and publishes the project status last.

| Stage | Result |
| --- | --- |
| Finalize | Accepts the original upload, records an `uploaded` asset, and queues `/tasks/ingest`. |
| Ingest | Records media facts and quality, creates a thumbnail plus a photo render copy or video proxy, and creates shots. |
| Understand | Uses Gemini once per asset to analyze its shots and create search embeddings, then marks the asset `understood`. |
| Settle and cluster | Waits for all uploads to finish, then queues `/tasks/cluster` to create events and link near-duplicate photos. |

Derivatives live under `proxies/{userId}/{projectId}/{assetId}/{generation}/`. Photos get `thumb.jpg` and `render.jpg`; videos get a poster `thumb.jpg` and a 360p `proxy.mp4`. Every asset also gets media facts and quality facts, including `quality.dHash` for near-duplicate detection. Every photo gets exactly one shot with no source interval: `sourceStartSec` and `sourceEndSec` are `null`. Every video gets one shot per detected scene, with `sourceStartSec` and `sourceEndSec` in the original video's timebase. Shot IDs are deterministic: `{assetId}_{index padded to 4 digits}`.

Understanding analyzes the photo or all known video shots in one Gemini request per asset, stores a search embedding per non-empty shot description, and records a transcript only for videos. Readiness waits for this stage, rather than merely waiting for ingest.

| Project status | Trigger |
| --- | --- |
| `collecting` | A project is created. |
| `processing` | Its first original upload is accepted at finalize. |
| `ready` | All sessions are closed, no entries are pending, and every asset has understood. |
| `ready_with_errors` | The project has settled with at least one understood asset and at least one failed asset. |
| `failed` | The project has settled but no asset understood. |

Inspect a local project through the Firestore emulator REST endpoint.
The security rules deny unauthenticated reads, so send the emulator's admin header (`Authorization: Bearer owner`), or the call returns `PERMISSION_DENIED`:

```bash
BASE="http://127.0.0.1:8085/v1/projects/demo-mosae/databases/(default)/documents/projects"
curl -s -H "Authorization: Bearer owner" "$BASE/<projectId>"          # status, eventCount, dateRange
curl -s -H "Authorization: Bearer owner" "$BASE/<projectId>/assets"   # per-asset status, media, quality, derivatives
curl -s -H "Authorization: Bearer owner" "$BASE/<projectId>/events"   # day and event clusters
```

Phase 2 also exposes shot search at `GET /api/projects/:projectId/shots/search?q=...`. Unlike the Firestore emulator's `Bearer owner` bypass above, this API requires a real Firebase Auth emulator ID token:

```bash
curl -s -H "Authorization: Bearer <firebase-auth-emulator-id-token>" \
  "http://localhost:8080/api/projects/<projectId>/shots/search?q=beach"
```

Ingest requires `ffmpeg` and `ffprobe` on `PATH`; the container also needs `heif-convert` on `PATH` for HEIC conversion. `GET /health` reports the availability of `ffmpeg`, `ffprobe`, and `exiftool`.

## Directing pipeline

When a project is `ready` or `ready_with_errors`, Tell AI the Story creates a versioned story intent and queues a bounded planning job. The planner can search eligible, understood shots, inspect their details, and read video transcripts. It returns a draft `StoryProposal` made from literal project shot IDs; it cannot accept a proposal or start composition.

| Stage | Result |
| --- | --- |
| Story intent | `storyIntents` records the user's text and focus. A `jobs` record is queued for planning; a project still processing waits until it is ready. |
| Plan | The planner searches and inspects project media, then writes a versioned draft to `storyProposals`. The job records progress (`searching`, `inspecting`, or `organizing`), bounded usage, and any diagnostics. |
| Review | Selecting or deselecting moments clones a new draft with updated constraints and no model call. Written feedback queues a new plan job. |
| Accept | Accepting the current proposal changes its state to `accepted` and records `acceptedProposalId` on the project. From there, posting a generation composes a film — see [Compose and render pipeline](#compose-and-render-pipeline). |

The relevant collections live below `projects/{projectId}`: `storyIntents`, `storyProposals`, and `jobs`; `shots`, `assets`, and `events` remain the read-only media context for a proposal. Inspect a local proposal with the Firestore emulator REST endpoint using the admin header:

```bash
BASE="http://127.0.0.1:8085/v1/projects/demo-mosae/databases/(default)/documents/projects/<projectId>"
curl -s -H "Authorization: Bearer owner" "$BASE/storyIntents"                 # story text and focus
curl -s -H "Authorization: Bearer owner" "$BASE/jobs"                         # plan status, progress, usage and diagnostics
curl -s -H "Authorization: Bearer owner" "$BASE/storyProposals"               # draft or accepted proposal versions
curl -s -H "Authorization: Bearer owner" "$BASE/storyProposals/<proposalId>"  # one proposal's moments and chapters
```

### Operational limits

- Originals up to 2 GiB are ingested. Larger uploads are accepted, but their asset fails with `too_large_for_ingest` because Cloud Run temporary storage is memory-backed and each original is downloaded whole. A streaming path is the fix.
- An asset whose processing keeps failing for environmental reasons is failed with reason `retries_exhausted` after 5 attempts.
- A missing or invalid `GEMINI_API_KEY` fails an understand or a compose task with a clear reason; it never prevents the API from booting. The Gemini client is constructed only once work begins, never at boot.
- A compose task is retried at most 3 times. On the third, the generation is failed with `exceeded 3 compose attempts` rather than being redelivered forever. A failed composition is a settled outcome, so `/tasks/compose` answers 204, not 500 — a 500 would ask Cloud Tasks to retry work that is already recorded.
- Composition fails rather than producing a film the user did not ask for: if every pick is dropped, or one deterministic repair pass cannot fix validation, the generation is `failed` and the previous playable film stays current.
- A render task is retried at most 3 times. Every failed render — an unreachable render service, a render error, a source that will not resolve, retries exhausted — puts the generation **back to `playable`** with the reason on `failureReasons`, so the film the user already had keeps working and Save can be pressed again. A render left stuck at `rendering` could never be retried, because `startRender` accepts only a `playable` film.
- The dev task runner runs `/tasks/render` in process against `RENDER_SERVICE_URL`, which defaults to `http://127.0.0.1:8081`. `services/render` must be running for a local save to finish.
- `RENDER_SERVICE_URL` is required in production. Without it, saving a film queues a task that can reach nothing.
- Render progress is written to the generation at most once a second **and** once per 5% moved, plus the final 1.0. A five-minute film is 9,000 frames and Remotion reports every one; unthrottled that is 9,000 Firestore writes per render.
- The Cloud Tasks queue must allow at least 6 attempts (`maxAttempts`) so that conversion can happen before the queue gives up.
- Ingest is CPU and memory heavy. Deploy the API service with at least 4 GiB and set the Cloud Tasks queue's `maxConcurrentDispatches` low, starting at 4, so a 1,500-file upload does not exhaust a single instance.
- HEIC needs `heif-convert` from `libheif-examples`, which is installed in the container. On a machine without it, a HEVC HEIC asset fails with `unsupported_image`.
- Reverse geocoding of places is not implemented, so `places` on the project stays empty.
- Progress polling costs two count aggregations and one read every two seconds per open Tell AI the Story screen.
- Thumbnail URLs are V4-signed by the API (`firebaseThumbnailUrlStore` in `services/api/src/ingest/objectStore.ts`). On Cloud Run the runtime service account has application default credentials with no embedded private key, so signing calls the IAM `signBlob` API and the runtime service account needs `roles/iam.serviceAccountTokenCreator` **on itself**. Without it every thumbnail request fails with `iam.serviceAccounts.signBlob` denied. There is no Terraform or deploy script in this repository yet, so this must be granted by hand:

  ```bash
  gcloud iam service-accounts add-iam-policy-binding "$RUNTIME_SA" \
    --member="serviceAccount:$RUNTIME_SA" --role="roles/iam.serviceAccountTokenCreator"
  ```

  Review moments degrades one card per unsignable thumbnail rather than failing the screen, so a missing binding shows up as blank images, not an error page.

### The story flow

`/` → `/pick-memory` → `/tell-story` → `/review-moments` → `/curated-timeline` → `/create` → `/direct-film` → `/review-film` → `/save-film`

From Tell AI the Story onward the screens use the Figma example data (`createFixtureStoryRepository` in `packages/core`) until the API serves proposals, revisions and renders.
Those screens need no emulators or API, so you can open one directly, for example http://localhost:8081/review-moments?planId=demo or http://localhost:8081/review-film?filmId=demo-film.

## Compose and render pipeline

Accepting a proposal does not make a film. Posting a generation does. `POST /api/projects/:id/generations` pins the accepted proposal, the `DirectionSettings` and a `seed`, writes the generation as `composing`, and queues `/tasks/compose`. Composition is **one structured Gemini call**, not an agent loop: code builds every legal clip and hands the model a closed set to arrange, so the model never invents a timestamp.

| Stage | Result |
| --- | --- |
| Candidates | Code emits every legal clip per chapter. A photo yields one candidate with a hold range from the cadence; a video yields ranges that sit inside one shot and never begin or end mid-sentence. Arithmetic, not taste. |
| Composer call | One structured call returns, per clip, a `candidateId`, an optional hold, a transition of `cut`/`crossfade`/`dip`, an optional text overlay and an audio treatment — plus music cues. It never sees a file path or a storage URL. |
| Assemble | Drops what it cannot use rather than trusting it: an unknown `candidateId`, the same candidate twice, more than three clips from one source, the same still twice running. Drops are recorded on the generation; they are not failures. |
| Fit and reflow | Code fits the film to within 10% of `DURATION_SECONDS[durationId]`, quantizes every start and duration to a 30fps frame boundary, resolves crossfade overlaps into absolute `startSec`, and recomputes chapter starts. Reflow is a pure function in `@mosae/contracts`, shared so that direct editing can reuse it. |
| Audio | Added after reflow, against the final geometry. Speech keeps its own audio, ambient is ducked, and a soundtrack becomes one music clip with fades. `soundtrackId: null` is a valid film: it simply plays its own sound. |
| Validate | `safeParseTimeline` plus semantic rules — every shot belongs to a moment the user kept, every range sits inside its shot, clips are contiguous, every id resolves. On failure, **one** deterministic repair pass, no model call. A second pass would be a loop in disguise. |
| Render | `POST /api/projects/:id/generations/:gid/render` resolves each id to an original file and queues `/tasks/render`. That task signs a read URL per source and a PUT URL for `renders/{userId}/{projectId}/{generationId}.mp4`, hands the timeline to `mosae-render`, and reads back a stream of progress; the render service uploads the finished MP4 itself, so it holds no storage credentials. A soundtrack id resolves only when a soundtrack library exists — until then a scored film renders without its score rather than being rejected. |

One composition is meant to drive both hosts. `packages/video/src/timelineMetadata.ts` already types the render props as `{ timeline, sources }`, which is exactly what `@remotion/player` will need on the Review screen, so the preview and the download read the same film with no adapter between them. That holds only while composition is a pure function of its inputs, and `services/api/src/compose/golden.test.ts` is what holds it: one fixed proposal and one recorded model response must reproduce `golden/timeline.json` byte for byte. The Player itself arrives with the Direct, Review and Save screens, which are planned separately.

| Generation status | Meaning |
| --- | --- |
| `composing` | Queued or running. The film does not exist yet. |
| `playable` | A validated `Timeline` is on the generation and the Player can show it. No server render has happened. |
| `rendering` | A render is running; `renderProgress` moves from 0 to 1. |
| `saved` | The MP4 exists at `outputPath` and `GET .../download` returns a signed URL for it. |
| `failed` | `failureReasons` says why. |

The project document carries three pointers. `latestRequestedGenerationId` moves the moment a generation is asked for, whatever becomes of it. `currentPlayableGenerationId` moves only when a film publishes, and `savedGenerationId` only when a render completes. **A failed generation moves neither of the last two**, so a revision that fails leaves the user the film that worked.

Changing cadence, soundtrack, duration, aspect, captions or the directing note recomposes from the same accepted proposal — one composition, no planning. Changing *which moments are in the film* is a planning change and goes back to review. Which endpoint the client calls decides this; no model classifies the request.

Inspect a local generation through the Firestore emulator REST endpoint, with the same admin header the sections above use:

```bash
BASE="http://127.0.0.1:8085/v1/projects/demo-mosae/databases/(default)/documents/projects/<projectId>"
curl -s -H "Authorization: Bearer owner" "$BASE"                                # the three generation pointers
curl -s -H "Authorization: Bearer owner" "$BASE/generations"                    # every attempt, with status and failureReasons
curl -s -H "Authorization: Bearer owner" "$BASE/generations/<generationId>"     # one generation's embedded Timeline, droppedPicks, outputPath
curl -s -H "Authorization: Bearer owner" "$BASE/taskOutbox"                     # whether compose or render was queued and delivered
curl -s -H "Authorization: Bearer owner" "${BASE%/projects/*}/geminiUsage"      # per-call tokens and estimated USD, stage "compose"
```

A generation's `timeline` is a deeply nested Firestore document, so the REST reply is verbose; `| python3 -m json.tool` or `jq` is worth the keystrokes. The emulator's `Bearer owner` bypass reads what the security rules would otherwise deny — the rules allow the owner to read `generations` and deny all client writes.

## Checks

```bash
npm run typecheck
npm run lint
npm test
```

End-to-end tests run from `e2e` against the web app on port 8081:

| Command | Needs | What it checks |
|---------|-------|----------------|
| `npm run parity -w e2e` | web app | Pixel parity of every screen against `e2e/baseline` |
| `npm run figma-parity -w e2e` | web app | Pixel parity against Figma exports in `e2e/baseline/figma` (skips screens without an export) |
| `npm run screens -w e2e` | web app | Per-screen interactions |
| `npm run story-flow -w e2e` | web app | Story intent through to a downloaded film |
| `npm run flow -w e2e` | web app, emulators, API | Picking and uploading media through to the story step |

Firestore and Storage store tests run inside the emulators with `npm run test:emulator -w services/api`.

## Gemini proof of concept

`poc/gemini` is a standalone package with its own setup and commands; see `poc/gemini/README.md` and `poc/gemini/POC_SPEC.md`.

### Compose live-run record

**Blocked, 2026-09-24.** The Phase 4 task 14 live Gemini composition and render of the `trip` sample set was not made: `GEMINI_API_KEY` is unavailable in the process environment and in the repository-root `.env`, exactly as in Phase 3. No API request was sent, no generation was composed from real content, and no charge was incurred, so there is no cost to log and no film to watch end to end. The whole compose pipeline is covered by mocked and recorded-response tests, including the byte-identical golden timeline; what remains unverified is only what a live model actually picks, and whether the resulting film is watchable with its audio and transitions. When a key is available, run one composition on the `trip` set, watch the rendered MP4 whole — not through a `-c copy -an` preview — and record the estimated cost, which production composition writes to the project's `geminiUsage` collection under stage `compose`.

### Directing live-run record

The Phase 3 manual `trip`-sample Gemini run was not made on 2026-09-23: `GEMINI_API_KEY` was unavailable in both the process environment and the repository-root `.env`. No API request, proposal, or charge was created. When a key is available, the production planner records estimated per-turn cost in the project's `geminiUsage` collection; the PoC writes equivalent call records to `poc/gemini/out/<set>/<model>/calls.jsonl`.
