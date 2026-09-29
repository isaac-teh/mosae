#!/usr/bin/env bash
set -euo pipefail
# shellcheck source=deploy/lib.sh
source "$(dirname "$0")/lib.sh"
assert_command gcloud

image="$(image_tag "$API_SERVICE")"
render_url="$(service_url "$RENDER_SERVICE")"
run gcloud builds submit "$ROOT_DIR" --project "$PROJECT_ID" --config "$DEPLOY_DIR/cloudbuild.yaml" --substitutions "_DOCKERFILE=services/api/Dockerfile,_IMAGE=$image"
initial_url=https://pending.invalid
if probe gcloud run services describe "$API_SERVICE" --project "$PROJECT_ID" --region "$REGION"; then
  initial_url="$(service_url "$API_SERVICE")"
fi
run gcloud run deploy "$API_SERVICE" --project "$PROJECT_ID" --region "$REGION" \
  --image "$image" --service-account "$API_SA" --cpu 2 --memory 4Gi \
  --concurrency 2 --timeout 3600 --allow-unauthenticated \
  --set-env-vars "^|^NODE_ENV=production|SERVICE_URL=$initial_url|RENDER_SERVICE_URL=$render_url|ALLOWED_ORIGINS=$ALLOWED_ORIGINS|FIREBASE_STORAGE_BUCKET=$BUCKET|INVOKER_SERVICE_ACCOUNTS=$INVOKER_SA|GCP_PROJECT_ID=$PROJECT_ID|TASKS_LOCATION=$REGION|TASKS_QUEUE=$TASKS_QUEUE|TASKS_INVOKER_SERVICE_ACCOUNT=$INVOKER_SA" \
  --set-secrets GEMINI_API_KEY=GEMINI_API_KEY:latest,GOOGLE_MAPS_API_KEY=GOOGLE_MAPS_API_KEY:latest
api_url="$(service_url "$API_SERVICE")"
run gcloud run services update "$API_SERVICE" --project "$PROJECT_ID" --region "$REGION" \
  --update-env-vars "SERVICE_URL=$api_url"
run gcloud run services add-iam-policy-binding "$API_SERVICE" --project "$PROJECT_ID" --region "$REGION" --member allUsers --role roles/run.invoker --quiet
run gcloud run services add-iam-policy-binding "$API_SERVICE" --project "$PROJECT_ID" --region "$REGION" --member "serviceAccount:$INVOKER_SA" --role roles/run.invoker --quiet
