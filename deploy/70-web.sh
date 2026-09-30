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
export EXPO_PUBLIC_USE_API_STORY_REPOSITORY=true

# Expo loads .env*.local files even when the production variables are exported.
# Move them aside for the build and always restore them, including on failure.
local_env_backup_dir="$(mktemp -d "${TMPDIR:-/tmp}/mosae-web-env.XXXXXX")"
local_env_files=()
restore_local_env_files() {
  local exit_status=$?
  local restore_failed=0
  trap - EXIT
  for local_env_file in "${local_env_files[@]}"; do
    local backup_file="$local_env_backup_dir/$(basename "$local_env_file")"
    if [[ -e "$backup_file" ]]; then
      mv "$backup_file" "$local_env_file" || restore_failed=1
    fi
  done
  rmdir "$local_env_backup_dir" 2>/dev/null || restore_failed=1
  if [[ "$restore_failed" == 1 ]]; then
    echo 'Failed to restore one or more apps/client/.env*.local files' >&2
    [[ "$exit_status" != 0 ]] || exit_status=1
  fi
  return "$exit_status"
}
trap restore_local_env_files EXIT
shopt -s nullglob
for local_env_file in "$ROOT_DIR"/apps/client/.env*.local; do
  [[ -f "$local_env_file" ]] || continue
  local_env_files+=("$local_env_file")
  mv "$local_env_file" "$local_env_backup_dir/$(basename "$local_env_file")"
done
run npm run build:web -w apps/client -- --clear
restore_local_env_files
node "$DEPLOY_DIR/check-web-export.mjs" "$ROOT_DIR/apps/client/dist" "$ROOT_DIR" "$EXPO_PUBLIC_API_BASE_URL"
if [[ "${BUILD_ONLY:-0}" == 1 ]]; then
  echo 'BUILD_ONLY=1; validated web export and skipped Firebase Hosting deploy'
  exit 0
fi
firebase_deploy --project "$PROJECT_ID" --only hosting --non-interactive
