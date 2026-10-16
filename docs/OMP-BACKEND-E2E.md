# Native OMP backend E2E status (2026-10-16 UTC)

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
