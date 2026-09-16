# Mosaé

Mosaé turns a messy album of photos and videos into a directed story film.
You pick your memories, tell the AI what the story is about, review the moments it curated, direct the film, and save it.

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
