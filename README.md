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
The Storage emulator emits no finalize events, so after uploading run `npm run replay:finalize -w services/api` to mark uploads as accepted.

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

After an upload finalizes, Mosaé creates an asset and queues `/tasks/ingest` for that asset. Ingest reads the original, then writes its results before marking the asset ingested. Once every closed upload session has no pending entries and every asset has either ingested or failed, the project settles and queues `/tasks/cluster` to build events and find near-duplicates.

| Stage | Result |
| --- | --- |
| Finalize | Accepts the original upload, records an `uploaded` asset, and queues `/tasks/ingest`. |
| Ingest | Records media facts and quality, creates a thumbnail plus a photo render copy or video proxy, and creates video shots. |
| Settle and cluster | Waits for all uploads to finish, then queues `/tasks/cluster` to create events and link near-duplicate photos. |

Derivatives live under `proxies/{userId}/{projectId}/{assetId}/{generation}/`. Photos get `thumb.jpg` and `render.jpg`; videos get a poster `thumb.jpg`, a 360p `proxy.mp4`, and shot records. Every asset also gets media facts and quality facts, including `quality.dHash` for near-duplicate detection.

| Project status | Trigger |
| --- | --- |
| `collecting` | A project is created. |
| `processing` | Its first original upload is accepted at finalize. |
| `ready` | All sessions are closed, no entries are pending, and every asset has ingested. |
| `ready_with_errors` | The project has settled with at least one ingested asset and at least one failed asset. |
| `failed` | The project has settled but no asset ingested. |

Inspect a local project document through the Firestore emulator REST endpoint:

```bash
curl -s "http://127.0.0.1:8085/v1/projects/demo-mosae/databases/(default)/documents/projects/<projectId>"
```

Ingest requires `ffmpeg` and `ffprobe` on `PATH`; the container also needs `heif-convert` on `PATH` for HEIC conversion. `GET /health` reports the availability of `ffmpeg`, `ffprobe`, and `exiftool`.

### Operational limits

- Originals up to 2 GiB are ingested. Larger uploads are accepted, but their asset fails with `too_large_for_ingest` because Cloud Run temporary storage is memory-backed and each original is downloaded whole. A streaming path is the fix.
- Ingest is CPU and memory heavy. Deploy the API service with at least 4 GiB and set the Cloud Tasks queue's `maxConcurrentDispatches` low, starting at 4, so a 1,500-file upload does not exhaust a single instance.
- HEIC needs `heif-convert` from `libheif-examples`, which is installed in the container. On a machine without it, a HEVC HEIC asset fails with `unsupported_image`.
- Reverse geocoding of places is not implemented, so `places` on the project stays empty.
- Progress polling costs two count aggregations and one read every two seconds per open Tell AI the Story screen.

### The story flow

`/` → `/pick-memory` → `/tell-story` → `/review-moments` → `/curated-timeline` → `/create` → `/direct-film` → `/review-film` → `/save-film`

From Tell AI the Story onward the screens use the Figma example data (`createFixtureStoryRepository` in `packages/core`) until the API serves proposals, revisions and renders.
Those screens need no emulators or API, so you can open one directly, for example http://localhost:8081/review-moments?planId=demo or http://localhost:8081/review-film?filmId=demo-film.

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
