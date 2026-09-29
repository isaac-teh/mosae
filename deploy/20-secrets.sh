#!/usr/bin/env bash
set -euo pipefail
# shellcheck source=deploy/lib.sh
source "$(dirname "$0")/lib.sh"
assert_command gcloud

for name in GEMINI_API_KEY GOOGLE_MAPS_API_KEY; do
  if ! probe gcloud secrets describe "$name" --project "$PROJECT_ID"; then
    run gcloud secrets create "$name" --replication-policy automatic --project "$PROJECT_ID"
  fi
  if [[ "${DRY_RUN:-0}" == 1 ]]; then
    print_command gcloud secrets versions add "$name" --project "$PROJECT_ID" --data-file=-
    echo "[dry-run] prompt for $name; value hidden"
  else
    printf '%s: ' "$name" >&2
    IFS= read -r -s value </dev/tty
    printf '\n' >&2
    if [[ -z "$value" ]]; then echo "Empty $name" >&2; exit 2; fi
    printf '%s' "$value" | gcloud secrets versions add "$name" --project "$PROJECT_ID" --data-file=-
    unset value
  fi
  run gcloud secrets add-iam-policy-binding "$name" --project "$PROJECT_ID" --member "serviceAccount:$API_SA" --role roles/secretmanager.secretAccessor --quiet
done
