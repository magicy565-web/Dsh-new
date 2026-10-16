# Resource reauthorization repair — 2026-10-16

Base: `d81093ec67bbeba907b40630660bfcbec0137284`, same `codex/local-context-budget-fix-20261016` development branch. This bounded repair keeps owner-only mode, customer sharing blocked, original OMP/Session/provider and policy confirmation unchanged. No identity/role engine, real grant/account, credential, deployment, scheduler or paid inference is added.

## Reproduced defect and repair

Before this repair, `references.authorize()` called `store.guard('context')` with no resources. Per-file reads and tool delivery checked actual paths, but model completion/final delivery could still pass if one resource was revoked during generation while the epoch and empty-context permission stayed unchanged. The prior two deny fixtures did not prove two-customer isolation.

`reference-files.mjs` now collects dependencies from successful actual reads, not model-selected references. It rechecks access and immutable hashes for every previously read file. Mutable INDEX remains a resource dependency while its valid contents may change during owned writes. `references.mjs` also tracks selected manifest metadata/content with `selected-source:<SHA256>`, not reusable input labels. Actual content must resolve to verified current selected bytes or retained original/metadata files; absent provenance refuses continuation. The trusted fence remains a deny adapter. It must map its policy to these identifiers; no customer authorization is manufactured from a path or hash.

`reference-tools.mjs` uses original native context events and the existing host disclosure guard to record cumulative dependency snapshots before model disclosure. The host stores them as original native custom entries on the current branch, with scope/epoch and bounded file/selected-source proofs. They are not model context, citations, facts, business memory or a separate Session framework. Reopening checks these dependencies before old context can reach a model; actual native compaction does not remove this proof even when old tool messages disappear from effective model context.

The existing provider guard now identifies the immediate pre-dispatch and model-complete phases; the CLI identifies its final delivery phase. All reauthorize the resource footprint. A memory proposal inherits every exact reference and source it uses. Any denial poisons that owner controller and rejects the aggregate answer/continuation even if the policy epoch never changed. Actual confirmed usage is accounted before a post-model denial, with no automatic model retry.

Protected pre-repair Sessions with no trusted footprint refuse continuation; there is no guessed migration from prose or model citations. Preserve the old journal and use a fresh Session to query currently authorized retained records. Prior dependencies remain conservatively tainted across compaction rather than being silently dropped. Bounds: 512 archive dependencies, 256 selected proofs, 64KiB native snapshot; existing 2MiB Session, 128KiB model request, usage, request-count and cost bounds remain.

## Actual SDK + finite mock model regression cases

The fixture uses original native OMP loading, provider/Session execution, real private file storage, actual parsers and finite mock HTTP. All material/identities are synthetic; no live provider fallback exists. It adds:

| Boundary | Assertion |
| --- | --- |
| Either original source of mixed memory denied | Whole tool/result path stops; one mock model request, no note answer. |
| Native `model:context` or immediate `model:disclose` | Revoke after a successful material read; no second mock provider request. |
| Generation / `model:complete` | Model saw source while allowed, then one source is revoked without epoch change; two usage-confirmed mock responses, no CLI answer. |
| CLI `final:deliver` | Earlier model-complete authorization passes; revocation at final gate still stops answer return. |
| Previously populated Session | Saved tool data and host proof exist; revoking one source denies resume before any mock provider request. |
| Actual native `appendCompaction` | Explicit synthetic summary replaces old tools in effective context; authorized resume works, later unchanged-epoch source denial admits zero requests. This does not evaluate model-generated summary quality. |
| Missing trusted footprint | Altered synthetic native journal with ledger entries removed refuses before model dispatch. |
| Missing retained source | Seed then delete one original in a synthetic archive copy; cached continuation refuses before model dispatch. |
| Native selected `read` | Hash-based selected-source revocation blocks generated answer; input-label changes cannot clear the footprint. |
| Failure metadata | An already populated native selected-read Session loses authorization during generation; stopped output includes no restored source or draft metadata. Previously completed local writes can still exist; no rollback is claimed. |
| Model input | Native custom dependency entries are absent from outbound mock HTTP model context. |

The original independent-tool, separate product/version, source-only retention, proposal memory, confirmation-fixture and package lifecycle tests remain. 59 regressions passed (41 local/loader/budget cases and 18 existing Host/Library/identity cases), followed by the final native fixture including 15 resource-boundary cases and three CLI entry regressions. Build and nine-package static pack checks passed; the existing Vite bundle-size warning remains. See `evidence.json` for completed commands, aggregate results and local log hashes; no raw runtime output/JSONL is committed.

## Limits retained

Only bounded CLI final-answer delivery is covered. Native SDK partial events may already have reached internal subscribers; private native journals may contain partial text/tool data. Customer TUI/SSE/WebSocket output requires separate chunk-level authorization/cancellation work. Already delivered material cannot be recalled, including data sent to a previously authorized model. OS-owner file access is not customer isolation.

No real customer identity/contract/region/product/price-field grants, policy administration, approval activation, customer file service or export is integrated. Existing review and signed identity modules are unchanged. Business memory remains a proposal, and trusted confirmed fixtures are not a real approval flow. Two deny-only contexts remain contract tests, not real accounts.

New real paid calls: **0**. Historical conservative API cost remains **CNY 0.074952**; no account balance or live reasoning quality is asserted. No main merge, force push or deployment.
