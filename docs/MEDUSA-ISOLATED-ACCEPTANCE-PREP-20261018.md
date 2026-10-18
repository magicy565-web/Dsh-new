# Prepared, not authorized or executed: isolated Medusa acceptance

Integration pin: `1b788561a6f8e63da9ffecf6f81d0c311d20c721` (Library result continuation integration supplied for this task). The remote integration branch had already advanced to `1ef1a7f73b32608a439afaf56be0997562a346c7`; this preparation does not adopt or validate that later commit. Development branch: `codex/medusa-isolated-acceptance-prep-20261018`, no PR.

The original A build was made from `a819897d…`. Git comparison through the pin shows only the reviewed host lock change in the relevant Medusa product/config/driver/reader inputs. Preparation now checks the staged plugin inputs, A host manifest/config/tsconfig/new lock, original readiness helper, live driver and reader against **1b788561**, plus the archive SRI and all 30 installed plugin member hashes. Thus the already built Medusa subset can be reused for this pin without a heavyweight rebuild. This is not proof of Library/Host-to-Medusa end-to-end behavior and does not present the old standalone build as the final whole product.

## Exact preparation entry (no Docker calls)

```sh
node scripts/medusa-isolated-acceptance-prepare.mjs prepare /workspace/medusa-isolated-plan-20261018-r02 <<'JSON'
{
  "integrationSha": "1b788561a6f8e63da9ffecf6f81d0c311d20c721",
  "runId": "medusa-live-prep-20261018-r02",
  "artifactHost": "/workspace/medusa-package-evidence-20261018/host-A/apps/medusa-acceptance",
  "pluginSource": "/workspace/medusa-package-evidence-20261018/A/packages/medusa-enterprise-product-context",
  "secretDirectory": "/workspace/medusa-live-prep-20261018-r02-secrets"
}
JSON
bash /workspace/medusa-isolated-plan-20261018-r02/run.sh review
```

The input is strictly non-secret JSON; unknown fields, other integration SHA, invalid run IDs/database names, aliases/symlinks and unsafe Docker mount paths are rejected. The generator reuses the reviewed package-acceptance path guard and creates only a new owner-private plan directory outside the repository. It never creates the secret directory or reads a secret value. Generated run/API wrapper/config/env files are hashed; future execution rechecks the preparer hash, these files, pinned source and artifacts before Docker. Changes require fresh preparation. Cleanup can still run if build inputs/secrets disappear.

Archive: 21,012 bytes, SHA256 `bc6d3584e3902914273f969517112ae89e2d2210a13b853679057110ada81b24`; SRI `sha512-wwmo0aJ+uU6UAnlJAQDPnVzRInVcYYzDmTyy+9IL8CCnlHzwddmrPnKJ3FNx2pT+17+bxwcoV0FIKCuyZhP8Aw==`. These are existing build identities, not a new build result.

## Approval gates still unmet

No temporary-environment authorization has been received. The following commands are **future operations only**, not performed by preparation or tests:

1. Separately authorize downloading the three exact images already pinned by the original sources: `docker.io/library/postgres:17-alpine@sha256:b0f9560a2de083e2cc7382e75f808c7381a32852a7ec49117deedb300e552b24`, `docker.io/library/redis:7.4-alpine@sha256:858f009f9709ce576febc734aa78b8f6d624b82571f9ddb6bda4377c833b3499`, and `docker.io/library/node:24.19.0-bookworm-slim@sha256:a9f5f7c91a432850b2a8a7797adf5eadb6c733ceed61167806cee7ea7fbc29df`. Prior read-only inspection found all three missing. There is no pull/build fallback in the plan; runtime uses `--pull=never`.
2. Operator supplies five temporary 64-lowercase-hex service files (`postgres_password`, `redis_password`, `jwt_secret`, `cookie_secret`, `agent_context_read_token`) under the specified owner-private 0700 directory; files must be owner-owned, regular/non-symlink, immutable 0444 (as in the existing bootstrap contract), 64 bytes plus optional newline. Host directory privacy protects these files; each nonroot container receives only its required read-only file mounts. No entropy/bootstrap/token generation is implemented here. Do not run the existing persistent bootstrap: it also provisions unrelated Docling material.
3. Explicitly approve initialization of a **new empty** PG role `medusa` and database `medusa_live_prep_20261018_r02`, temporary Redis/API startup and native migrations. No existing volume/database is mounted. Separate temporary Medusa Admin provisioning and obtaining its short-lived bearer still require operator authorization; startup does not create a Medusa account or mint a JWT. The existing manual `create-user.mjs` is a reference for that later review, not called here, and its old wrapper's hardcoded database must not be reused blindly.

After those gates, the complete reviewed start entry is:

```sh
MEDUSA_TEMP_SERVICE_APPROVAL=ISOLATED_TEMP_ONLY bash /workspace/medusa-isolated-plan-20261018-r02/run.sh start
```

