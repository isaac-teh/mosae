#!/usr/bin/env bash
set -euo pipefail
# shellcheck source=deploy/lib.sh
source "$(dirname "$0")/lib.sh"
assert_command gcloud

image="$(image_tag "$RENDER_SERVICE")"
api_url="$(service_url "$API_SERVICE")"
run gcloud builds submit "$ROOT_DIR" --project "$PROJECT_ID" --config "$DEPLOY_DIR/cloudbuild.yaml" --substitutions "_DOCKERFILE=services/render/Dockerfile,_IMAGE=$image"
# Cloud Run supplies PORT. Deploy once, discover the assigned URL, then set the
# audience the service uses to validate authenticated calls.
initial_url=https://pending.invalid
if probe gcloud run services describe "$RENDER_SERVICE" --project "$PROJECT_ID" --region "$REGION"; then
  existing_url="$(service_url "$RENDER_SERVICE")"
  if [[ -n "$existing_url" ]]; then initial_url="$existing_url"; fi
fi
run gcloud run deploy "$RENDER_SERVICE" --project "$PROJECT_ID" --region "$REGION" \
  --image "$image" --service-account "$RENDER_SA" --cpu 4 --memory 8Gi \
  --concurrency 1 --timeout 3600 --no-allow-unauthenticated \
  --set-env-vars "^|^NODE_ENV=production|SERVICE_URL=$initial_url|API_SERVICE_URL=$api_url|INVOKER_SERVICE_ACCOUNTS=$API_SA,$INVOKER_SA"
render_url="$(service_url "$RENDER_SERVICE")"
run gcloud run services update "$RENDER_SERVICE" --project "$PROJECT_ID" --region "$REGION" \
  --update-env-vars "^|^SERVICE_URL=$render_url|API_SERVICE_URL=$api_url|INVOKER_SERVICE_ACCOUNTS=$API_SA,$INVOKER_SA"
run gcloud run services add-iam-policy-binding "$RENDER_SERVICE" --project "$PROJECT_ID" --region "$REGION" --member "serviceAccount:$API_SA" --role roles/run.invoker --quiet
run gcloud run services add-iam-policy-binding "$RENDER_SERVICE" --project "$PROJECT_ID" --region "$REGION" --member "serviceAccount:$INVOKER_SA" --role roles/run.invoker --quiet
