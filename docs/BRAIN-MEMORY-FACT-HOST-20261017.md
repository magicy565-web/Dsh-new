# Brain exact-memory-fact capability: isolated Host regression verified

## Baseline and implemented scope

- Code baseline: `5106662c31be6e845e8f9d36da17f93d9b96a0d6` on `codex/omp-all-plugins-integration-20261017`.
- Remote head checked before this change: `4569a53b8d189ab9d3e8105ba20a853066e1e3b2`. Its intervening acceptance notes and independent UI CSS import do not change the four implementation-file preimages.
- Four existing implementation files change: `server/enterprise-memory-ledger.mjs`, `server/workspace-enterprise-context-host.mjs`, `server/goal-brain-host.mjs`, and `plugins/workspace-goal-intelligence/src/contracts.mjs`.
- New source kind `memory-fact` projects an explicitly selected existing fact's `memoryId`, `subjectType`, `subjectId`, `factKey`, `statement`, and original `source`. It is distinct from a metric and from the earlier metadata-only document reference.
- Only trusted in-process code can supply the original Host's branded `readOnlyFacts` capability. Selection is one to eight exact, distinct `{subjectType, subjectId, factKey}` keys. The capability is absent from the model-facing enterprise RPC/client; it adds no memory write method.

## Existing authority and final checks

The capability reuses the original `structuredMemoryLookup`, existing `allowMemoryRead` and selected-document authority. It does not read the ledger directly from Brain or create another Store, policy, grant, or memory system. When no optional fact capability is supplied, the previous Brain scope/hash and behavior are unchanged.

Fact-enabled binding requires the original identity, workspace, subject, role, conversation, Run and exact native Session ID. The reader scope hash includes that native Session ID. Live Session, original Run/request, model recipient, policy expiry, all selected document revisions/versions/assets and original source-message provenance remain checked. The original byte-SHA checks run during lookup; no Docling parse request is made by this capability.

Catalog and source reads use the original lookup/check path. Synchronous current/Artifact commit admission reuses the original full disclosure gate plus fact/source checks against the supplied transaction state. The shared precondition helper does not replace the final checks: every provided and already observed fact proof remains subject to the original current/transcript validation. Reader-local proof ownership and exact projected values are required. A stale transaction snapshot cannot override live revocation.

Only the selected statement and provenance are projected; HMAC/screening material, credentials, complete memory history and unselected facts are excluded. The source digest identifies the exact projection; it is not independent verification that the stated business fact is true.

## Actual isolated execution, 2026-10-17

The unique server operator applied the reviewed v4 increment only to the existing complete-source verification copy under `/tmp`, separate from running services. The original locked dependencies were reused: Node **24.19.0**, `@earendil-works/pi-ai` **1.1.0**. Package and lockfile hashes were unchanged.

The original enterprise Host, Library permission class and memory ledger ran against synthetic Store/Library/Goal records, synthetic document bytes/identity, and the existing test-only SQLite Artifact facade. This is Host/admission testing, not an original Store/Artifact end-to-end run.

The eight-file run reached and passed **71 tests: 28 new memory-fact tests, 19 prior document-reference tests, and 24 prior focused regression tests**. Results: **0 failed, 0 cancelled, 0 skipped, 0 todo; exit 0; 1204.877159 ms**. The new test file contains 12 top-level cases and 16 nested cases.

The new cases cover:

1. Context save → Decision save/read with exact selected fact/provenance and an existing reviewed Goal; no Goal execution or mutation.
2. Default behavior without the capability; missing/unapproved selection; branded reader, exact keys and native Session binding; no write/parse capability.
3. Exact source IDs, fields, revision and projection digest; absent facts are not invented.
4. Ordinary update/revocation rejection, reader-local proof ownership, and live refusal despite a stale transaction snapshot.
5. A positive ordinary update: reopen the original authorized control, create a new reader and Brain binding, read fact revision 2 and save Context revision 2; the old source/binding remains refused.
6. Every selected document's revision, archive state, asset SHA and bytes; original source-message changes; Session/role/Run/expiry/model-recipient changes.
7. Divergent transaction-state fact revocation, second-document revision, asset visibility, original Run request and conversation ownership.

