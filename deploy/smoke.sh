#!/usr/bin/env bash
set -euo pipefail
# shellcheck source=deploy/lib.sh
source "$(dirname "$0")/lib.sh"
assert_command curl
api_url="$(service_url "$API_SERVICE")"
render_url="$(service_url "$RENDER_SERVICE")"
if [[ "${DRY_RUN:-0}" == 1 ]]; then
  print_command curl --max-time 20 --fail --silent --show-error "$api_url/health"
  print_command curl --max-time 20 --location --fail --silent --show-error "$WEB_ORIGIN"
  print_command curl --max-time 20 --silent --output /dev/null --write-out '%{http_code}' --request POST "$api_url/tasks/ingest"
  print_command curl --max-time 20 --silent --output /dev/null --write-out '%{http_code}' "$render_url/health"
  echo '[dry-run] expect API and web 2xx; unauthenticated task 401; render 401/403'
else
  curl --max-time 20 --fail --silent --show-error "$api_url/health" >/dev/null
  curl --max-time 20 --location --fail --silent --show-error "$WEB_ORIGIN" >/dev/null
  task_status="$(curl --max-time 20 --silent --output /dev/null --write-out '%{http_code}' --request POST "$api_url/tasks/ingest")"
  [[ "$task_status" == 401 ]] || { echo "Expected task 401, got $task_status" >&2; exit 1; }
  render_status="$(curl --max-time 20 --silent --output /dev/null --write-out '%{http_code}' "$render_url/health")"
  [[ "$render_status" == 401 || "$render_status" == 403 ]] || { echo "Expected private render 401/403, got $render_status" >&2; exit 1; }
  echo 'HTTP smoke checks passed'
fi
echo 'Manual: sign in anonymously, upload trip1-v2, chat, render, open editor, save film, then download MP4.'
