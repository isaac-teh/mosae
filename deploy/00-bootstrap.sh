#!/usr/bin/env bash
set -euo pipefail
# shellcheck source=deploy/lib.sh
source "$(dirname "$0")/lib.sh"
assert_command gcloud

run gcloud services enable \
  run.googleapis.com cloudtasks.googleapis.com cloudscheduler.googleapis.com eventarc.googleapis.com eventarcpublishing.googleapis.com \
  artifactregistry.googleapis.com secretmanager.googleapis.com firestore.googleapis.com \
  storage.googleapis.com firebasestorage.googleapis.com firebasehosting.googleapis.com cloudbuild.googleapis.com iam.googleapis.com \
  iamcredentials.googleapis.com pubsub.googleapis.com --project "$PROJECT_ID"

if ! probe gcloud artifacts repositories describe "$ARTIFACT_REPO" --project "$PROJECT_ID" --location "$REGION"; then
  run gcloud artifacts repositories create "$ARTIFACT_REPO" --project "$PROJECT_ID" --location "$REGION" --repository-format docker
fi
for name in mosae-api-sa mosae-render-sa mosae-tasks-invoker mosae-face-sa; do
  if ! probe gcloud iam service-accounts describe "$name@$PROJECT_ID.iam.gserviceaccount.com" --project "$PROJECT_ID"; then
    run gcloud iam service-accounts create "$name" --project "$PROJECT_ID" --display-name "$name"
  fi
done

run gcloud projects add-iam-policy-binding "$PROJECT_ID" --member "serviceAccount:$API_SA" --role roles/datastore.user --quiet
run gcloud projects add-iam-policy-binding "$PROJECT_ID" --member "serviceAccount:$API_SA" --role roles/cloudtasks.enqueuer --quiet
run gcloud iam service-accounts add-iam-policy-binding "$API_SA" --project "$PROJECT_ID" --member "serviceAccount:$API_SA" --role roles/iam.serviceAccountTokenCreator --quiet
run gcloud iam service-accounts add-iam-policy-binding "$INVOKER_SA" --project "$PROJECT_ID" --member "serviceAccount:$API_SA" --role roles/iam.serviceAccountUser --quiet
run gcloud projects add-iam-policy-binding "$PROJECT_ID" --member "serviceAccount:$INVOKER_SA" --role roles/eventarc.eventReceiver --quiet
