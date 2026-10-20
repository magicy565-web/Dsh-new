# @workspace-harness/kernel

The kernel of the Workspace Harness. It loads a YAML composition, resolves plugin
entries, mounts them on a [Cordis](https://github.com/cordiverse/cordis) 4 context in
`requires` order (fail-closed with rollback), and serves HTTP with `node:http`.
Only dependencies: `cordis@4.0.0-rc.11` and `yaml@2` (both in the repo root
`package.json`). No Express/Koa.

Contract reference: `packages/harness-contracts/CONTRACT.md` §§2–4.

## Public API

```js
import { createHarness } from './packages/harness-kernel/src/app.mjs';

const harness = await createHarness({
  compositionPath: 'harness.local.yml',
  root: process.cwd(),   // plugin-name resolution root (rules 1/2)
  logger: console,       // error/warn/info/debug sink, default console
});

await harness.start();   // → { server, address: { address, host, family, port, url } }
harness.healthz();       // → { status: 'ok'|'degraded', plugins: [{id,status,error?}], checks }
harness.rows;            // validated composition rows
harness.plugins;         // Map<row.id, { id, manifest, entry, fiber, status, dispose() }>
harness.ctx;             // Cordis Context (ctx.http / ctx.health plus plugin services)
await harness.stop();    // closes the server, disposes plugins in reverse mount order
```

Mounting happens in `createHarness` (so `ctx.http.route` is registered before
`start()`); only the listening socket is opened by `start()`. Any resolution,
manifest, config, dependency, duplicate-service, route-conflict or `apply` error
rejects `createHarness` with a `HarnessError`; already-mounted plugins are disposed
in reverse order first.

## Plugin resolution (CONTRACT §2)

| `row.name` | Resolution |
|---|---|
| `@workspace-harness/<pkg>/<entry>` | `packages/harness-<pkg>/src/<entry>.mjs` (rule 1); `@workspace-harness/seams/storage` → `packages/harness-seams/src/storage.mjs` |
| `name` (no prefix) | `plugins/<name>/harness.plugin.json`, entry relative to that dir (rule 2) |
| `./path` / `../path` | resolved against the composition file's directory (rule 3); dir with manifest or a module |

Entry modules may export any of:

- `apply(ctx, config)` (also `export default` function/object or `plugin` export) —
  the Cordis plugin shape; a returned function/promise-of-function is the disposer;
- a single `create*Provider`/`create*Plugin` factory (e.g.
  `createStorageProvider(config) → { apply(ctx, config) }`) — used by
  `packages/harness-seams`; the factory is called once at mount with the row config;
- `manifest` (validated by `validateManifest`) and optional `requires`/`provides`
  arrays. Rule-1 modules without a manifest get a synthetic manifest
  `{id: row.id, kind: 'provider', provides: [row.id], requires: []}`, so their
  composition order is preserved.

`requires` names services; `provides` names services. Missing provider →
`HARNESS_PLUGIN_MISSING_DEPENDENCY`; two rows providing one service →
`HARNESS_PLUGIN_DUPLICATE`. Rows with `disabled: true` are never imported/mounted.

## HTTP (CONTRACT §4)

`ctx.http.route({ method, path, handler })`, `ctx.http.health(name, fn)` and
`ctx.health.register(name, fn)` are available to plugins; `GET /healthz` is
built-in and can never be overridden (a plugin registering it fails startup).

- Handler: `(req, res, context) => Response | { status, body }`; JSON responses.
  `context = { method, pathname, query, params, actor, body }`.
- Actor: `x-harness-actor` / `x-harness-role` / `x-harness-workspace` headers,
  default `{ subject: 'local-operator', role: 'admin', workspaceId: 'local' }`.
- Paths support one-segment `:param` patterns; params are percent-decoded and are
  rejected with `400 HARNESS_HTTP_INVALID_PATH` on malformed encoding. Static
  routes always win over parameterised ones. No trailing-slash tolerance.
- Two parameterised patterns that can match the same concrete path (e.g.
  `/leads/:id` vs `/leads/:leadId`) and duplicate `method path` registrations are a
  startup failure. `/leads/:id` and `/leads/:id/identity` do not conflict.
- Unknown route → `404 {"error":{"code":"HARNESS_ROUTE_NOT_FOUND",...}}`; bad JSON
  body → `400 HARNESS_HTTP_INVALID_BODY`; other exceptions → `500` with a generic
  message (no stack/message leak).
- `HarnessError` mapping (kernel-frozen, exported as `ERROR_STATUS` from
  `src/http.mjs`): manifest/composition/tool invalid → 400, tool/approval refusal →
  403, `approvalRequired` → 403, plugin/tool duplicate → 409,
  plugin/missing-dependency/storage failures → 500. An explicit numeric
  `error.status` wins.

## CLI

```sh
node packages/harness-kernel/bin/wh.mjs list   --composition harness.local.yml [--json]
node packages/harness-kernel/bin/wh.mjs doctor --composition harness.local.yml [--json]
```

`list` resolves every row (entry path, status `resolved|missing|invalid|disabled`,
requires/provides) without mounting anything; missing packages are reported, never
crashed on. `doctor` mounts the composition without serving, prints the health
report and disposes; exit code 0 iff `status: 'ok'`.

Root entry: `node harness.mjs [--composition harness.local.yml] [--root <dir>]`
boots, prints the URL, serves, and shuts down cleanly on `SIGINT`/`SIGTERM`.

## Cordis 4.0.0-rc.11 caveats (important for the next agent)

- There is **no `ready` or `dispose` lifecycle event** anymore. A plugin's
  lifecycle = the disposer it returns from `apply` (or `ctx.effect(...)`).
- Plain `ctx.storage = value` inside `apply` throws ("cannot set property without
  provide"). Publish services with `ctx.provide(name, value)` (returns an async
  disposer, which must be disposed on teardown) or subclass `cordis` `Service`.
- A service provided by a **sibling plugin fiber** is only visible to a plugin
  whose Cordis plugin object declares `inject` (`{ inject: { storage: null }, apply }`).
  The kernel derives that `inject` map from `manifest.requires` (minus kernel
  services and self-provided names); plugins that read a service not declared in
  `requires` fail at apply time.
- `await ctx.plugin(...)` also resolves for a fiber stuck in `PENDING` when injected
  services never appear; the kernel therefore checks `fiber.state === ACTIVE` after
  mount and fails closed otherwise.
- Errors thrown inside `apply` are logged by Cordis itself as well as rethrown as
  `HARNESS_PLUGIN_FAILED`; the kernel forwards Cordis log messages (message only,
  no stack) to the injected `logger`.
- `node --test <directory>` treats the argument as a glob/file in Node 24 (a bare
  directory fails with MODULE_NOT_FOUND). `test/package.json` + `all-tests.mjs`
  make the contract command `node --test packages/harness-kernel/test` work; the
  individual `test/*.test.mjs` files also run directly.

## Agent presets

A preset is a capability profile over a base composition: persona + extra plugin
rows + allowed/denied tool names + skills + optional model metadata. Presets never
grant authority; they only select what the base composition already provides.
`composePreset` injects `allowedTools`/`deniedTools` into the `tools` row, so a
mounted preset cannot call a tool it did not declare.

```sh
node harness.mjs --preset inquiry-analyst          # boot the harness as this agent
wh presets list [--json]                            # scan <root>/presets/*.yml
wh presets show growth-manager [--json]
```

```js
import { listPresets, loadPreset, composePreset } from './packages/harness-kernel/src/presets.mjs';

const composed = await composePreset(await loadPreset('growth-manager', { root }), { root });
// → { composition, preset, persona, tools, denyTools, skills, model }
```

Rules: `version: 1`, kebab-case `name`, required `title` (≤120) and `persona`
(≤8000), ≤32 plugin rows (duplicate ids refused, base rows overridden by id),
`tools`/`denyTools`/`skills` are bounded identifier lists (a tool cannot be both
allowed and denied), `extends` must be a relative composition path inside the
repository. Two real presets ship in `presets/`: `growth-manager` (may request the
approval-gated select tool) and `inquiry-analyst` (read-only; denies select).

## Composition patches

A patch layer changes an existing composition without editing it (see
`harness.patch.example.yml`):

```yaml
version: 1
name: offline-readonly
entries:
  - id: inquiries            # target an existing row by id
    disabled: true
  - id: tools                # config replaces the row config wholesale
    config: { allowedTools: [inquiry_recovery_status] }
insert:
  - id: market               # append a row the base composition omits
    name: workspace-market
    config: { demo: true }
```

```sh
node harness.mjs --composition harness.dev.yml --patch harness.patch.example.yml
wh plugins --composition harness.dev.yml --patch harness.patch.example.yml [--json]
```

`createHarness({ compositionPath, patchPaths: [...] })` applies layers in order;
validated inline patches also work via `{ patches: [document] }`. Patches fail
closed on an unknown target id, a duplicate insert id, a rename attempt, or a
malformed layer — a typo can never silently disable nothing. `harness.patches`
exposes the applied actions. This is the runtime enable/disable mechanism: a
patched-out row is never imported, so its routes, tools and health entry all
disappear together.

## Tests

```sh
node --test packages/harness-kernel/test     # 57 tests, 0 fail
node node_modules/typescript/bin/tsc --noEmit
```

Coverage: manifest/composition validation errors, all three resolution rules,
dependency ordering, missing dependency, reverse-order rollback, duplicate service,
disabled rows (module that throws on import is never imported), route conflicts
(exact, cross-plugin, overlapping `:param`, built-in `/healthz`), `:param`
decode/priority/no-trailing-slash/malformed-encoding, `/healthz` shape, 404 JSON,
actor headers, POST body/query, `HarnessError` status mapping, 500 no-leak, JSON
body errors, clean stop, CLI `list`/`doctor`/`presets` and usage errors, patch
override/insert/disable semantics and fail-closed edge cases.

## Not wired yet (owned by other work packages)

- `harness.local.yml` has no `inquiries` row yet; `plugins/workspace-inquiries`
  (work package C) is left as a commented example line. Once that plugin lands,
  uncomment the row — its manifest `requires: [tools, storage, approval]` will be
  topologically ordered after the three seam rows.
- `harness.local.yml` does mount the `market` row (`plugins/workspace-market`,
  `config.demo: true` for the local composition). It serves `/market` and
  `/api/market/*`; the demo catalog is explicit and the computer runtime stays
  `off`, so screens stay unavailable.
- Other agents own `packages/harness-contracts/**`, `packages/harness-seams/**`,
  `plugins/**`, `server/**`; this package only imports the frozen contracts.
