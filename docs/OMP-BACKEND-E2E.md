# Native OMP backend E2E status (2026-10-16 UTC)

Later independent run: [Codex Cloud acceptance](OMP-CODEX-CLOUD-ACCEPTANCE.md) starts at `16340ca0f7ef24cf61ea358534420e73a07b60a4`. Its native lock and persistent synthetic Session tests pass in the selected Codex Cloud environment, and it fixes a separately reproduced signal-cleanup issue. The dot-environment failures below remain historical evidence, not the result for that environment. No real provider or enterprise-service acceptance is implied.

## Source and scope

The tested backend is the PR93 integration (`bacd9e9b1f07817b573783e7fbb9e36b43405075`) plus development commits `3ee5e4b0689f42d5d5e81315d60c4078ba1ac917` and `ea2e2e9df1a86b8696fd039adcd28af7dc62bd79`, on `codex/omp-unified-cloud-build-20261016`. This follow-up changes only test import isolation and this report. It does not change the agent loop, native locks, provider admission, runtime permissions or frontend.

The tests ran in the current dot cloud execution workspace, using the selected source snapshot described in `OMP-UNIFIED-BUILD.md`, not a full Git clone. Runtime: Node 24.19.0, official Bun 1.3.14 (audited binary), official OMP 18.10.4. No old Workspace HTTP service or `WS_AGENT_URL` is required by this local path.

## Passed in this run

From the project root:

```sh
node --test --test-concurrency=1 \
  test/workspace-omp-unified.test.mjs \
  test/workspace-omp-local-budget.test.mjs
```

**7/7 passed.** Covers native runtime/plugin inventory, default entrypoint routing, fail-closed plugin selection, disabled model input, request-size admission and bounded unknown-response accounting using an in-process mocked fetch. The historical CNY figures in policy tests are fixtures, not current spending authorization or verified account balance.

```sh
node --test --test-concurrency=1 \
  --test-name-pattern='local CLI preflight|selection rejects|native local file guards|DeepSeek local preflight|cached read provenance' \
  test/workspace-omp-local.test.mjs
```

**5/5 selected tests passed.** Covers zero-request explicit-file preflight, symlink/unselected/credential-like input refusal, actual published native file-tool boundaries (traversal/symlink/overwrite/directory replacement), configuration booleans and cached source-receipt/hash revalidation. These tests do not establish a working persistent conversation.

The local-entry suite separately passed argument parsing, explicit public-only preflight, and actual npm preflight/help (**3/4**). Its persistent two-turn case failed as below.

The affected finite fixtures now import path/config helpers directly from the pure runtime/configuration modules. Synthetic PDF byte generation no longer eagerly imports legacy Host tools; that import remains inside its own standalone public-tool test main. No legacy dependencies were installed to make local tests load.

## Blocking failure: native persistent storage

```sh
node --test test/workspace-omp-plugin-uninstall.test.mjs
```

**0/1 passed.** The first real persistent Session write failed before model admission:

```text
Failed to acquire native file lock for .../data/.conversation.jsonl.lock.os:
Operation not permitted (os error 1)
at #acquireOsPublishLock (.../src/session/session-storage.ts:768:32)
at #withPublishLock (.../src/session/session-storage.ts:686:23)
at #publishAtomic (.../src/session/session-storage.ts:1095:9)
```

```sh
node --test --test-concurrency=1 \
  test/workspace-omp-local-entry.test.mjs \
  test/workspace-omp-plugins.test.mjs \
  test/workspace-local-references.test.mjs
```

The first run was **3/6 passed**. The two-turn native local entry returned `stopped`, `LOCAL_TASK_INCOMPLETE`, **0 model requests and 0 tool receipts**, not a completed turn. The plugin-recovery fixture also failed before its expected finite requests. The reference fixture initially had an unrelated eager legacy import; after the minimal test isolation, its rerun reached the actual Session path but still returned `stopped`, `LOCAL_TASK_INCOMPLETE`, **0 mocked provider requests** (**0/1 passed**). These generic errors are reported as observed; only the uninstall test emitted the explicit native-lock stack above.

**Not established:** persistent Session creation, product-read-and-draft-save through that Session, same-Session second turn, cancellation after a read, exit/restart recovery, or crash recovery. The existing two-turn tests use fresh graceful child processes; even when passing elsewhere they are not crash-recovery tests. Cancellation was not reached in this environment. No lock implementation was replaced, bypassed or disabled; `--no-session` was not substituted for persistence.

## Model and billing boundary

Only presence was checked in the current tested shell process: `PI_PROVIDER`, `PI_MODEL`, `DEEPSEEK_API_KEY`, `FASTAITOKEN_API_KEY`, `OPENAI_API_KEY`, `WORKSPACE_OMP_PROVIDER_COST_JSON`, and `WORKSPACE_OMP_LIVE_BUDGET_VERIFIED` were absent; the project `.env` was absent. This is not a claim about other processes or the entire cloud computer. No credential values or credential files were read.

Actual external provider calls in this run: **0**. Finite model responses and mocked HTTP/SSE responses are test substitutes, not real-model validation. Current live budget, balance and any outstanding external requests are not reconciled here. No paid request is authorized by this report; real-model E2E requires separate reviewed authorization/configuration after the persistent-storage blocker is resolved through a supported environment.

## Evidence handling

Raw TAP and configuration-presence receipts are retained locally under ignored `evidence/backend-*` files. They are not committed. No session JSONL, selected product, draft, local registry, credential, browser handshake, screenshot or runtime artifact is included in this source-only follow-up.

## Native preflight follow-up (2026-10-16 UTC)