The earlier local new-test attempt stopped at import because the exact `pi-ai` dependency was unavailable. It was not counted as a test pass; no dependency stub or production-import workaround was used. Local syntax checks and a complete baseline/apply/hash verification passed separately.

### Command and evidence

The exact command below ran once in `$TESTROOT/source`. `$TESTROOT` names the isolated source-bundle root; the temporary directory name is omitted. No raw log or runtime data is included in this source change.

```sh
env -i \
  PATH=/opt/workspace-acceptance-20261017/node-v24.19.0-linux-x64/bin:/usr/bin:/bin \
  HOME="$TESTROOT/verification-home" NO_COLOR=1 \
  /opt/workspace-acceptance-20261017/node-v24.19.0-linux-x64/bin/node \
  --test --test-reporter=tap \
  test/goal-brain-memory-fact.test.mjs \
  test/goal-brain-document-reference.test.mjs \
  test/business-brain-product-completeness.test.mjs \
  test/business-brain-observations.test.mjs \
  test/goal-brain-product-source.test.mjs \
  test/business-brain-pulse.test.mjs \
  test/business-signals.test.mjs \
  test/decision-planner.test.mjs \
  > "$TESTROOT/memory-fact-host-v4-results/tests.tap" 2>&1
```

- Original complete-source `SOURCE_MANIFEST.json` SHA256: `d44848012e90b12801c8f22b1cc90e05acabc7ee30a61d4e18474b7b3075585c`.
- Reviewed v4 increment archive: 15,725 bytes; SHA256 `dc95598d6f4e0572fc530fb213adad4c0dc5a339290f8ab7393129442803f5c5`.
- v4 patch SHA256: `61979d30ee4c2514f5de66c95fc9e9b366be8b81c70d3a8681ae8844f22bf5cc`.
- v4 `INCREMENT_MANIFEST.json` SHA256: `0c832532982ce256f1bc941deebc08246c005b09f92f65397bb7309a5cb9c6ef`.
- Single eight-file TAP log: 13,458 bytes; SHA256 `546788c78d875be629a826563e325ef4c43f4be316d2b55d79f2a99e0f73a654`.
- Pre-application verifier log SHA256: `a859e2307f008b7ade127493fdb97340fd9f9c127ce20f42959a78dbfc22e101`; both post-application/post-test verifier logs SHA256: `597e727f6e3c069af8777c51ffb4d77545421992104c30ad006ee1525af0d344`.
- Source verifier before applying: exit 0, 1,237 files. `git apply --check`: exit 0. After applying and after testing: exit 0, 1,238 files. Every original source file, including package/locks, was checked; only the five declared implementation/test paths changed.

The four implementation files and new test remain byte-identical to reviewed/tested v4. Only this acceptance note was added after that run.

## Retained limits and next boundary

- Original full observed-proof checks remain. If one already observed key changes in a multi-key scope, the old control may fail closed; use an explicitly reopened original authorized control, new reader and new binding. No proof clearing, silent catalog refresh, old-Session migration or receipt migration was added.
- The previous metadata-only document references remain metadata-only. This capability reads existing authorized structured facts; it does not parse document bodies into facts.
- No native business/profile entry point, profile exclusion rule, native Session lifecycle or provider dispatch hook was changed. A real native Session still needs the separately reviewed narrow binding lifecycle before it can use this optional capability.
- This run made no model calls and used no real enterprise records. It does not establish official SDK/native binding, real-model enterprise-to-Brain behavior or production deployment. Earlier real-model local-file acceptance is separate evidence.
- The previously blocked historical receipt-restoration review was not executed or modified. Existing receipt/catalog validation remains unchanged.
