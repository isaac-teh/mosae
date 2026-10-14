#!/usr/bin/env bash
set -euo pipefail
DEPLOY_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=deploy/lib.sh
source "$DEPLOY_DIR/lib.sh"

names=(bootstrap data secrets queue render face api eventarc web)
scripts=(00-bootstrap.sh 10-data.sh 20-secrets.sh 30-queue.sh 40-render.sh 80-face.sh 50-api.sh 60-eventarc.sh 70-web.sh)
if [[ $# -eq 0 ]]; then
  for script in "${scripts[@]}"; do "$DEPLOY_DIR/$script"; done
elif [[ $# -eq 2 && "$1" == --only ]]; then
  found=0
  for i in "${!names[@]}"; do
    if [[ "$2" == "${names[$i]}" ]]; then "$DEPLOY_DIR/${scripts[$i]}"; found=1; break; fi
  done
  if [[ "$found" == 0 ]]; then echo "Unknown component: $2" >&2; exit 2; fi
else
  echo 'Usage: ENV=dev|prod deploy/deploy.sh [--only bootstrap|data|secrets|queue|render|face|api|eventarc|web]' >&2
  exit 2
fi
