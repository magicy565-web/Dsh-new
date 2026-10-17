# Isolated Medusa deployment source

This prepares a separate installation of native Medusa 2.21.2 and the existing PR99 catalog UI/plugin. It does not deploy the Workspace Host. Product CRUD belongs to native Medusa; Library draft projections retain their separate Library authority. There is no automatic synchronization or Library write-back. Mem0 remains disabled.

The selected baseline is PR94 commit `04325f4ddc9e50d569b3696bc4627fd359263723`: acceptance host, Product Context migration and strict live smoke. Current PR99 UI, plugin implementation and existing locks were retained. The added acceptance host has its own committed lock. Docker builds compile and pack the current plugin before installing that exact local tarball. No whole-repository runtime mount or startup npm installation is used.

The original `e1efd3f` Docker context omitted the plugin README that npm automatically includes, and Docker's 0644 file modes differed from the locked local archive's 0600 modes. Both change tarball integrity. Apply the later PR99 deployment correction before building: COPY and its allowlist include README, COPY explicitly fixes the packed root-file modes, and plugin build uses umask077. The lock integrity is retained. A clean compile/pack inside the pinned Node24.19.0/npm11.17.0 image matches it exactly; local npm11.9.0 also matches. This is not a claim of a completed server image build. Do not bypass EINTEGRITY with force, remove integrity, or regenerate a lock blindly on the server.

## Operator preparation

Use a durable checkout and durable Docker data directory, never the server's tmpfs `/tmp`. Docker Engine and Compose must already be installed by the authorized operator. Check disk, RAM and existing listeners before starting; do not stop another service to free a port. Images are pinned in [the image inventory](../deployment-images.json). Build serially on the 2 CPU / 8 GB target. Image extraction, npm builds and cached layers need additional disk and memory beyond runtime limits; their peak has not been measured on that target.

Only after explicit service-secret bootstrap authorization, in a private terminal:

```sh
export WORKSPACE_SERVICES_STATE_DIR="$HOME/.local/share/workspace-pr99-services"
install -d -m 0700 "$WORKSPACE_SERVICES_STATE_DIR"
node acceptance/medusa/write-env.mjs --state-dir "$WORKSPACE_SERVICES_STATE_DIR" --confirm-create-service-secrets
```

This creates only service files (including the separate Docling configuration), never an administrator. The owner-only state directory must already exist on persistent storage, outside this checkout. Existing complete files are preserved, partial state is refused, and restart never regenerates files. Keep the parent directory mode 0700: individual files are 0444 so each nonroot container can read its explicitly mounted secret. Do not mount or publish the parent directory, print file contents, or put secrets in Compose environment, arguments or Git.

Check and build explicitly:

```sh
node acceptance/medusa/write-env.mjs --state-dir "$WORKSPACE_SERVICES_STATE_DIR" --check
docker compose -p workspace-pr99-medusa -f acceptance/medusa/compose.yaml config --quiet
docker compose -p workspace-pr99-medusa -f acceptance/medusa/compose.yaml build api
docker compose -p workspace-pr99-medusa -f acceptance/medusa/compose.yaml build ui
docker compose -p workspace-pr99-medusa -f acceptance/medusa/compose.yaml up -d --no-build
docker compose -p workspace-pr99-medusa -f acceptance/medusa/compose.yaml ps
```

Alternatively `bash acceptance/medusa/start.sh` checks existing service files and builds/starts; it refuses an unconfigured state. Native `db:migrate` runs before API startup. Inspect its outcome before retrying a failed migration; do not delete volumes or automatically roll back the database.

Postgres and native Medusa Redis have no published ports. Persistent project volumes hold PostgreSQL, Redis AOF and uploaded files. Redis serves only native Medusa caching/events/workflows/locking in shared worker mode. This is a single-instance setup, without a high-availability, backup or public TLS certification. Runtime caps remain API 2 GiB, PostgreSQL 512 MiB, Redis 128 MiB and UI 64 MiB. With Docling 3 GiB and its added nginx64 MiB, the total is 5.75 GiB, excluding Docker and the host.

Only the existing UI nginx joins the approved ingress bridge; API/Postgres/Redis remain exclusively internal. UI nginx publishes loopback4173 and proxies loopback9000 to the fixed API service. Its public, credential-free config is mounted read-only with Compose configs, so the entry change needs no UI rebuild. Ensure `acceptance/medusa/nginx.conf` is mode0644 for nonroot nginx. API `XDG_CONFIG_HOME` and `XDG_CACHE_HOME` point into the existing `/tmp` tmpfs, preventing the native CLI from writing its package-manager preferences under read-only `/home/node`. Eight installed modules without migration files need existing empty `dist/migrations` directories: the API's final image preparation layer now creates these without changing dependencies or existing files. Rebuild API once to add that small layer, retaining earlier build cache. Existing `/app/.cache`, limits, volumes and secrets remain unchanged. For the current e1efd3f+6f41b0c state use [the exact migration/entry update commands](../../docs/OMP-LOOPBACK-INGRESS-20261017.md).

## Manual administrator and access

Startup creates no administrator. An authorized operator must run this in an interactive private terminal after API health succeeds:

```sh
docker compose -p workspace-pr99-medusa -f acceptance/medusa/compose.yaml exec api node /opt/medusa/entrypoint.mjs admin --confirm-create-admin
```

Email and a 16+ character password are prompted; password input is hidden and passed through a private pipe to the native Medusa user command, never password argv, environment, log or file. The command refuses noninteractive input. The native Medusa Admin bundle is disabled; the retained catalog UI is served by nginx.

API and UI are bound only to server loopback 9000 and 4173. Use SSH local forwarding for both ports to access from a workstation; use `http://127.0.0.1:4173` for the UI and `http://127.0.0.1:9000` for its backend. No public ingress is created. nginx also proxies the existing native API/upload paths. Check API health with `curl --fail http://127.0.0.1:9000/health`; health alone does not validate login, migration behavior, permissions or product edits.

## Strict live acceptance and restart

`npm run test:medusa-live` is an explicit, destructive fixture test only for this isolated database. It requires `MEDUSA_BACKEND_URL` pointing to HTTP loopback, `MEDUSA_LIVE_ALLOW_WRITES=isolated`, and credentials supplied privately as `MEDUSA_ADMIN_EMAIL`, `MEDUSA_ADMIN_PASSWORD`, `AGENT_CONTEXT_READ_TOKEN`. Do not paste passwords into command history, run against business data, or automatically execute it during startup. It creates its own product, variant, inventory, location, channel, category, collection and upload; rereads exact values, checks denied permissions, approval and revocation, then attempts cleanup only of its own recorded IDs. A missing fixture or failed cleanup is a failure; no skipped result counts as success. Review a failed fixture report before retrying.

Restart preserves service files and project volumes:

```sh
docker compose -p workspace-pr99-medusa -f acceptance/medusa/compose.yaml restart
```

`stop` stops these project services without removing data. There is deliberately no volume-removal, credential rotation or database-reset recipe. Backups and restoration need a separate reviewed operator procedure before business use.

Source-level checks and remaining live blockers are recorded in [the deployment handoff](../../docs/OMP-DEPLOYMENT-PREPARATION-20261017.md). Official guidance: [Medusa deployment](https://docs.medusajs.com/learn/deployment/general) and [the pinned native user command](https://github.com/medusajs/medusa/blob/v2.21.2/packages/medusa/src/commands/user.ts).
