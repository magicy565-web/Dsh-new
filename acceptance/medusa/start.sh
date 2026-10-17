#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
: "${WORKSPACE_SERVICES_STATE_DIR:?Set the already approved persistent private state directory; never /tmp}"
node acceptance/medusa/write-env.mjs --state-dir "$WORKSPACE_SERVICES_STATE_DIR" --check
# Missing files stop here. Never run bootstrap or administrator creation here.
docker compose -p workspace-pr99-medusa -f acceptance/medusa/compose.yaml up -d --build
