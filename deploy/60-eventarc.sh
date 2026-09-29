#!/usr/bin/env bash
set -euo pipefail
# shellcheck source=deploy/lib.sh
source "$(dirname "$0")/lib.sh"
assert_command gcloud

filter_args=(--event-filters type=google.cloud.storage.object.v1.finalized --event-filters "bucket=$BUCKET")
if probe gcloud eventarc triggers describe "$EVENTARC_TRIGGER" --project "$PROJECT_ID" --location "$REGION"; then
  run gcloud eventarc triggers update "$EVENTARC_TRIGGER" --project "$PROJECT_ID" --location "$REGION" \
    "${filter_args[@]}" --destination-run-service "$API_SERVICE" --destination-run-region "$REGION" \
    --destination-run-path /events/storage-finalize --service-account "$INVOKER_SA"
else
  run gcloud eventarc triggers create "$EVENTARC_TRIGGER" --project "$PROJECT_ID" --location "$REGION" \
    "${filter_args[@]}" --destination-run-service "$API_SERVICE" --destination-run-region "$REGION" \
    --destination-run-path /events/storage-finalize --service-account "$INVOKER_SA"
fi
