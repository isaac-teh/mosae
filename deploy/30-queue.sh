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
