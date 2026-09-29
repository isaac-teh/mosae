#!/usr/bin/env bash
set -euo pipefail
# shellcheck source=deploy/lib.sh
source "$(dirname "$0")/lib.sh"
assert_command gcloud
assert_command npx

if ! probe gcloud firestore databases describe --database='(default)' --project "$PROJECT_ID"; then
  run gcloud firestore databases create --database='(default)' --location "$REGION" --type=firestore-native --project "$PROJECT_ID"
else
  firestore_region="$(capture "$REGION" gcloud firestore databases describe --database='(default)' --project "$PROJECT_ID" --format='value(locationId)')"
  [[ "$(printf '%s' "$firestore_region" | tr '[:upper:]' '[:lower:]')" == "$REGION" ]] || { echo "Firestore is in $firestore_region, expected $REGION" >&2; exit 2; }
fi
if ! probe gcloud storage buckets describe "gs://$BUCKET" --project "$PROJECT_ID"; then
  run gcloud storage buckets create "gs://$BUCKET" --location "$REGION" --project "$PROJECT_ID" --uniform-bucket-level-access
else
  bucket_region="$(capture "$REGION" gcloud storage buckets describe "gs://$BUCKET" --project "$PROJECT_ID" --format='value(location)')"
  [[ "$(printf '%s' "$bucket_region" | tr '[:upper:]' '[:lower:]')" == "$REGION" ]] || { echo "Storage is in $bucket_region, expected $REGION" >&2; exit 2; }
fi
# Creating the bucket activates Cloud Storage's service agent. Eventarc needs
# that agent to publish object events to its Pub/Sub transport topic.
storage_agent="$(capture "service-123456789012@gs-project-accounts.iam.gserviceaccount.com" gcloud storage service-agent --project "$PROJECT_ID")"
for attempt in {1..6}; do
  if run gcloud projects add-iam-policy-binding "$PROJECT_ID" --member "serviceAccount:$storage_agent" --role roles/pubsub.publisher --quiet; then
    break
  fi
  if (( attempt == 6 )); then exit 1; fi
  sleep 10
done
run gcloud storage buckets add-iam-policy-binding "gs://$BUCKET" --member "serviceAccount:$API_SA" --role roles/storage.objectAdmin --project "$PROJECT_ID" --quiet
cors_file="$(mktemp)"
trap 'rm -f "$cors_file"' EXIT
printf '[{"origin":["%s"],"method":["GET","HEAD","PUT","POST"],"responseHeader":["Content-Type","Authorization","x-goog-resumable"],"maxAgeSeconds":3600}]\n' "$WEB_ORIGIN" > "$cors_file"
if [[ "${DRY_RUN:-0}" == 1 ]]; then
  print_command gcloud storage buckets update "gs://$BUCKET" --cors-file "$cors_file" --project "$PROJECT_ID"
else
  run gcloud storage buckets update "gs://$BUCKET" --cors-file "$cors_file" --project "$PROJECT_ID"
fi
cd "$ROOT_DIR"
run npx --no-install firebase deploy --project "$PROJECT_ID" --only firestore:rules,firestore:indexes,storage --non-interactive
for track in services/api/fixtures/music/*.mp3; do
  run gcloud storage cp "$track" "gs://$BUCKET/library/music/$(basename "$track")" --project "$PROJECT_ID"
done
