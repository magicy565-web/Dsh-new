# Native fact bounded transport: isolated SDK acceptance passed

Date: 2026-10-17. The repaired six-file run passed 63/63 with the original SDK
and a finite synthetic provider. The first run failed 61/63 as recorded below;
only two synthetic test files changed before the successful rerun. This does not
claim real paid-provider, upload-to-fact business, unified UI or deployment acceptance.

## Exact source and scope

The five production preimages are unchanged between code baseline
`ab3302ed25c2363418aad0a808b6dd6b5140ff42` and development HEAD
`867b85bfb20a9aa52cdf057250028c40f9ed02a4`; all five plus the original test fixture
were fetched again and compared in full. Independent HTTPS commits are separate.

Nine source/test paths are in the reviewed patch: five existing production files,
one existing synthetic fixture and three new test files. Patch: 88,247 bytes,
SHA256 `ba55761ba3951ef52e2454faf28edca19524be82f26ed12164b46a069b691c61`.
The isolated acceptance source has 1,242 exact files before and 1,245 after,
including package/lock files; installed node_modules are excluded from source
verification. The original v2 increment manifest SHA256 is
`f3d62b596add4882f661cf59fd6d9fa8be7eaadd8113a1d9987efce22d49cee1`.

The explicit trusted constructor selector is `native-facts-deepseek-v1`, with a
carried historical cost upper bound. It is not an HTTP/model-selected capability.
The normal product launcher remains unchanged. No second profile, new Store,
memory service, persistent budget engine, receipt migration or permission grant
is introduced.

- `deepseek-acceptance-policy.mjs`: reuse the original request normalization,
  limits and tariff helper; authorize immutable final URL/method/body and perform
  a synchronous final assertion before the existing provider fetch.
- `workspace-omp-local-deepseek.mjs`: reuse the original bounded transport and
  complete-usage checks; validate a strict finite accounting report and retain
  the original allowance across at most two original Runs in this finite adapter.
- `workspace-omp-session.mjs`: compose the original actual SDK provider with that
  transport, actual receiver/cancellation checks and original final Node fact gate.
- `workspace-omp-worker.mjs`: keep original SDK/Session/fd lifecycle; seal transport
  before emitting its terminal safe accounting report.
- `workspace-omp-bridge.mjs`: retain authority in Node, compare prepared/permitted/
  dispatched calls with complete terminal usage, and preserve original final
  disclosure checks before result delivery.

Final normalized request bytes are the same bytes presented to the original Node
fact authority. Node rechecks the complete existing proof set after asynchronous
authorization; Bun rechecks receiver and cancellation at its final send boundary.
This preserves the existing cross-process protocol; it is not an atomic
transaction between Node state and the remote provider network.

## Accounting and terminal protocol

The caller must carry all prior confirmed/uncertain costs. A fresh adapter cannot
prove historical balance. The synthetic tests use the previously recorded
0.139804 CNY historical upper bound solely to test arithmetic; they incur no new
provider charge. The original 5 CNY total allowance, 2.70 CNY turn reserve, usage
limits and tariff calculation are reused unchanged. `accountChargedCny` remains
null; estimated upper bounds are not a provider bill.

Missing usage, absent/invalid reports, incomplete dispatch evidence and unknown
outcomes retain the full original turn reserve and prohibit another Run. A
Node-observed refusal of one last prepared but unsent request may retain complete
prior confirmed charges; missing dispatch events alone cannot establish zero
sends. Provider-limit violations invalidate a claimed total cost upper bound.

Terminal accounting rejects new model requests and final-wire authorization,
including callbacks resuming after await. Failed paid settlement waits for the
original worker close/cleanup to let late fd violations invalidate the report.
The original stop/kill bounds remain; a missing close/cleanup after two seconds
falls back to an unconfirmed full reservation. Ordinary non-paid and successful
settlement retain their original lifecycle.

## Local execution completed

Node 24.19.0: all nine changed/new JavaScript files passed `node --check`.
Exact-source verification passed before/after, and `git apply --check` passed on
the exact baseline. The unchanged package/lock hashes were included.