This follow-up is based on development HEAD `cae3981d334a98c60eba9f96e27becc4623cf3e5`. It selectively adapts the acquire/release/reacquire preflight from `f929906f675f3784c4c180a4ed1a3b563b948394`; it does not merge that older branch. Changes are limited to the current default check, explicit local-session gate, focused tests and these acceptance notes. Frontend work remains paused.

### What the probe establishes

- The installed `@oh-my-pi/pi-utils@18.10.4/src/file-lock.ts` calls `@oh-my-pi/pi-natives` `FileLock.tryAcquire`. The native Session storage uses that same primitive in `#acquireOsPublishLock`, at `src/session/session-storage.ts:768` in the installed package.
- The installed source describes Linux locking as abstract Unix sockets, Windows locking as named mutexes and other Unix platforms as `flock(2)`. Calling this Linux failure a `flock` failure would be inaccurate.
- The actual probe in the tested cloud process returns `ready:false`, `LOCAL_NATIVE_LOCK_UNAVAILABLE`, `phase:acquire`, `errno:1`. It fails before the first lease, so release and reacquire are not reached on this environment. Those phases are covered by explicit stubs.
- Read-only OS status reports `NoNewPrivs:1`, `Seccomp:2` and zero effective capabilities. A single syscall-trace attempt was refused at `PTRACE_TRACEME` with EPERM; tracing was stopped without escalation or an alternate route. These observations do not identify which syscall or policy rejected the native lock.

No runtime lock was replaced, disabled, emulated or redirected to evade a denial. Temporary probe directories are cleaned, and cleanup failures are themselves sanitized unavailable results. The probe cannot establish cross-process contention safety, actual Session writes, output-filesystem suitability or crash recovery.

### Readiness and exit semantics

- Default `npm run workspace -- --check` retains all 11 plugin inventory entries and reports `offline-preview-ready`, scoped explicitly to `pinned-runtime-and-plugin-manifests-only`. Its zero exit status is an inventory check, not persistent-session acceptance.
- `localSessionPrerequisites` separately contains native-lock readiness, model configuration status and blockers. Its configuration scope is the environment explicitly supplied to this process; it does not search credential files or accounts. The preview still receives an isolated HOME and no provider configuration.
- Explicit local `--check` validates selected files, preserves existing Session bytes, does not instantiate/load a Session, and reports `environment-unavailable` with exit 2 when the native lock is unavailable. Existing JSONL is labelled `exists:true`, `resumed:false` because no resume was attempted.
- Actual local execution, including synthetic fixtures, stops with `LOCAL_NATIVE_LOCK_UNAVAILABLE` before importing/creating the Session, acquiring the local Session sidecar or contacting a model. There is no alternate locking path.
- `preflightReady:true` means only that the temporary lock probe and existing configuration-presence/admission checks passed. `persistentSessionVerified` and `paidModelVerified` remain false. `configured-unverified` is not live-provider success, current balance verification or new spending authorization.

### Staged acceptance

The original working directory contains 106 uncommitted browser-preview paths, including default-entry and README edits. They were neither changed nor uploaded. Tests for this follow-up use a separate source staging directory: the default entry, preview gate, package manifest and relevant docs were restored from the exact remote HEAD, the backend/test/plugin source hashes were compared against its recursive Git tree, then only the listed preflight changes were applied. The official audited runtime installation is reused; no browser-preview source is part of the exercised execution path. This is validation of the staged affected backend path, not a claim that the mixed original working tree or full 2,839-entry repository was tested.

Passed commands:

```sh
node --test --test-concurrency=1 test/workspace-omp-local-environment.test.mjs
# 15/15: lock order, first/reacquire/release failures, package pin, synthetic non-bypass,
# configuration scope/redaction, existing Session preservation, invalid configuration,
# cleanup/start/output/timeout failure handling.

node --test --test-concurrency=1 test/workspace-omp-unified.test.mjs test/workspace-omp-local-budget.test.mjs
# 7/7: default readiness/inventory and prior bounded-admission regressions.

node --test --test-concurrency=1 \
  --test-name-pattern='local CLI preflight|selection rejects|native local file guards|DeepSeek local preflight|cached read provenance' \
  test/workspace-omp-local.test.mjs
# 5/5 selected file/configuration/provenance checks.

node --test --test-concurrency=1 \
  --test-name-pattern='one natural-language goal|explicit public-only CLI|actual npm positional' \
  test/workspace-omp-local-entry.test.mjs
# 3/3 selected parsing/public/archive/CLI preflight checks.

npm run build:omp
# All 11 plugin packages compile, discover and register; no business tool/model run.
```

The existing persistent two-turn test was also run unchanged in expectation:

```sh
node --test --test-concurrency=1 --test-name-pattern='default native Session asks first' test/workspace-omp-local-entry.test.mjs
```

**0/1 passed; still blocked**, now with the precise `LOCAL_NATIVE_LOCK_UNAVAILABLE` receipt, acquire errno 1, zero model requests, zero tool receipts and no saved output. The expected completed persistent turn was not reached. No `--no-session` substitute or skipped test is counted as persistence evidence. Cancellation after a read cannot be validated until a real Session can reach that point, so no unrelated cancellation fixture was added.

### Supported next requirement

The selected cloud execution environment must support the unchanged official native `FileLock.tryAcquire` primitive. Its provider/administrator must supply a supported environment capability or an approved environment change; this source patch does not repair that capability and no security/network setting was changed. Once available, rerun the exact probe, then the persistent two-turn, plugin-removal and reference suites, and add bounded cancellation/restart acceptance. A successful probe alone is insufficient. Real-provider E2E still needs separately reviewed model, price, budget and authorization; this follow-up made **0 external model requests**. Raw receipts/TAP remain local and are excluded from the commit.