The marker records an operator decision; it is not itself authorization from this task. Without it the shell stops before Docker. Missing secret metadata, images or changed artifacts stop rather than discover alternate credentials/targets. Runtime credentials are read only inside the future approved containers; no secret enters Docker environment/argv.

## Complete bounded assembly

The generated `run.sh` contains full `docker run` arguments, no ellipses. Only the local Unix daemon is selected, with a new empty Docker config path (existing config refused); no ambient Docker context or login is used. One uniquely named `--internal` network is recorded by ID. PG owns its network namespace; Redis and API use `--network container:<recorded-PG-CID>`. All endpoints/Medusa listening bind to 127.0.0.1 inside that namespace. There are **no published host/public ports**, no ingress container and no external API/provider/model/production/Tencent connection.

| Container | Memory/swap maximum | CPU | PIDs | Writable state |
| --- | --- | --- | --- | --- |
| PG, UID 70 | 768 MiB | .75 | 128 | 384 MiB data tmpfs, 8 MiB socket tmpfs, 16 MiB /tmp |
| Redis, UID 999 | 128 MiB | .25 | 64 | /data and /tmp 16 MiB each; persistence off, maxmemory96mb |
| API, UID 1000 | 3 GiB | 1.5 | 256 | /app1536 MiB tmpfs, /tmp128 MiB, Node heap1280 MiB |

All are read-only rootfs, cap-drop ALL, no-new-privileges, no automatic restart. PG/Redis image-declared data volumes are explicitly overridden with tmpfs: no persistent or anonymous volume is intended. The API copies the existing read-only compiled server/node_modules into its bounded tmpfs; no package installation/compilation occurs. Only the original 11 audited empty migration directories are created in that private copy, matching the pinned API Dockerfile and native closure exactly. Business service/nativeUpdate, SDK and dependencies remain unchanged.

The old production entrypoint hardcodes `medusa_catalog`, so a minimal acceptance-only API boot wrapper reuses its secret validation and signal forwarding but sets the explicitly validated temporary DB and 127.0.0.1 endpoints. Native `db:migrate` runs before `start --host 127.0.0.1`. PG/Redis readiness has a bounded polling window; existing `wait-for-http.mjs` supplies API readiness (120 seconds). This readiness polling is not the PG concurrency witness. Any failed partial start leaves exact recorded IDs available for explicit cleanup; it does not broaden cleanup or run account setup.

## Future actual acceptance entry

Only after separately approved temporary Admin authentication is available, supply the existing PR116 driver's reviewed config via stdin:

```sh
MEDUSA_TEMP_SERVICE_APPROVAL=ISOLATED_TEMP_ONLY bash /workspace/medusa-isolated-plan-20261018-r02/run.sh accept < /operator-private/reviewed-live-config.json
```

Config must name `backendUrl=http://127.0.0.1:9000`, PG `host=127.0.0.1, port=5432, user/serverRole=medusa, database=medusa_live_prep_20261018_r02`, exact matching isolation declaration/instance `medusa-live-prep-20261018-r02`, `cleanup=operator-destroys-instance`, and `pgRequireFrom=/app/package.json`; distinct temporary Admin/Agent tokens and matching password come only from the operator. Do not put these values into this repository or plan output. The original driver validates the config, bounds HTTP/PG operations, verifies marker/private projection/source invalidation and eight real CAS races using actual pg_stat_activity/pg_blocking_pids. This preparation does not replace or weaken those assertions.

Cleanup, including a partially failed start, is explicit:

```sh
MEDUSA_TEMP_SERVICE_APPROVAL=ISOLATED_TEMP_ONLY bash /workspace/medusa-isolated-plan-20261018-r02/run.sh cleanup
```

Only the three 64-hex CIDs and network ID recorded by this round are considered, and their `acceptance.run` labels must match. API/Redis are removed before PG, then that exact network. No resource listing/prune, existing container deletion, image removal or volume deletion is performed. This plan creates no named volume. Any unexpected mounts/volume require stopping for review; no global cleanup is authorized. Secret files remain the operator's responsibility.

## This task's evidence and limits

Only preparation/identity reads and static/parameter tests were run: `node --test test/medusa-isolated-acceptance/prepare.test.mjs` (6/6), JS syntax checks, `bash -n`, and `git diff --check`. The actual preparation checked 29 pinned inputs plus archive/30 installed members and generated review files outside Git. It did not execute `run.sh start/accept/cleanup`, Docker commands, pulls, services, migrations, account/token/secret creation, builds, models, Tencent or deployment. No PR is created; only the development branch is saved.

Still unverified: container runtime compatibility/resource sufficiency, exact image npm11.17 behavior, real startup/migrations/link/authentication, Admin provisioning, real HTTP/PG acceptance, and Library/Host final delivery through the latest product. Existing A dependency/build evidence is reused with a checked Medusa compatibility boundary; no fresh heavy build or old acceptance is rerun.
