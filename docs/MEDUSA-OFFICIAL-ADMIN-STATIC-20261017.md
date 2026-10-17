# Official Medusa Admin static deployment handoff

Status as of 2026-10-17 19:53 UTC: official Admin static image and unauthenticated login-page acceptance passed on the server; only UI was replaced. Authenticated login and HTTPS ingress remain pending. Original preparation baseline: PR99 `36d7cf97304212af63d39463d6cc71001ddccca2`. The running-image/source distinction is recorded below.

## Scope

The existing UI image now builds the official, locked Medusa 2.21.2 Admin with `medusa build --admin-only`. It no longer builds `apps/medusa-product-catalog`; those source files are retained. No replacement dashboard, new dependency version, administrator, database or authentication mechanism is added.

The original backend `apps/medusa-acceptance/medusa-config.ts`, API Dockerfile, package/locks and provider-audit hashes remain unchanged. A build-only script verifies the exact original config SHA256 and its unique `admin: { disable: true }` fragment, then changes only that fragment in the UI build-stage copy to add `path: '/dashboard'` and `backendUrl: ''`. The original framework import and `defineConfig` remain intact; no wrapper module or duplicate backend config is compiled. The script is not copied to the API image or the static output directory. Build-only placeholder connection values are used; no service secret or environment file enters the context.

The official 2.21.2 compiler explicitly builds Admin-only output even when backend Admin is disabled, and writes `.medusa/admin`. The image copies only that output to `/usr/share/nginx/html/dashboard/`. See [official separate build guidance](https://docs.medusajs.com/learn/build#separate-admin-build) and the [pinned compiler](https://github.com/medusajs/medusa/blob/v2.21.2/packages/core/framework/src/build-tools/compiler.ts).

The pinned bundler uses `admin.path` as Vite's base and preserves the empty backend URL. The dashboard passes that value to the original JS SDK; its `getBaseUrl` explicitly resolves an empty string to `window.location.origin`. Thus API requests use the existing same-origin restricted proxy, not the build machine or a new external endpoint. Sources: [bundler configuration](https://github.com/medusajs/medusa/blob/v2.21.2/packages/admin/admin-bundler/src/utils/config.ts), [dashboard client](https://github.com/medusajs/medusa/blob/v2.21.2/packages/admin/dashboard/src/lib/client/client.ts), [SDK client](https://github.com/medusajs/medusa/blob/v2.21.2/packages/core/js-sdk/src/client.ts).

Only the 4173 UI listener changes its static route: `/` and `/dashboard` redirect to `/dashboard/`; dashboard routes fall back to its official index; missing `/dashboard/assets/` files return 404. The existing API proxy allowlist is unchanged. The entire 9000 listener, loopback port publication, CORS, production environment, secure session-cookie behavior and service credentials remain unchanged. No catchall API proxy is added.

## Initial build failure and correction

The first server UI-only build of `e8ae63722af0172036f55fc18af3b9756778f4a9` stopped at TypeScript error TS2591 (`Cannot find name 'require'`) in the standalone wrapper. No UI switch occurred. Build-log SHA256: `6e130508577683784ff0525a84b585c546a97a0b84322e7a3d0e091e747e478e`. The correction removes the wrapper and applies the exact checked build-only transform described above. Original TypeScript configuration, dependencies/locks and API files are unchanged. Local transform checks cover exact output plus refusal without writes for changed, duplicate and already-transformed input; the subsequent server build and browser result are recorded below.

## Observed server acceptance

The corrected build `4fa16bbad4ac4b07cc4490398779fd35a976833e` completed with exit 0. Build-log SHA256: `3da4d5dc400247b317e3f4631881858ec7f701d90d5ba2a7ad87dc92bdf2195f`. The operator's private patch-application umask initially left the public nginx config at 0600, so unprivileged nginx refused it before any UI switch. Only that exact nonsecret file was restored to its intended 0644, preserving owner/group; a targeted rebuild succeeded. That rebuild log SHA256 is `498020a2dcb9a59d0245dc96fffa760a65b6150e26043ddc5518dc5421e054c0`.

The accepted image is `sha256:55bf20ec5e9d2d4ab19090f59113ef6861379bb22cb4d96fb45c524a38b78866`, built from the reviewed **4fa16bb patch plus the public-file mode correction** on the existing deployment source. It is not a deployment of the entire development branch. `db04918440c1a1c1af18ef31f47efa47b44f5cbd` subsequently made the COPY mode explicit and was aligned in server source only; no later rebuild/recreation was claimed.

The official output contained 358 files / 10.2 MB. The final verifier accepted only the official exact empty favicon `data:,` or existing `/dashboard/` assets, and found no build-only secret placeholders. The initial overly strict favicon-check failure was retained. Nginx configuration testing passed with its original unprivileged user. The operator then recreated only UI using the existing Compose project with `up -d --no-deps --no-build --pull never ui`.

Observed routes: `/` and `/dashboard` redirected with 302; `/dashboard/` and `/dashboard/login` returned 200; referenced JavaScript and CSS returned 200 with correct MIME types; missing dashboard assets and unrelated routes returned 404. API and Docling health remained 200. API, PostgreSQL and Redis IDs/start times/images remained unchanged, with before/after identity-record SHA256 `74063a1967547253028bb87633dcc60c58cfaef1f8396898a888047ee950afb7`. Original runtime API config remains `da8cf186c8335ada5b7332cfbe1528ad8b3b10ed5ce9d445bebcc4218f960791`.

A fresh Chromium 156.0.8078.4 context with its normal sandbox rendered the styled official **Welcome to Medusa** login page. Email/password fields remained empty; page errors and failed JS/CSS requests were zero. The 17 same-origin GET responses comprised 14 × 200, two unauthenticated `/admin/users/me` × 401 and one unexposed `/cloud/auth` × 404. No catchall/cloud-auth route was added. Screenshot SHA256: `f85a2e2874da8697d03a6f4a301603826813090d6992a8af8ac227338eabc835`; browser-report SHA256: `f3a3cc4f3281a04ba1af462839dcc6ac25bc29c99c5482f8340e8f3192f8f22d`. Only hashes and this desensitized account are committed; raw logs, screenshots, reports and runtime configuration are excluded.

This verifies official UI rendering and existing backend reachability. No credentials were entered, no account/product was changed, and authenticated Admin CRUD was not tested. Production secure cookies, CORS, NODE_ENV, loopback ports and API/DB services remain unchanged. HTTPS ingress and user-controlled formal login require their separate authorized acceptance.

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
