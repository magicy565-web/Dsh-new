# Native Medusa model read and selected-plugin build

Development base: `42d5273ef53bcfe247e4a5dc88c83b766c4037f0` on
`codex/medusa-isolated-acceptance-prep-20261018`. Delivered on the existing PR120
branch. No main integration, server access, deployment or real-service sign-off.

## Implemented behavior

An independently reviewed native `prod_*` product and selected Library document
can now reach the default `WORKSPACE_OMP_PROFILE=business` OMP model path. The
original Artifact API saves the completed result; the original native Session
continues the next message. No Library UUID product copy, second product
registry, grant store, Agent loop, ledger or automatic save is introduced.

The optional `libraryModelReadPolicy.nativeMedusa` contract is absent/disabled by
default. It reuses the original policy's exact workspace/member, normalized
provider/model/destination and expiry, plus the original live native Session.
It additionally requires `enabled:true`, `reviewed:true`, one exact `sourceId`
and fixed Medusa `baseURL`, at most eight `(productId, reviewVersion, sourceHash)`
pins and a nonempty field mask from `title`, `description`, `agent_summary`.
Unknown fields, UUIDs in the native selection, malformed pins and missing
selected values are refused. Optional loopback HTTP must be explicit; redirects,
credential-bearing URLs, response sizes/timeouts and known credential echoes
remain constrained by the original approved-source transport.

Only this independent contract exposes the additional `workspace_medusa_context`
tool. Its product ID comes from the locally authorized status metadata; callers
cannot select fields, a receiver, URL, revision, permission or credential.
Original UUID preview/reconcile inputs and defaults are unchanged. An optional
native status response preserves the legacy connection view and adds separate
native selection metadata. Space's existing source remains title/reference-only
with `modelAccess:false`; its source object cannot perform a model projection.

The Host binds the complete normalized contract fingerprint to the original
`businessAgentSession`. Adding/removing/changing a contract cannot silently
inherit an existing transcript. Original current Session, recipient, expiry and
trusted contract withdrawal are checked before reads and after asynchronous
checks. Original native business receipt refresh re-reads the remote approval;
call arguments, text/details and actual wire tool results must agree. The
existing Node business-facts wire boundary and the final boundary after worker
exit recheck native disclosures, then close the last awaited authorization with
synchronous original document and native-policy fences. Remote HTTP consistency
is explicitly `remote-point-in-time`: no atomic remote lock or elimination of
all subsequent remote races is claimed. The old receipt migration/restore work
and PR112 are untouched.

A loaded private file is a startup snapshot, like the original Library policy.
Changing/withdrawing deployment files requires the original restart and Session
revocation process; this patch adds no hot grant-edit API. The trusted in-process
policy object also fails closed if changed or withdrawn. A changed source or
contract requires fresh explicit review and a fresh conversation, not automatic
transcript adoption.

## Configuration difference for the separate deployment executor

- No optional native contract: existing startup and UUID behavior remain unchanged.
  The explicit disabled shape is `"nativeMedusa": {"enabled": false}`.
- Future approved enablement uses the fields above inside the existing private
  `WORKSPACE_BUSINESS_REVIEW_FILE` Library policy. The original reviewed document,
  exact complete-file parser-transfer consent, model receiver and budget remain
  required; native disclosure alone grants none of them.
- A new explicit `WORKSPACE_MEDUSA_MODEL_READ_TOKEN_FILE` supplies transport for
  that reviewed source only. It must be a bounded private canonical regular file,
  mode 0600, owned by the operator/root. A Space file/path/inode or an Admin token
  cannot be silently reused; there is no environment/token/Space fallback. Token
  bytes alone never authorize model disclosure. This work creates no real token
  or real grant. Programmatic trusted composition has the corresponding
  `nativeMedusaModelConnection` option. The original Medusa backend/plugin must
  remain enabled. No database migration or dependency/lockfile changes.

## Build and inventory repair

`build:omp` previously evaluated every installed plugin, including unselected
ERPNext with its absent optional peer. It now statically compiles all installed
packages but only discovers/loads the original explicitly enabled selection.
Unselected output reports `nativeDiscovered:false` and `nativeLoaded:false`.
Enabled missing peers and even disabled syntax defects still fail. Original
Bun/OMP loader regression cases went from 0/3 before the fence to all 6 passing.

