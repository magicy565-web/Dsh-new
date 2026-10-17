# Official Medusa Admin static deployment handoff

Status: source/build preparation; image build and browser acceptance are pending. Baseline: PR99 `36d7cf97304212af63d39463d6cc71001ddccca2`.

## Scope

The existing UI image now builds the official, locked Medusa 2.21.2 Admin with `medusa build --admin-only`. It no longer builds `apps/medusa-product-catalog`; those source files are retained. No replacement dashboard, new dependency version, administrator, database or authentication mechanism is added.

The original backend `apps/medusa-acceptance/medusa-config.ts`, API Dockerfile, package/locks and provider-audit hashes remain unchanged. A short config wrapper exists only in the UI build stage: it loads the original configuration and overrides Admin options to `disable: true`, `path: '/dashboard'`, and `backendUrl: ''`. It is not copied to the API image or the static output directory. Build-only placeholder connection values are used; no service secret or environment file enters the context.

The official 2.21.2 compiler explicitly builds Admin-only output even when backend Admin is disabled, and writes `.medusa/admin`. The image copies only that output to `/usr/share/nginx/html/dashboard/`. See [official separate build guidance](https://docs.medusajs.com/learn/build#separate-admin-build) and the [pinned compiler](https://github.com/medusajs/medusa/blob/v2.21.2/packages/core/framework/src/build-tools/compiler.ts).

The pinned bundler uses `admin.path` as Vite's base and preserves the empty backend URL. The dashboard passes that value to the original JS SDK; its `getBaseUrl` explicitly resolves an empty string to `window.location.origin`. Thus API requests use the existing same-origin restricted proxy, not the build machine or a new external endpoint. Sources: [bundler configuration](https://github.com/medusajs/medusa/blob/v2.21.2/packages/admin/admin-bundler/src/utils/config.ts), [dashboard client](https://github.com/medusajs/medusa/blob/v2.21.2/packages/admin/dashboard/src/lib/client/client.ts), [SDK client](https://github.com/medusajs/medusa/blob/v2.21.2/packages/core/js-sdk/src/client.ts).

Only the 4173 UI listener changes its static route: `/` and `/dashboard` redirect to `/dashboard/`; dashboard routes fall back to its official index; missing `/dashboard/assets/` files return 404. The existing API proxy allowlist is unchanged. The entire 9000 listener, loopback port publication, CORS, production environment, secure session-cookie behavior and service credentials remain unchanged. No catchall API proxy is added.

## Operator checks and build

Use the existing durable source/deployment directory and original Compose project. Apply only the reviewed patch after verifying every declared preimage SHA, not a whole-branch pull. The original API configuration SHA256 remains `da8cf186c8335ada5b7332cfbe1528ad8b3b10ed5ce9d445bebcc4218f960791`.

The following are handoff commands, not a record of execution. Preserve the current UI image and old nginx configuration before applying the patch. Keep the original API container ID/start time for a before/after comparison. `$BACKUP` is a new operator-owned backup directory outside the build context; it contains source configuration only.

```sh
COMPOSE=(docker compose -p workspace-pr99-medusa -f acceptance/medusa/compose.yaml)
OLD_UI_IMAGE=$(docker inspect --format '{{.Image}}' "$("${COMPOSE[@]}" ps -q ui)")
docker image tag "$OLD_UI_IMAGE" workspace-pr99-medusa-ui:before-official-admin-20261017
cp acceptance/medusa/nginx.conf "$BACKUP/nginx.conf"

# Apply the reviewed source patch only after checking its before hashes.
"${COMPOSE[@]}" config --quiet
"${COMPOSE[@]}" build ui
"${COMPOSE[@]}" run --rm --no-deps --entrypoint nginx ui -t
```

Before switching the existing UI, inspect the built image's `/usr/share/nginx/html/dashboard/index.html` and all its referenced script/stylesheet files. Confirm that references remain under `/dashboard/`, the files exist with correct MIME types, and the bundle uses the same-origin backend. Check that the original API configuration, image/container and package/lock hashes have not changed. Build failure is not permission to alter integrity pins or install replacement packages.

Only after review and operator deployment authorization:

```sh
"${COMPOSE[@]}" up -d --no-build --no-deps ui
curl --fail --head http://127.0.0.1:4173/dashboard/
curl --fail http://127.0.0.1:9000/health
```

This UI-only operation does not invoke the API entrypoint or `db:migrate`. Do not use `start.sh`, `up` without a service/`--no-deps`, API rebuild/restart, account creation or migration commands for this change.

## Acceptance and rollback

The first browser acceptance is the official login page, its JavaScript/CSS and same-origin request paths, with no page errors. Check root redirect, dashboard deep-link fallback, missing asset 404 and unrelated path 404. Confirm API container identity/start time is unchanged and existing backend health remains available. Static source checks do not replace the actual image build or browser result.

Do not enter credentials or claim login/product administration passed during this check. The original production secure session cookie is retained. Approved HTTPS ingress is a separate prerequisite for a normal authenticated browser session; do not set `secure: false`, downgrade `NODE_ENV`, change auth type, widen CORS, publish ports or create a user to make this check pass.

If the UI-only switch fails, restore the preserved source nginx configuration and previous UI image, then recreate only UI:

```sh
cp "$BACKUP/nginx.conf" acceptance/medusa/nginx.conf
docker image tag workspace-pr99-medusa-ui:before-official-admin-20261017 workspace-pr99-medusa-ui:0.1.0
"${COMPOSE[@]}" up -d --no-build --no-deps ui
```

Rollback does not remove a volume, mutate the database, delete source history or change API credentials. Retain the reviewed patch and failure evidence for diagnosis; do not run repeated uncontrolled builds or change security defaults.