```sh
node --test \
  test/workspace-omp-native-paid-transport.test.mjs \
  test/workspace-omp-local-budget.test.mjs \
  test/workspace-omp-fact-lifecycle-contract.test.mjs
```

28/28 passed: 20 new pure transport/accounting tests plus 8 original tests.
Failures/cancelled/skipped/todo all 0; 140.64871 ms. These results do not establish
SDK acceptance. Separately, the original policy suite had 6 passes and one CLI
subprocess failure due to locally missing `@earendil-works/pi-ai`; it was not
reported as passing, and no package stub or production import workaround was used.

## First actual SDK run and narrow test-only correction

The first six-file run used Node 24.19.0, Bun 1.3.14, OMP 18.10.4 and
`@earendil-works/pi-ai` 1.1.0 with the existing locked dependencies. It finished
with **61/63 passed, 2 failed**, exit 1; failures were not hidden or counted as
acceptance. Cancelled/skipped/todo were all 0; 77383.884196 ms. All 20 new pure and
27 original cases passed; 14/16 new SDK cases passed. Source verification passed
1,242 before and 1,245 after application and again after tests, including unchanged
package/lock files. The default-spec log was 10,196 bytes, SHA256
`3e915a79a4c121ecb6ef3ea7a0ead97fd5831cc99138d65873e77a0957aeec26`.
The separately retained first-run report SHA256 is
`47120597a74f0ba2cdaafd38484376169b58ab15d3ff91380f62361b9525384f`.

1. The normal second Run failed after two request/tool-completion pairs. Its log
   did not retain tool names or a deeper error than `OMP_SESSION_FAILED`. The
   finite test's second response overwrote Context1 with Context2 while its old
   Decision still depended on Context1. A separate local ordinary original-Brain
   synthetic SQLite check confirmed that this state makes `decisionRead` return
   `BRAIN_CONTEXT_CHANGED`; no receipt/restore function was invoked. The test
   now reads Context1 and updates Decision to revision2 within that same Context,
   explicitly asserting both revisions and the source-backed fact statement.
2. The changed-document case correctly returned HTTP409
   `FACTORY_DOCUMENT_REVISION_CHANGED` on the next message before Run creation.
   Its helper incorrectly required HTTP202. The test now asserts that exact 409
   code, unchanged Run count, no extra accounting and no provider send. The
   original source-change and permissions gates remain unchanged.

These changes affect only the synthetic provider preload and its SDK test.
All five production files retain their exact reviewed v2 contents. The v3 delta
is 5,024 bytes, SHA256
`7c5b6aed02cef98988ee30af7c84740a8fd1baee942d469c87453f782707f71f`.
Its full-source local preflight verified 1,245 files before/after, and syntax and
patch checks passed. The actual successful rerun is recorded separately below;
the first run's 61 passes were not substituted for complete acceptance.

## Actual repaired SDK verification

The same isolated six-file command ran serially on the existing locked install.
The source snapshot is the nine code/test paths saved in development commit
`4a6418922cee9c2754a4f009783a329391ad965c`; the server fixture is the declared
post-v2 source plus only the two v3 test changes, not a checkout or deployment
of the complete development branch.

Runtime versions: Node 24.19.0, Bun 1.3.14, OMP 18.10.4 and
`@earendil-works/pi-ai` 1.1.0. The invocation used a clean `env -i`, explicit
Node PATH, isolated verification HOME, `NO_COLOR=1`, and the two existing
`WORKSPACE_BUN_BIN` / `WORKSPACE_OMP_PACKAGE_ROOT` runtime paths. No packages
were reinstalled and no real provider was called. Sanitized test command:

```sh
# Run inside the verified source directory. Paths below are sanitized variables
# for the already checked original Node/Bun/OMP installation and isolated HOME.
env -i PATH="$(dirname "$NODE"):/usr/bin:/bin" \
  HOME="$TESTROOT/verification-home" NO_COLOR=1 \
  WORKSPACE_BUN_BIN="$VERIFIED_BUN_BIN" \
  WORKSPACE_OMP_PACKAGE_ROOT="$VERIFIED_OMP_PACKAGE_ROOT" \
  "$NODE" --test --test-concurrency=1 \
  test/deepseek-acceptance-policy.test.mjs \
  test/workspace-omp-local-budget.test.mjs \
  test/workspace-omp-fact-lifecycle-contract.test.mjs \
  test/workspace-omp-native-memory-facts.test.mjs \
  test/workspace-omp-native-paid-transport.test.mjs \
  test/workspace-omp-native-paid-sdk.test.mjs
```

