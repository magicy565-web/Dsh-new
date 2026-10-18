#!/usr/bin/env bash
set -euo pipefail
umask 077
PLAN=$(cd -- "$(dirname -- "$0")" && pwd -P)
MODE=${1:-review}
case "$MODE" in review) cat "$PLAN/README.txt"; exit 0;; start|accept|cleanup) ;; *) exit 2;; esac
: "${MEDUSA_TEMP_SERVICE_APPROVAL:?Authorization pending: do not execute}"
test "$MEDUSA_TEMP_SERVICE_APPROVAL" = ISOLATED_TEMP_ONLY
node "$PLAN/verify.mjs" "$PLAN" "$MODE"
# env.sh is regenerated/checked from strictly validated non-secret config by verify.
source "$PLAN/env.sh"
d(){ env -i PATH="$PATH" HOME=/tmp docker --config "$PLAN/docker-config" --host unix:///var/run/docker.sock "$@"; }
label_match(){ test "$(d "$1" inspect "$2" --format '{{index .Labels "acceptance.run"}}')" = "$RUN_ID"; }
container_match(){ test "$(d container inspect "$1" --format '{{index .Config.Labels "acceptance.run"}}')" = "$RUN_ID"; }
cleanup(){
 for name in api redis pg; do
  if test -f "$PLAN/$name.id"; then
   id=$(cat "$PLAN/$name.id"); [[ "$id" =~ ^[a-f0-9]{64}$ ]]
   container_match "$id"; d container rm -f "$id"; rm -- "$PLAN/$name.id"
  fi
 done
 if test -f "$PLAN/network.id"; then
  id=$(cat "$PLAN/network.id"); [[ "$id" =~ ^[a-f0-9]{64}$ ]]
  label_match network "$id"; d network rm "$id"; rm -- "$PLAN/network.id"
 fi
}
if test "$MODE" = cleanup; then cleanup; exit 0; fi
if test "$MODE" = accept; then
 test -f "$PLAN/api.id"; API_ID=$(cat "$PLAN/api.id"); [[ "$API_ID" =~ ^[a-f0-9]{64}$ ]]; container_match "$API_ID"
 # Operator supplies reviewed live config through stdin; never persist it here.
 d exec -i "$API_ID" node /acceptance/scripts/medusa-catalog-live-smoke.mjs --context-review-only
 exit 0
fi
# No automatic pull, build, credential bootstrap, account setup or restart.
for image in "$PG_IMAGE" "$REDIS_IMAGE" "$NODE_IMAGE"; do d image inspect "$image" --format '{{.Id}}' >/dev/null; done
for name in api redis pg network; do test ! -e "$PLAN/$name.id"; done
d network create --internal --label "acceptance.run=$RUN_ID" "$RUN_ID-net" > "$PLAN/network.id"
NET_ID=$(cat "$PLAN/network.id"); [[ "$NET_ID" =~ ^[a-f0-9]{64}$ ]]
common=(--pull=never --restart=no --read-only --cap-drop=ALL --security-opt=no-new-privileges --label "acceptance.run=$RUN_ID")
d run -d "${common[@]}" --name "$RUN_ID-pg" --cidfile "$PLAN/pg.id" --network "$NET_ID" --user 70:70 \
 --memory=768m --memory-swap=768m --cpus=.75 --pids-limit=128 \
 --tmpfs /var/lib/postgresql/data:rw,noexec,nosuid,nodev,uid=70,gid=70,mode=0700,size=384m \
 --tmpfs /var/run/postgresql:rw,noexec,nosuid,nodev,uid=70,gid=70,mode=0770,size=8m \
 --tmpfs /tmp:rw,noexec,nosuid,nodev,size=16m \
 --mount "type=bind,src=$SECRETS/postgres_password,dst=/run/secrets/postgres_password,readonly" \
 -e POSTGRES_USER=medusa -e "POSTGRES_DB=$DATABASE" -e POSTGRES_PASSWORD_FILE=/run/secrets/postgres_password \
 "$PG_IMAGE" -c max_connections=30 -c shared_buffers=32MB -c max_wal_size=128MB >/dev/null
PG_ID=$(cat "$PLAN/pg.id"); [[ "$PG_ID" =~ ^[a-f0-9]{64}$ ]]
for attempt in {1..60}; do
 if d exec "$PG_ID" pg_isready -h 127.0.0.1 -U medusa -d "$DATABASE" >/dev/null; then break; fi
 test "$attempt" != 60; sleep 1 # Readiness only, never concurrent-CAS evidence.
done
d run -d "${common[@]}" --name "$RUN_ID-redis" --cidfile "$PLAN/redis.id" --network "container:$PG_ID" --user 999:999 \
 --memory=128m --memory-swap=128m --cpus=.25 --pids-limit=64 \
 --tmpfs /data:rw,noexec,nosuid,nodev,uid=999,gid=999,mode=0700,size=16m \
 --tmpfs /tmp:rw,noexec,nosuid,nodev,uid=999,gid=999,mode=0700,size=16m \
 --mount "type=bind,src=$SECRETS/redis_password,dst=/run/secrets/redis_password,readonly" \
 --entrypoint sh "$REDIS_IMAGE" -ec 'p=$(cat /run/secrets/redis_password); case "$p" in *[!0-9a-f]*|"") exit 2;; esac; test "${#p}" = 64; umask 077; printf "bind 127.0.0.1\nprotected-mode yes\nport 6379\nsave \"\"\nappendonly no\nmaxmemory 96mb\nmaxmemory-policy noeviction\nrequirepass %s\n" "$p" > /tmp/redis.conf; exec redis-server /tmp/redis.conf' >/dev/null
REDIS_ID=$(cat "$PLAN/redis.id"); [[ "$REDIS_ID" =~ ^[a-f0-9]{64}$ ]]
for attempt in {1..60}; do
 reply=$(d exec "$REDIS_ID" redis-cli -h 127.0.0.1 ping 2>/dev/null || true)
 if test "$reply" = 'NOAUTH Authentication required.'; then break; fi
 test "$attempt" != 60; sleep 1
done
mounts=()
for name in postgres_password redis_password jwt_secret cookie_secret agent_context_read_token; do mounts+=(--mount "type=bind,src=$SECRETS/$name,dst=/run/secrets/$name,readonly"); done
d run -d "${common[@]}" --name "$RUN_ID-api" --cidfile "$PLAN/api.id" --network "container:$PG_ID" --user 1000:1000 \
 --memory=3g --memory-swap=3g --cpus=1.5 --pids-limit=256 \
 --tmpfs /app:rw,exec,nosuid,nodev,uid=1000,gid=1000,mode=0700,size=1536m \
 --tmpfs /tmp:rw,nosuid,nodev,uid=1000,gid=1000,mode=0700,size=128m \
 --mount "type=bind,src=$ARTIFACT/.medusa/server,dst=/fixture/server,readonly" \
 --mount "type=bind,src=$ARTIFACT/node_modules,dst=/fixture/node_modules,readonly" \
 --mount "type=bind,src=$PLAN/api-boot.mjs,dst=/plan/api-boot.mjs,readonly" \
 --mount "type=bind,src=$SOURCE/acceptance/medusa/wait-for-http.mjs,dst=/plan/wait-for-http.mjs,readonly" \
 --mount "type=bind,src=$SOURCE/scripts/medusa-catalog-live-smoke.mjs,dst=/acceptance/scripts/medusa-catalog-live-smoke.mjs,readonly" \
 --mount "type=bind,src=$SOURCE/test/medusa-live-acceptance,dst=/acceptance/test/medusa-live-acceptance,readonly" \
 --mount "type=bind,src=$SOURCE/plugins/workspace-medusa-catalog/src/approved-source.mjs,dst=/acceptance/plugins/workspace-medusa-catalog/src/approved-source.mjs,readonly" \
 "${mounts[@]}" -e MEDUSA_DISABLE_TELEMETRY=true -e MEDUSA_TEMP_SERVICE_APPROVAL=ISOLATED_TEMP_ONLY \
 -e "MEDUSA_TEST_DATABASE=$DATABASE" -e NODE_OPTIONS=--max-old-space-size=1280 \
 --entrypoint node "$NODE_IMAGE" /plan/api-boot.mjs >/dev/null
API_ID=$(cat "$PLAN/api.id"); [[ "$API_ID" =~ ^[a-f0-9]{64}$ ]]
d exec "$API_ID" node /plan/wait-for-http.mjs http://127.0.0.1:9000/health
echo 'Temporary containers created; inspect only these recorded IDs. Native startup/readiness and temporary Admin authentication remain separate gates.'
