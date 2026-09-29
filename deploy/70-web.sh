#!/usr/bin/env bash
set -euo pipefail
# shellcheck source=deploy/lib.sh
source "$(dirname "$0")/lib.sh"
cd "$ROOT_DIR"
if [[ -L "$ROOT_DIR/node_modules" ]]; then
  echo 'Refusing web export: node_modules must be a real directory, not a symlink' >&2
  exit 2
fi
assert_command npm
assert_command npx
for key in EXPO_PUBLIC_FIREBASE_API_KEY EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN EXPO_PUBLIC_FIREBASE_APP_ID; do
  if [[ -z "${!key:-}" ]]; then echo "Missing $key in $ENV_FILE" >&2; exit 2; fi
done
EXPO_PUBLIC_API_BASE_URL="$(service_url "$API_SERVICE")"
export EXPO_PUBLIC_API_BASE_URL
export EXPO_PUBLIC_FIREBASE_API_KEY EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN EXPO_PUBLIC_FIREBASE_APP_ID
export EXPO_PUBLIC_FIREBASE_PROJECT_ID="$PROJECT_ID"
export EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET="$BUCKET"
export EXPO_PUBLIC_USE_EMULATORS=false
export EXPO_PUBLIC_USE_API_STORY_REPOSITORY=false
run npm run build:web -w apps/client
node "$DEPLOY_DIR/check-web-export.mjs" "$ROOT_DIR/apps/client/dist" "$ROOT_DIR"
firebase_deploy --project "$PROJECT_ID" --only hosting --non-interactive
