#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/lib.sh"
assert_command gcloud
if [[ "$ENV" != dev ]]; then echo 'The ArcFace service is enabled for dev only in this release.' >&2; exit 2; fi
image="$(image_tag mosae-face)"
run gcloud builds submit "$ROOT_DIR/services/face" --project "$PROJECT_ID" --tag "$image"
run gcloud run deploy mosae-face --project "$PROJECT_ID" --region "$REGION" --image "$image" \
  --service-account "$API_SA" --cpu 2 --memory 2Gi --concurrency 4 --max-instances 5 --timeout 300 \
  --no-allow-unauthenticated --port 8080 --set-env-vars "MODEL_VERSION=arcface-buffalo_l-v1"
run gcloud run services add-iam-policy-binding mosae-face --project "$PROJECT_ID" --region "$REGION" \
  --member "serviceAccount:$API_SA" --role roles/run.invoker --quiet
face_url="$(service_url mosae-face)"
run gcloud run services update "$API_SERVICE" --project "$PROJECT_ID" --region "$REGION" \
  --update-env-vars "FACE_SERVICE_URL=$face_url"
if [[ "${DRY_RUN:-0}" != 1 ]]; then
  token="$(gcloud auth print-identity-token)"
  curl -fsS -H "Authorization: Bearer $token" "$face_url/health"
  printf '\n'
fi
