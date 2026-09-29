# Deploy Mosaé to Google Cloud

These scripts deploy one Firebase project per environment in `asia-southeast1`.
They create or update resources; they never delete a database, bucket, queue, or
service. Run from the repository root with Bash, `gcloud`, Node, and `npm ci`.
The scripts use the current `gcloud` and Firebase CLI login; the latter runs
from the repository's pinned `firebase-tools` package.

## First time

1. Create a Firebase project with billing enabled. Enable **Anonymous Auth** in
   Firebase Authentication. Initialize Cloud Firestore in Native mode and the
   default Firebase Storage bucket in `asia-southeast1`, or let `10-data.sh`
   create them. If they already exist, confirm their region is
   `asia-southeast1`; Google does not let these locations change later.
2. Install the Google Cloud CLI and sign in (`gcloud auth login`), then sign in
   to Firebase (`npx firebase login`). The operator needs permissions to enable
   APIs, manage IAM, Cloud Build, Run, Tasks, Eventarc, Firestore, Storage,
   Secret Manager, and deploy Firebase rules and Hosting.
3. Copy `deploy/env/example.env` to `deploy/env/dev.env` (or `prod.env`) and
   replace all example values. These two files are git ignored. Use the actual
   Firebase default bucket and Hosting origin. `EXPO_PUBLIC_*` Firebase values
   come from Firebase project settings and are public client configuration.
   Set `NOMINATIM_CONTACT` to an operator email or contact URL that identifies
   this deployment. Put **no secrets** in an env file.
4. Run `ENV=dev deploy/deploy.sh`. `20-secrets.sh` prompts on the terminal for
   `GEMINI_API_KEY` only; input is hidden and piped directly to Secret Manager.
   No secret value goes through command arguments or logs. A Google Maps key is
   not needed. To opt in later, use `USE_GOOGLE_MAPS=1` for both `20-secrets.sh`
   and `50-api.sh`; when that key is present, it takes precedence over Nominatim.
5. Run `ENV=dev deploy/smoke.sh`. Then manually upload `trip1-v2`, chat with
   the director, render, open the editor, save, and download the MP4. This
   checks the complete data path beyond the HTTP probes.

To update one component, run `ENV=dev deploy/deploy.sh --only api`, replacing
`api` with `bootstrap`, `data`, `secrets`, `queue`, `render`, `eventarc`, or
`web`. The API is public at Cloud Run's edge so clients can reach it, while
Firebase tokens guard user routes. Its `/tasks/*` and
`/events/storage-finalize` routes validate the invoker service account's
OIDC token. The render service is private; the API sends it an ID token. Cloud
Tasks and Eventarc use `mosae-tasks-invoker`. The API account can invoke render
and sign Storage URLs. The render account has no Storage access: it receives
signed read and upload URLs.

Place names come from OpenStreetMap's public Nominatim service. The API caches
results, including misses, in Firestore `placeCache` by coordinates rounded to
three decimals. Requests are queued one second apart per API process; the
deployment caps the API at one instance to respect Nominatim's [one request per
second application limit](https://operations.osmfoundation.org/policies/nominatim/).
Do not increase that instance cap without a distributed limiter or a different
geocoding provider. Nominatim may withdraw public API access, so the provider
remains selectable without updating the client. The Saved screen credits
[© OpenStreetMap contributors](https://www.openstreetmap.org/copyright); OSM
data is licensed under ODbL. Only public place or city names are stored on
assets—never house numbers, roads, or postcodes.

`DRY_RUN=1 ENV=dev deploy/deploy.sh` prints the commands and uses illustrative
URLs and a project number where discovery would need GCP. It does not contact
GCP or prompt for secrets. Run the same prefix with `deploy/smoke.sh` to print
the HTTP checks. A real smoke run requires `/health` and Hosting to return
success, an unauthenticated task to return 401, and render `/health` to return
401 or 403 from Cloud Run.

## Dry-run verification (2026-09-29)

With a temporary `dev.env` copied from `example.env`, `shellcheck -x
deploy/*.sh` passed. `DRY_RUN=1 ENV=dev deploy/deploy.sh` exited 0 and printed
56 lines covering API enablement, three service accounts and IAM, Firestore,
Storage CORS and rules, six music uploads, one hidden secret prompt, Tasks,
both Cloud Build images and Run services, Eventarc, and Hosting.
`DRY_RUN=1 ENV=dev deploy/smoke.sh` exited 0 and printed 8 lines for the four
HTTP probes and the manual flow. Example IDs and URLs only were used; no real
GCP project was touched.

## Why our own render service vs @remotion/cloudrun

Remotion's official [`@remotion/cloudrun` overview](https://www.remotion.dev/docs/cloudrun)
calls the package experimental and in alpha. Its [status page](https://www.remotion.dev/docs/cloudrun/status)
says critical bugs are fixed, but it is not actively developed or marked
production ready. It deploys a Remotion runtime image, stores the project as a
website in Cloud Storage, invokes Cloud Run to render it, and uploads the
result to Storage. The [standard Remotion license](https://www.remotion.dev/docs/cloudrun#license)
applies, with Cloud Rendering Units for companies that need a paid license;
Cloud Run compute is billed separately. Check the license shipped with our
pinned Remotion 4.x version before changing versions.

Our `mosae-render` service already bundles the composition once per process,
accepts signed source URLs, streams progress to the API, and uploads through a
signed PUT URL. That directly matches Mosaé's Tasks, Firestore progress, and
private service authentication. **Recommendation: keep our service.** Moving
to `@remotion/cloudrun` would require replacing those integrations, and its
current alpha status offers no clear gain for this deployment.
