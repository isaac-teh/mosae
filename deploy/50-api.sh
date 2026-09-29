#!/usr/bin/env bash
set -euo pipefail
# shellcheck source=deploy/lib.sh
source "$(dirname "$0")/lib.sh"
assert_command gcloud
if [[ -z "${NOMINATIM_CONTACT:-}" || "$NOMINATIM_CONTACT" == *'|'* ]]; then
  echo 'Set NOMINATIM_CONTACT to an identifying URL or email without | in the env file' >&2
  exit 2
fi

image="$(image_tag "$API_SERVICE")"
render_url="$(service_url "$RENDER_SERVICE")"
run gcloud builds submit "$ROOT_DIR" --project "$PROJECT_ID" --config "$DEPLOY_DIR/cloudbuild.yaml" --substitutions "_DOCKERFILE=services/api/Dockerfile,_IMAGE=$image"
initial_url=https://pending.invalid
if probe gcloud run services describe "$API_SERVICE" --project "$PROJECT_ID" --region "$REGION"; then
  existing_url="$(service_url "$API_SERVICE")"
  if [[ -n "$existing_url" ]]; then initial_url="$existing_url"; fi
fi
secrets=GEMINI_API_KEY=GEMINI_API_KEY:latest
if [[ "${USE_GOOGLE_MAPS:-0}" == 1 ]]; then secrets+=,GOOGLE_MAPS_API_KEY=GOOGLE_MAPS_API_KEY:latest; fi
run gcloud run deploy "$API_SERVICE" --project "$PROJECT_ID" --region "$REGION" \
  --image "$image" --service-account "$API_SA" --cpu 2 --memory 4Gi \
  --concurrency 2 --max-instances 1 --timeout 3600 --allow-unauthenticated \
  --set-env-vars "^|^NODE_ENV=production|SERVICE_URL=$initial_url|RENDER_SERVICE_URL=$render_url|ALLOWED_ORIGINS=$ALLOWED_ORIGINS|FIREBASE_STORAGE_BUCKET=$BUCKET|INVOKER_SERVICE_ACCOUNTS=$INVOKER_SA|GCP_PROJECT_ID=$PROJECT_ID|TASKS_LOCATION=$REGION|TASKS_QUEUE=$TASKS_QUEUE|TASKS_INVOKER_SERVICE_ACCOUNT=$INVOKER_SA|PLACE_RESOLVER=nominatim|NOMINATIM_CONTACT=$NOMINATIM_CONTACT" \
  --set-secrets "$secrets"
api_url="$(service_url "$API_SERVICE")"
# Cloud Run also serves the API at a project-number URL, and Eventarc signs its
# tokens for that one, so the API must accept both as audiences.
project_number="$(gcloud projects describe "$PROJECT_ID" --format 'value(projectNumber)')"
number_url="https://$API_SERVICE-$project_number.$REGION.run.app"
run gcloud run services update "$API_SERVICE" --project "$PROJECT_ID" --region "$REGION" \
  --update-env-vars "^|^SERVICE_URL=$api_url|SERVICE_AUDIENCES=$number_url"
run gcloud run services add-iam-policy-binding "$API_SERVICE" --project "$PROJECT_ID" --region "$REGION" --member allUsers --role roles/run.invoker --quiet
run gcloud run services add-iam-policy-binding "$API_SERVICE" --project "$PROJECT_ID" --region "$REGION" --member "serviceAccount:$INVOKER_SA" --role roles/run.invoker --quiet
