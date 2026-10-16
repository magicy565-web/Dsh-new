# File-first local owner references — 2026-10-16

Scope: independent `@workspace-agent/pi-local-materials` 0.2.0 on the existing `codex/local-context-budget-fix-20261016` branch, based on `f25b9c5`. No main merge, deployment, credentials, customer grant or paid inference. Earlier real acceptance/failures remain historical evidence; this release does not replace them with mock success.

## Reuse audit and decision

| Existing capability | Reuse / limitation |
| --- | --- |
| Native OMP loader, Session, provider, selected file guard, ReadTool/WriteTool, context hook | Reused directly; no new Agent Loop or scheduler. |
| Factory ingestion evidence/DTO principles | Reused exact source/version/quote, proposal/pending and separate-product principles. The existing ingestion client depends on remote Store/artifact/identity, so it is not imported into the independent file package. |
| `server/access.mjs` | Existing signed ingress, current Session checks and revocation; audited, not connected to this local owner entry. |
| `server/library-model-read.mjs` | Existing recipient/revision/field scope and pre/post `assertCurrent`; audited as the customer disclosure integration candidate. |
| `server/business-library.mjs` | Existing immutable versions and exact-version human review; audited, not replaced by a new approval system. |
| Native conversation JSONL | Reused for conversation/recovery. Business source/reference/memory files remain separate. |

No actual customer identity or unavoidable customer-facing file boundary was supplied. Delivery therefore remains **OS OWNER MODE ONLY**. Customer sharing is blocked. Two deny-only fence contexts in a test are contract fixtures, not real customer isolation.

## Implemented and tested

Originals, readable parsed text/CSV tables, references, INDEX and old versions live in one explicit private enterprise/project directory outside source/Git. Reference JSON is canonical; MD and INDEX are projections. Separate memory proposals link to exact reference revisions and do not become a second fact authority. No embeddings/vector store/RAG service is added.

Seven composable tools provide read, query, save/update, source retention/version reads and separate memory save/query. Reading alone writes no INDEX/profile. No fixed DAG or required sequence exists. Product identity evidence, CSV row boundaries, exact UTF-16 quotes, immutable history and expected revisions protect updates. Unknown fields remain pending; inference, source extraction and confirmation are separate.

The native OMP fixture uses actual files, native PDF extraction, Python stdlib CSV, native package loading/provider dispatch and native JSONL resume. Finite mock HTTP scripts supply model choices and fixed fake usage. They test executable contracts, not model intelligence or real billing. It creates one company/two products, changes only A's lead time, preserves B/old revisions, removes original selected files and continues from retained originals in the same Session. It also exercises read-only search, source versions, standalone source-only retention/idempotency, scan limitations and separate mixed-source memory. The actual npm CLI preflight covers the new scope flags and no-input query mode without inference.

Native PDF display wrappers contain temporary paths; extraction uses the native `displayContent.text` instead, preserving stable parsed hashes. An image-only PDF is unavailable, not OCR success. Native OMP drops unknown closed-schema fields; tests check that owner/approver/confirmed arguments cannot change the actual UID, scope or proposal state. They do not falsely claim the SDK rejects every extra field.

## Security coverage and honest boundaries

| Boundary | Status / evidence |
| --- | --- |
| Current OS UID, selected scope, exact private directory mode/inode, no symlinks | Implemented; private-mode/symlink and source selection tests. Same UID still has full owner filesystem rights. |
| INDEX/title/summary/raw/parsed/table/reference/history reads | Owner checks and deny-fence checks; hashes checked before delivery. Directory cards do not grant access. |
| Mixed-source memory and old revisions | Every linked reference/source checked; source denial blocks the whole result, including memory. |
| Cached tool content and resume | Body/receipt/source checks; tampered body, wrong scope or changed epoch refuses before a model request. |
| In-flight tool revocation | Denial before result delivery blocks note; revoked Session admits zero further mock model requests. Already displayed material cannot be recalled. |
| Disabled/uninstalled required guard | Protected native Session marker refuses unguarded resume. Ordinary unprotected Session lifecycle remains covered separately. |
| Confirmed fact/policy overwrite | Refused against trusted synthetic confirmed fixtures. **No real approval API/flow implemented.** |
| Model-selected owner/uploader/authorizer/grants | No authority input/tool. Metadata comes from actual OS UID; original uploader remains unknown. |
| Real customer identities, contract/region/product/field grants, expiry and grant/revoke administration | **NOT IMPLEMENTED** for this local plugin. Existing server machinery is not wired to local files. |
| Customer filesystem/static delivery, sharing/export, external UI streaming and redacted-context rebuilding | **NOT IMPLEMENTED / BLOCKED**. No full authorization-system claim. |

A future customer release must first connect trusted real identities and enforce unavoidable disclosure checks over all paths above, including summaries/caches/exports. Customer-level labels, read query filters and fake tokens cannot establish that boundary. Owner revocation checks do not certify unrelated extensions or a separate UI.

Writes use immutable files, native locking and atomic authoritative INDEX replacement. A failed/interrupted write can leave orphan files and a lagging MD projection. No full rollback or crash-repair guarantee is made. Existing finite archive/request/message limits are unchanged or explicit; there is no unbounded memory promise.

## Validation and cost

- Local/native package, context pairing, finite HTTP budget, draft parity and uninstall regressions: 41 tests passed.
- Existing original Host/Session/Library read, scope, expiry, in-flight change/deletion and merged-profile regressions: 18 tests passed.
- Final owner fixture is repeated after the initialization-stage and table-delivery changes; see sanitized `evidence.json` for its aggregate status and hashes of local logs.
- `npm run build`: passed, including static source/resource/npm-pack closure for all nine plugin packages, TypeScript and Vite. Existing bundle-size warning remains.
- No live model or private enterprise service call. New paid requests: **0**; historical conservative API cost remains **CNY 0.074952**. No account balance is asserted.

Raw fixture output, runtime JSONL, files and logs stay under `/tmp` and are not committed. Only source and this sanitized acceptance explanation/aggregate evidence are committed. Reproduce with the relevant `node --test test/workspace-*.test.mjs` files listed in `evidence.json`; ensure pinned OMP/Bun dependencies are installed. Usage in the [package README](../../../plugins/workspace-local-materials/README.md).

Muse/Grokbot remain real account-authorized Personal Agents; seven-day verification remains a budget/Worker/Goal launcher direction. Neither is implemented, simulated as a product success, or expanded by this change.
