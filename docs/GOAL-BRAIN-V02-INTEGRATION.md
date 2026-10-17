> 上游设计/交接记录；其中的旧分支、完成状态和历史验证不代表本次验收。当前结论见 [统一插件验收](OMP-ALL-PLUGINS-INTEGRATION-20261017.md)。

## Enterprise Business Brain 0.2.0 — 2026-10-16 integration checkpoint

## Status (strictly bounded)

This change continues Draft PR #90 / `codex/enterprise-business-brain-20261016`; it does not replace the original Pi/OMP model loop or merge/deploy main. Original V0.1 artifact-backed BDI-style decision memory remains intact. V0.2 adds:
- One native read-only tool `workspace_brain_diagnose`, making **8** registered tools.
- Source-backed, version-pinned `inquiry-funnel-v1` KPI analysis with exact market/product/channel segment and current/baseline windows.
- Existing `cohortConversion` mathematics preserves pending/unknown members; missing or incomplete cohorts never become lost sales, descriptive deltas never become causal conclusions, forecasts, probabilities, owner approval or executable recommendations.
- `server/brain-artifact-policy.mjs`: protect the original Artifact namespace `metadata.businessBrain`. The in-process reviewed `createArtifactBrainRepository` passes `admission.brainProtectedWrite=true` and a synchronous `admission.check`. Public JSON requests cannot set this second argument.
- Original `server/artifacts.mjs`: create/update reject forged or mutated brain ownership in the original admission path, including a repeated guard in the Store update transaction; generic delete refuses protected memory.
- Original `server/index.mjs`: generic Artifact list/get/content/download and mutation paths cannot return or change protected Brain records. Existing bootstrap hides `businessLibrary.visibility=internal` artifacts.

This is **not** a completed private model/enterprise Host integration: `createBusinessBrain` still requires trusted original Session/member and exact field authorization callbacks, original Goal/budget readers, current source proofs, synchronous commit checks, and a hard pre-provider / restore / compact / final context guard. There is no default enabled private profile, no worker dispatch, and no other tenant data-access migration.

## Trusted source projection (not model supplied)

Only the original authorized source adapter may supply `kind='metric'` with `values` shaped like:

```json
{
  "metricType":"inquiry-funnel-v1",
  "windowStart":"2026-09-01T00:00:00Z",
  "windowEnd":"2026-10-01T00:00:00Z",
  "eligible":100, "converted":10, "pending":30, "unknown":10,
  "segment":{"productId":"cloth","market":"US","channel":"inbound-rfq"},
  "baseline":null
}
```

For a comparison, `baseline` can be a prior nonoverlapping measured cohort with `windowStart/windowEnd/eligible/converted/pending/unknown`. The Host must enforce source `workspaceId`, original revision/hash, field mask, observation time and exact receiver at every read and before every model send. The plugin itself cannot create this projection from arbitrary text or privately source a metric. A missing/unsupported KPI produces an explicit gap; it does not invent a benchmark.

The output `descriptiveRateDelta` is a difference in observed cohort conversion proportions, rounded to 1 basis point (0.0001). It is **not** a causal estimate or a probability that a strategy will work. No proposed increase in acquisition spend can be inferred from these metrics alone.

## Local validation (actual)

Node 22.16.0:
```sh
node --test test/goal-brain*.test.mjs
node scripts/goal-brain-offline-proof.mjs
```

Historical scoped tests previously recorded 100 passed / 0 failed / 0 skipped on Node 22.16.0; **V0.4 additions have not been executed in this environment**. The synthetic SQLite Artifact facade is test-only. The original Node24+ Host HTTP integration and pinned official Pi/OMP SDK were **not executed here**; no real model, customer, ERP, paid API, external Worker, real deployment or external transmission happened.

## Next original-Host acceptance (do not skip)

1. Node24 exact-source `npm ci`, baseline backend/HTTP and new Brain policy regressions; assert normal artifacts still work.
2. Original `createApp` Artifact create/read/update and HTTP: generic POST with forged `metadata.businessBrain` = 403; generic PATCH/DELETE/read/list of a previously trusted Brain record blocked/hidden, original internal scoped reader still succeeds.
3. Bind exact original authenticated member, workspace, conversation, model receiver, Library grants, Goal budget, current run and source revision. Require explicit private-model disclosure. Cross-tenant and cross-customer-level protections must apply to all API paths, not only Brain.
4. Test pre-provider guard, restored/compacted receipts, withdrawal and version changes with actual installed OMP; verify the two-message same-session continuation.
5. Only after original model budget and billing facts can be verified, run the smallest scoped live-model business case. Model-authored hypotheses are unreviewed; no automatic external actions.

No GitHub Actions run was started here; existing Actions startup failures do not count as test results. Coordinate with Dot/xy and the original Host integrator before merging these shared `server/` changes. Use this PR's additions rather than forking another database, approval ledger, scheduler or model loop.


## V0.4 continuation

The realtime pulse is implemented in `plugins/workspace-goal-intelligence/src/pulse.mjs` and is returned by the existing `workspace_brain_brief` read surface. The original Pi AgentSession can load the Brain extension only when the original Host supplies a reviewed Goal Brain binding. Transcript Brain receipts are revalidated by the Host-owned `transformContext` guard before provider requests; Pi extension handlers are not treated as the security boundary.

The current package still does not invent operating metrics. To produce meaningful KPI diagnostics, a future original Host source adapter must expose typed, authorized metric projections (for example inquiry cohorts or exact-product outcomes) under the same workspace/session/receiver/revision/hash contract. Until then the pulse explicitly recommends filling the measurement gap rather than fabricating a business conclusion.
