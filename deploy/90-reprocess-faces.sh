#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/lib.sh"
if [[ "$ENV" != dev ]]; then echo 'Face project reprocessing is enabled for dev only.' >&2; exit 2; fi
project_id="${1:-}"
if [[ -z "$project_id" ]]; then echo 'Usage: ENV=dev deploy/90-reprocess-faces.sh <projectId>' >&2; exit 2; fi
image="$(image_tag mosae-api)"
face_url="$(service_url mosae-face)"
run gcloud run jobs deploy mosae-reprocess-faces --project "$PROJECT_ID" --region "$REGION" \
  --image "$image" --service-account "$API_SA" --cpu 2 --memory 8Gi --task-timeout 3600 \
  --max-retries 0 --command node --args=services/api/dist/scripts/reprocessFacesJob.js \
  --set-env-vars="^|^GCP_PROJECT_ID=$PROJECT_ID|FIREBASE_STORAGE_BUCKET=$BUCKET|FACE_SERVICE_URL=$face_url|REPROCESS_PROJECT_ID=$project_id"
run gcloud run jobs execute mosae-reprocess-faces --project "$PROJECT_ID" --region "$REGION" --wait
