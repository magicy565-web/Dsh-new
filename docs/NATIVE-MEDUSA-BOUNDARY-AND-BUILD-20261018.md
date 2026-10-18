# Native Medusa model boundary and selected-plugin build

Base: `42d5273ef53bcfe247e4a5dc88c83b766c4037f0`, retained on the
`codex/medusa-isolated-acceptance-prep-20261018` development line. No main
integration, server access, deployment, paid call or real-service acceptance.

## Reproduced build defect and fix

After installing only the original root/support lockfiles without lifecycle
scripts, `npm run build:omp` failed with `NATIVE_PLUGIN_LOAD_FAILED` for
`workspace-erpnext-enterprise`: its optional `@workspace-agent/pi-free-trade`
peer was not installed under that package. The default configuration does not
select this plugin. The native build nevertheless discovered and evaluated
every installed plugin, unlike the original runtime selection contract.

`scripts/build-omp-native.mjs` now retains Bun static compilation for **all**
installed packages, then runs official discovery/loading only for packages
enabled by the existing `projectPlugins` result. Disabled rows explicitly report
`nativeDiscovered:false`, `nativeLoaded:false`, and no registered tools. No peer
is installed automatically, no relative-import substitute is introduced, and
an enabled plugin with a missing peer still fails. A disabled plugin with invalid
syntax still fails compilation. The exported helper allows the same production
build path to be exercised using the original compiler and loader.

Before the selection fence was added, the new unselected/disabled/none cases all
failed by trying to resolve the synthetic absent peer: 0 passed, 3 failed.
Final focused run: 8 passed, 0 failed, 0 skipped. The first expanded run was
7 passed/1 failed because Bun reports malformed-source compilation as an
`AggregateError`; the test expectation was corrected to accept that observed
compiler failure as well as the script's existing compile-error wrapper.

The reviewed integration, plugin-service, enterprise-memory-isolation and
continuation branch tips were compared for this build script before editing.
None supplied this fix; the old continuation branch does not contain the script.

## Native product gap: reproduced, not repaired by weakening authorization

`test/medusa-native-model-boundary.test.mjs` exercises the original signed
HTTP/Session, Store, Library and Space with a finite native `prod_*` source:

1. The reviewed source can be listed, pinned and saved in a Space page. Its
   original revision/fingerprint resolves as current. `modelAccess` remains false;
   remote description and Agent summary are not exposed through that projection.
2. Selecting the same native ID through the original conversation Library
   reference API returns 400 `INVALID_INPUT`; references stay empty. No Library
   product, Run, generated Artifact or product-authority copy is created.
3. Both original Medusa model preview/reconcile operations refuse the native ID
   before invoking the Library-only client or its authorization callback.

These passing refusal tests demonstrate an **unimplemented user flow**, not a
successful native Medusa generation/save/continuation flow. The existing combined
Medusa/enterprise SDK tests use Library UUID products; the configured Medusa
responder returns an empty `/admin/products` list. They do not establish native
Medusa model reads.

Fixed-base production evidence:

- `server/pi-business-agent.mjs:255` constructs the model Medusa client only from
  original `factoryMaterialsAuthorityForSession` and Library materials.
- `plugins/workspace-medusa-catalog/src/service.mjs` admits UUID product IDs only.
- `plugins/workspace-medusa-catalog/src/product-client.mjs` reads Library preview
  and deliberately returns `remote.product:null` from reconciliation.
- `plugins/workspace-medusa-catalog/src/approved-source.mjs` returns a native
  title/reference for Space and marks catalog output `modelAccess:false`.
- `server/index.mjs` assembles that source only into Space; business Agent
  attachment receives no native source. `loadReviewedBusinessOptions` has no
  native-product model-disclosure policy field.

The native source's read credential, Medusa review status, Space reference, and
Library model-read policy are distinct authorities. Reusing any of them as
native-model consent would invent a grant. No such reuse is implemented here.

