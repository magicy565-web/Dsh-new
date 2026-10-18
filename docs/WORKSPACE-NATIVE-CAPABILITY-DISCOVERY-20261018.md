# Native document capability discovery and selected handbooks

Baseline: `4cbae6fe3e2e3d6f25fae728b7c2f6f6b9229de7` on the existing PR99 development branch.
Status: local contract/file tests passed; full Host and official SDK verification pending. No deployment or paid request.

## User-visible change

An initially authorized new business Session can discover its precise document assets and structured fact keys from the existing document/memory tool schemas. It can read the enterprise handbook through the existing `workspace_skill`, alongside the Brain handbook. It may ask a question, perform a read, parse a selected document or save a selected fact as needed; the production code does not prescribe a business sequence or require a saved Decision.

The original native-ID handshake returns only selected method names, document/version/asset/SHA metadata and exact fact-key tuples. `oneOf` preserves each complete tuple; it does not combine independent enum fields into additional choices. The Node Host still owns all authority and repeats current Session, Run, receiver, source and disclosure checks. Schema availability is not parser transfer consent, memory-write consent or an approval. No document text, fact statement, credential or new authority is included in this metadata.

The enterprise package constructs its schema inside the standalone plugin. The Host selects its existing package-declared Skill alongside the already selected business Skills without enabling the complete enterprise plugin, Mem0 or extra tools. The official OMP loader and `ReadTool` remain responsible for Skill loading/reading. Ordinary uploaded documents remain untrusted observations and are never inserted into system rules/context files.

The original native Session receives a custom handbook entry containing selected Skill names, package name/version, repository-relative path and SHA-256, plus the capability projection hash. Source and copied Skill bytes are checked before reading, provider dispatch and final authorization. Subsequent turns must match this initial entry exactly; missing or changed entries fail closed. This applies to the new normal capability lifecycle only. It does not upgrade or migrate old Sessions, catalogs or receipts, and does not change or retry the previously blocked receipt-restoration review.

Brain's unconditional “first inspect context” guidance is now conditional on the question. Original permissions, write intent, source proofs, approvals, tool cap, request/budget limits and the private-screening/Docling coupling remain unchanged.

## Local execution

Node `v24.19.0`:

```sh
node --test test/workspace-native-capability-discovery.test.mjs
node --test test/workspace-native-document-tools.test.mjs test/enterprise-context-extension.test.mjs
```

- New contract/file suite: **8/8**, exit 0, no failures/cancellations/skips/todos, 470.539643 ms after the final awaited disclosure-boundary recheck was added.
- Existing narrow facade/standalone extension regression: **7/7**, exit 0; this is not counted as eight new tests.
- The tests use the real extension, original facade/helper modules, actual project manifests and actual copied handbook files. A small in-memory custom-entry recorder tests serialization semantics; it is explicitly not an SDK or persistence substitute.
- No new dependency or lock changes; the pure suite uses Node built-ins and existing project source.
- Syntax checks passed for changed JavaScript modules/tests.
- `node scripts/check-plugins.mjs --pack`: exit 0; 15 plugins passed static import/package closure checks. Enterprise/ERP remained disabled in the default selection; no business tool or model was executed. This is not an SDK loader or complete-module-uninstall test.

The two new Host assertions in `test/goal-brain-memory-fact.test.mjs` were attempted with:

```sh
node --test --test-name-pattern='document capability discovery' test/goal-brain-memory-fact.test.mjs
```

Import failed before test bodies because the local installation lacks locked `@earendil-works/pi-ai@1.1.0`, reached through the original runtime import graph. Exit 1 is retained. No substitute package/import path was used. These two assertions are **not passed**.

## Pending official SDK verification

Use the complete original locked installation, Node 24.19.0, Bun 1.3.14 and OMP 18.10.4, with the original `WORKSPACE_BUN_BIN` and `WORKSPACE_OMP_PACKAGE_ROOT`:

```sh
node --test test/workspace-native-document-mainchain-sdk.test.mjs
node --test --test-name-pattern='document capability discovery' test/goal-brain-memory-fact.test.mjs
```

The official `ReadTool` resolution of the loaded enterprise `skill://` name remains part of SDK verification; the local contract tests do not emulate it.

The five SDK cases remain pending:

1. Real original startup/upload/Library/Session/Run, an existing reviewed Goal, finite provider and synthetic Docling: model reads the loaded handbook, discovers asset/fact tuples solely from transmitted schemas and Goal/source IDs from actual tool results, saves source-backed memory and Decision, then continues the same Session and reads the original page endpoints. Expected first turn uses seven requests, within the unchanged eight-call admission.
2. The initial document capability still refuses a ninth request.
3. The ordinary no-capability path retains its four-request limit.
4. The finite model can ask for clarification with no tool call or save.
5. It can inspect the selected absent fact without parsing or writing.

The provider fixture explicitly rejects private `asset` or `query` fixture fields. Its chosen sequences are synthetic test scenarios, not production instructions or evidence of real-model business judgment. The current full-mainchain acceptance package predates this change and remains a separate pending artifact; do not relabel its hashes or results.