Actual result: **63/63 passed**, exit **0**; failures/cancelled/skipped/todo all
**0**. This includes **20 new pure + 16 new actual-SDK + 27 original** cases.
Duration **78832.141384 ms**; start **21:43:09 UTC**, end **21:44:28 UTC**.

Full-source verification passed **1,245 before**, **1,245 after** the v3 patch,
and **1,245 after tests**, including original package/lock files. The five
production hashes remained exactly the reviewed v2 hashes. The first failure
log was rehashed unchanged; no failed attempt was erased.

The successful default-spec log `tests.spec.log` is **6,255 bytes**, SHA256
`98f60da3ac30d92f2de69f12d9bbf7f4790f75434b4d05fc808c85068eb3850d`.
The v3 test-only archive is **73,030 bytes**, SHA256
`a310b35798b10c9dbfaeebaa0840b6cf1d4cac5055583f06bfac33458f53cb62`.
The separately retained 7,512-byte final verification report has SHA256
`23c78c666eae483c5296665a2ea86778db20442c406a9477c10abc76b76d468c`.
Full-source checker logs for application and post-test verification each have
SHA256 `afe502135da327b613e060f84264c1df39e0537141aec9ab88868fc844d9d682`.
Original runtime logs, uploaded files and private runtime paths are not included
in this repository note.

The test-only owned wrapper verifies the original official Bun runtime first,
then uses its documented `--no-install --preload` to replace only provider fetch
with finite synthetic SSE. There is no external fetch fallback, SDK/package stub
or production launcher change. Original SDK, worker, fd bridge, Host, Store and
permissions are used with synthetic identities/documents/facts and a fake unused
provider key. Summaries contain only synthetic request hashes/booleans.

The 16 new SDK cases cover two original Runs with the same initial scope/native
ID; source-backed unreviewed Context/Decision against the original Goal; source,
receiver and cancellation refusal before a third send; absent usage/report;
post-report requests; duplicate accounting; error followed by late dispatch or
accounting; changed initial keys; prepared request/report/final-wire ordering;
and missing/late/duplicate/out-of-order dispatch events. Failure summaries wait
for observed original worker exit with a failing bounded timeout. Cancellation
permits only a full confirmed 2/2 report or a null report with full reserve, and
both states prohibit a third send, delivered answer and second Run. Known and
unknown accounting paths have separate deterministic cases.

These are fresh ordinary lifecycle/protocol tests. They do not exercise old
receipt restoration, compaction, forgery or migration. Real paid-model answers,
real enterprise data, unified UI integration and deployment remain unverified.

Reference: [Bun runtime flags](https://bun.com/docs/runtime).

## Development handoff

This development snapshot preserves all nine source/test files plus this note.
The target is the existing PR99 development branch; no main merge, runtime
replacement, paid call or broader authorization is implied. The original normal
launcher still does not select the finite paid adapter automatically.

The same isolated six-file rerun has now passed with the two-file v3 delta.
No production gate changed to repair either initial failure. Do not install
replacement packages or weaken Context/document/receiver/current checks.
Source code remains frozen at the preserved development snapshot; this update
only records evidence and the product handoff.

After that gate, the requested product outcome is one original conversation:
selected enterprise upload -> authorized source-backed fact save/read -> Brain
Context/Decision against the existing Goal -> continuation in the same Session.
An actual user-facing original-project entry, explicit initial permissions and
budgeted real-model acceptance still need to be connected and verified. Passing
these finite tests alone is not delivery of that product workflow.

See [the original-project product handoff](WORKSPACE-LIBRARY-TO-BRAIN-PRODUCT-HANDOFF-20261017.md) for the exact existing pages/APIs, normal receipt compatibility gap and staged completion criteria.