Minimum contract decision for a subsequent implementation: approve a separate,
default-off native-product model selection bound to the original workspace/member,
exact model recipient, expiry, and `(sourceId, productId, reviewVersion,
sourceHash)` tuple. Decide its field mask; the smallest proposed first slice is
`title`, `description`, and `agent_summary`, excluding commercial policy, evidence,
variants and credentials. Reuse the original Session/Run cancellation, current
authorization, source-change and final-disclosure gates, plus the original
Artifact save and native Session. Do not convert native IDs into Library UUIDs,
introduce a second authority, or migrate old private receipts. Every model-send,
delivery/save and continuation gate must retain the same complete native source
obligation. The existing read token would remain transport-only, with no new
credential generated. That contract and its production wiring remain pending;
this patch changes no disclosure option or enablement default.

## Actual checks in this task

Environment: Node 24.19.0, pinned official Bun 1.3.14 / OMP 18.10.4; original
lockfiles installed with `npm ci --ignore-scripts --no-audit --no-fund` in root
and the two support packages. No dependency/lockfile changes or package stubs.

| Check | Observed result |
| --- | --- |
| `npm run build:web` | Passed typecheck and production build; existing large-chunk warning |
| `npm run build:omp` before/after | Failed missing optional peer before; passed after, including pack closure, static compilation and selected original SDK loading |
| `node --test --test-concurrency=1 test/workspace-omp-build-lifecycle.test.mjs test/medusa-native-model-boundary.test.mjs` | 8 passed, 0 failed/skipped |
| `node --test --test-concurrency=1 test/space-medusa-startup.http.test.mjs test/space-medusa-source.test.mjs test/medusa-catalog.test.mjs test/workspace-library-result-sdk.dom.test.mjs` | 17 passed, 0 failed/skipped; actual signed startup, Library/Artifact/Store, production DOM bundle, official SDK and same native Session; finite model/Docling/Medusa |
| `node --test --test-concurrency=1 test/workspace-omp-medusa-enterprise.test.mjs` | 33 passed, 0 failed/skipped; Library product composition, not native Medusa product acceptance |
| `npm run test:omp` | 4 passed, 1 failed: pre-existing `15 !== 14` inventory assertion in `workspace-omp-unified.test.mjs`; retained |
| `node --test --test-concurrency=1 test/workspace-omp-plugins.test.mjs test/plugin-backend-lifecycle.test.mjs test/medusa-catalog-http.test.mjs` | 6 passed, 1 failed: pre-existing `15 !== 14` assertion in `fixtures/workspace-omp-plugins.mjs` before its subsequent loader/Session checks; retained and not counted as executed |
| `node --check scripts/build-omp-native.mjs`, `git diff --check` | Passed |

No full repository suite, real browser, real Medusa/PostgreSQL, temporary Medusa
image/container/test identity, real parser/model, paid request or deployment was
run. Synthetic fixture identities are temporary test data. No secrets, journals,
runtime files or raw logs are committed. Repeated checks are not added together.

## GitHub Actions startup failure

Read-only GitHub connector inspection of [run 39135431986](https://github.com/magicy565-web/workspace-agent/actions/runs/39135431986)
confirmed head `42d5273e…`, event `push`, `path:BuildFailed`,
`conclusion:startup_failure`, empty name, and zero jobs; the commit's check-runs
collection is also empty. The only tracked workflow is
`.github/workflows/ai-worker-preview.yml`; its push branch filter does not include
this development branch. No job or step log establishes an application build
failure. The connector does not expose the suite's failure annotation through its
allowed endpoint surface, and shell `gh api` requests were forbidden.

The root cause therefore remains **unconfirmed**. There is no evidence here to
label it an account/permission/quota problem or a workflow-code defect. The local
OMP build bug above must not be represented as the cause or repair of this
pre-job failure. No workflow, account setting, permission, billing, rerun or
deployment action was changed.

## Version/configuration note for the separately arranged deployment

This development delta only fixes selected-plugin build loading and adds tests
and this record. No application configuration, environment variable, API schema,
runtime dependency, database, credential or default enablement changes. Continue
using the original reviewed release/configuration process. This patch does not
make native Medusa products available to a model; that path remains blocked by
the missing explicit disclosure contract described above.
