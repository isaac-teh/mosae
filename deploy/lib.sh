#!/usr/bin/env bash
set -euo pipefail

DEPLOY_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$DEPLOY_DIR/.." && pwd)"
ENV="${ENV:-}"
if [[ "$ENV" != dev && "$ENV" != prod ]]; then
  echo 'Set ENV=dev or ENV=prod' >&2
  exit 2
fi
ENV_FILE="$DEPLOY_DIR/env/$ENV.env"
if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing $ENV_FILE; copy deploy/env/example.env and edit it" >&2
  exit 2
fi
# The env file is local operator configuration, never a source for secrets.
# shellcheck disable=SC1090
source "$ENV_FILE"
for key in PROJECT_ID REGION BUCKET ARTIFACT_REPO API_SERVICE RENDER_SERVICE TASKS_QUEUE EVENTARC_TRIGGER WEB_ORIGIN ALLOWED_ORIGINS; do
  if [[ -z "${!key:-}" ]]; then echo "Missing $key in $ENV_FILE" >&2; exit 2; fi
done
if [[ "$REGION" != asia-southeast1 ]]; then
  echo 'REGION must be asia-southeast1 (Firestore, Storage, Run, Tasks and Eventarc)' >&2
  exit 2
fi
# shellcheck disable=SC2034
API_SA="mosae-api-sa@$PROJECT_ID.iam.gserviceaccount.com"
# shellcheck disable=SC2034
RENDER_SA="mosae-render-sa@$PROJECT_ID.iam.gserviceaccount.com"
FACE_SA="mosae-face-sa@$PROJECT_ID.iam.gserviceaccount.com"
# shellcheck disable=SC2034
INVOKER_SA="mosae-tasks-invoker@$PROJECT_ID.iam.gserviceaccount.com"
IMAGE_BASE="$REGION-docker.pkg.dev/$PROJECT_ID/$ARTIFACT_REPO"

print_command() { printf '+'; printf ' %q' "$@"; printf '\n'; }
run() {
  if [[ "${DRY_RUN:-0}" == 1 ]]; then print_command "$@"; else "$@"; fi
}
probe() {
  if [[ "${DRY_RUN:-0}" == 1 ]]; then print_command "$@"; return 1; fi
  "$@" >/dev/null 2>&1
}
capture() {
  local fallback="$1"; shift
  if [[ "${DRY_RUN:-0}" == 1 ]]; then print_command "$@" >&2; printf '%s' "$fallback"; else "$@"; fi
}
service_url() {
  local name="$1"
  capture "https://$name-example-$REGION.a.run.app" gcloud run services describe "$name" --project "$PROJECT_ID" --region "$REGION" --format='value(status.url)'
}
image_tag() { printf '%s/%s:%s' "$IMAGE_BASE" "$1" "$(git -C "$ROOT_DIR" rev-parse --short HEAD)"; }
assert_command() {
  if [[ "${DRY_RUN:-0}" != 1 ]] && ! command -v "$1" >/dev/null; then echo "Missing command: $1" >&2; exit 2; fi
}
firebase_deploy() {
  if [[ "${DRY_RUN:-0}" == 1 ]]; then
    print_command gcloud auth print-access-token
    print_command env "GOOGLE_CLOUD_QUOTA_PROJECT=$PROJECT_ID" 'FIREBASE_TOKEN=<redacted>' npx --no-install firebase deploy "$@"
  else
    GOOGLE_CLOUD_QUOTA_PROJECT="$PROJECT_ID" FIREBASE_TOKEN="$(gcloud auth print-access-token)" \
      npx --no-install firebase deploy "$@"
  fi
}
