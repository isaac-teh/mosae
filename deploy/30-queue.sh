#!/usr/bin/env bash
set -euo pipefail
# shellcheck source=deploy/lib.sh
source "$(dirname "$0")/lib.sh"
assert_command gcloud

settings=(--project "$PROJECT_ID" --location "$REGION" --max-attempts 6 --min-backoff 10s --max-backoff 300s --max-doublings 4 --max-concurrent-dispatches 2 --max-dispatches-per-second 2)
if probe gcloud tasks queues describe "$TASKS_QUEUE" --project "$PROJECT_ID" --location "$REGION"; then
  run gcloud tasks queues update "$TASKS_QUEUE" "${settings[@]}"
else
  run gcloud tasks queues create "$TASKS_QUEUE" "${settings[@]}"
fi

# A periodic sweep is the recovery path for outbox rows left behind by a
# worker crash or a failed immediate handoff. The numbered Run URL is stable
# and lets a first-time full deploy create the job before the API service.
if probe gcloud run services describe "$API_SERVICE" --project "$PROJECT_ID" --region "$REGION"; then
  api_url="$(service_url "$API_SERVICE")"
else
  project_number="$(capture 000000000000 gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')"
  api_url="https://$API_SERVICE-$project_number.$REGION.run.app"
fi
job_name=mosae-outbox-dispatch
scheduler_args=(
  --project "$PROJECT_ID" --location "$REGION"
  --schedule '* * * * *' --time-zone Etc/UTC
  --uri "$api_url/internal/dispatch-outbox" --http-method POST
  --oidc-service-account-email "$INVOKER_SA" --oidc-token-audience "$api_url"
  --message-body '{}' --headers 'Content-Type=application/json'
  --attempt-deadline 30s
)
if probe gcloud scheduler jobs describe "$job_name" --project "$PROJECT_ID" --location "$REGION"; then
  run gcloud scheduler jobs update http "$job_name" "${scheduler_args[@]}"
else
  run gcloud scheduler jobs create http "$job_name" "${scheduler_args[@]}"
fi