The two initial `15 !== 14` failures were different files from those repaired
in `a819897d9212212afab8f12683d212971c982e8b`. That commit fixed
`workspace-omp-cloud-acceptance.test.mjs` and its fixture; both the unified test
and the older plugin test/fixture still contained 14 in that commit and in the
fixed 42d5273e tree. The affected tests now assert the same complete explicit
15-ID set, rather than only a number. The older all-packages loader test provides
ERPNext's declared original Free Trade peer by offline npm packing and per-file
byte comparison in its disposable environment. No registry dependency, hook,
replacement client or production plugin installation is added.

## Actual validation

Node 24.19.0, official pinned Bun 1.3.14 and OMP 18.10.4; original root/support
lockfiles with lifecycle scripts disabled. Counts below overlap across commands;
do not add repeated tests together.

| Check | Final observed result |
| --- | --- |
| `medusa-native-mainchain-sdk` + `medusa-native-model-read` | 21 passed, 0 failed/skipped: eight default-startup cases plus thirteen contract/transport/receipt cases |
| `workspace-omp-medusa-enterprise` + `workspace-native-document-mainchain-sdk` | 39 passed, 0 failed/skipped: old UUID/enterprise composition and original document choices remain compatible |
| `workspace-omp-build-lifecycle`, `workspace-omp-unified`, `workspace-omp-plugins`, `medusa-catalog-http` | 13 passed, 0 failed/skipped, including the full explicit 15-package inventory and original Session lifecycle |
| Contract, Space source/startup, native/UUID boundary, catalog, backend lifecycle, existing Library result DOM/SDK group | 37 passed, 0 failed/skipped; includes original explicit result-save button and UUID continuation |
| Cloud fixed-inventory/native-loader cases selected by name | 2 passed, 0 failed/skipped; the SIGTERM/recovery case was not selected or claimed |
| `npm run build:web` | Passed typecheck/production build before the server-only changes; existing large-chunk warning; no frontend source changed |
| `npm run build:omp`, Node syntax checks, `git diff --check` | Passed; pack closure and native selected-loader checks included |

The default native test uses `startWorkspaceServer` with its private reviewed
file and real default business assembly. It asserts four finite provider
requests in turn one, exact allowed native fields and document text, one
original Artifact save/download with matching SHA256, then one request using
the same persisted native Session. No UUID product is invented. Revision/hash
changes and withdrawal prevent the next model request; an altered/legacy
contract binding cannot inherit the transcript. Missing native authorization
advertises no native tool and performs no source read. Expiry is rejected before
Run admission. Cross-member conversation access is refused. Original Run cancellation aborts an in-flight native source request and withholds completion. Contract tests also
cover receiver changes, policy/Session revocation, missing fields, credential
file isolation, forged call/wire proof and mutable response-copy isolation.

Initial failures remain part of the record: the first build failed on the absent
optional peer; old inventory assertions failed on 15/14; the initial expanded
build test expected a wrapper but Bun emitted `AggregateError`; and the first
private-file test made a hard link before its positive check, which the original
file guard correctly refused. The fixture now performs the valid-file check
before the alias rejection. The cloud loader fixture also exposed its missing declared peer; offline packing was moved to the Node test setup because the intentionally restricted Bun PATH excludes npm. The restricted child PATH was preserved. No security guard or failing assertion was removed.

Real: original signed HTTP/Session/CSRF, Library/Store/Artifact bytes, production
chat bundle in JSDOM for the old save path, original Run and pinned native SDK.
Finite: model SSE/choices, local Medusa/Docling HTTP, synthetic short-lived test
identities, reviewed policy and token values. No real Medusa/PostgreSQL, container,
image, production identity, parser/model request, paid call or deployment was run.
No full repository suite or real browser acceptance is claimed. No runtime data,
private configuration, real credential values or raw logs are committed.

## Actions run 39135431986

Read-only inspection confirmed fixed head 42d5273e, `startup_failure`,
`path:BuildFailed`, zero jobs and zero commit check-runs. The available connector
has no accessible failure annotation, and shell `gh api` was forbidden. Root
cause remains unconfirmed; neither an account/quota issue nor a workflow-code
defect is established. The local build repair is not claimed to repair this
pre-job failure. No workflow/settings/permission/billing/rerun changes.
