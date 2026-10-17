> 上游设计/交接记录；其中的旧分支、完成状态和历史验证不代表本次验收。当前结论见 [统一插件验收](OMP-ALL-PLUGINS-INTEGRATION-20261017.md)。

# Enterprise Business Brain V0.3: original Host binding (2026-10-16)

**Branch** `codex/enterprise-business-brain-20261016`, Draft PR #90. Continue the original V0.2 branch, do **not** fork Pi/OMP, Store, Artifact, scheduler, identity, task approval or WorkerDesk. No changes to main, no deployment or paid calls.

## Precisely implemented source code

1. `server/library-model-read.mjs` exports the original trusted `businessBrainForSession({identity,recipientHash,signal})`. A model/tool cannot choose a tenant, member, receiver, fields, or arbitrary product. It reuses the existing original, explicitly reviewed `libraryModelReadPolicy` with exact record revisions and field masks and requires a *live original enterprise Session* at every access. Default is closed.
2. `server/goal-brain-host.mjs` binds `createBusinessBrain` to the original `access.nativeSessionById`, `store.read()`, `createArtifactService` through `createArtifactBrainRepository`, the Session's original company/product projections, and exact same-enterprise original Goal records. It does not claim profit, cash flow, commercial budget or ROI when no existing reviewed authority is available: budget remains null and external commerce actions are unavailable. No duplicate DB.
3. For model-authored changes: `bind({identity,conversationId,runId,canSubmit,signal})` checks the *original active Run* (`running`, same exact conversation/member/workspace). Private context/decision memory writes require the current Run but do not inherit `businessAgentContext.allowBusinessSubmit`; external business actions remain behind that original execution approval. Source/Goal state is revalidated inside the original Artifact transaction's synchronous `admission.check`. A Boolean alone cannot approve writes. Generic Artifact HTTP continues to refuse protected Brain metadata.
4. An original Goal must belong to an original conversation owned by the same exact enterprise and subject, even when its UUID appears in a reviewed policy: no opportunistic cross-tenant goal projection from a shared Store.
5. Original company's and products' exact, explicitly allowed **string** fields are projected with source revision, SHA-256 and updatedAt. Credential-looking contents are refused using the original security checker. Changed/revoked field permissions, receiver or record revision invalidate reused decision context. The saved Artifact remains unreviewed.
6. In `server/index.mjs`, original `createApp` accepts optional *trusted in-process* `goalBrainOptions:{originalReceiver,reviewedGoals}`; by default this is null. The only new browser endpoints are original Session-owned read-only GETs:
   - `/api/conversations/:id/brain/sources`
   - `/api/conversations/:id/brain/context`
   - `/api/conversations/:id/brain/diagnosis`
   - `/api/conversations/:id/brain/brief`
   `server/goal-brain-http.mjs` derives the member from the original `access.begin` Session only and refuses POST/PATCH/DELETE. No outgoing model request or commercial action on GET.
8. The Pi/OMP plugin now exposes eight Brain tools, including the realtime `workspace_brain_brief` pulse and `workspace_brain_diagnose`. The tools list only approved company/product references and reviewed original Goal IDs; it does not enumerate the complete Library or grant access. Model tool registration still requires the original Host-owned hard context guard; no automatic model loop or second executor.

### Configuration boundaries

This is currently a **programmatic opt-in** to the original `createApp` for the original, reviewed operator only. `startWorkspaceServer` does not set `goalBrainOptions` and the production path stays **unconfigured** by default. Reviewed source permissions must *already* be present as the original `libraryModelReadPolicy` and must be pinned to the exact current Session and model receiver.

`reviewedGoals` are original manager-attested tuples `{id,originalRevision,currency,businessStatus,capabilities,budgetRemainingMinor:null,perTaskCapMinor:null,reviewed:true}`; these are *not* business budgets and cannot create spend authority. They are accepted only from the trusted Host, never request JSON. The native original Goal must still belong to this member/workspace. Unknown or absent policies should yield no spend recommendation; goals stay none/review pending.

**Caution:** Original Workspace is still designed around a single-business Store; enabling Brain projections does not by itself make every legacy API safe for arbitrary multi-tenant shared hosting. For initial deployment, use isolated original Stores and identity/service boundaries per enterprise, with separate Sessions.

## Local tests (scoped)

```sh
node --test test/goal-brain*.test.mjs
node scripts/goal-brain-offline-proof.mjs
```

The previously recorded Node 22.16.0 synthetic-fixture suite is historical; **V0.4 additions have not been executed in this environment**. The suite includes original-shaped Session/Goal/company/product readers; isolated SQLite **test-only Artifact API facade**, source pin/expiration checks, second owned Conversation reading saved context, session revocation, changed SKU/product revision, credential-pattern refusal, stopped Run refusal, cross-tenant context/Goal refusal, human budget null constraints, readonly HTTP and disabled default. The extended ZIP contains seven supplemental synthetic Host tests; the same source code and focused tests are stored in this PR.

`npm pack --offline --ignore-scripts` produced a valid package; no extra runtime npm dependency. Do **not** mislabel these as official Node24 original Store HTTP/OMP SDK acceptance tests. No verified model call, provider billing, browser publication, WorkerDesk dispatch, true tenant deployment or real external data access occurred. Existing OMP file-lock/EPERM and secure model configuration were not bypassed. No new paid model usage.

## Required production completion

1. In exact original Node24 environment run `npm ci`, native HTTP/Store/Artifact test suite and per-enterprise Session permission probes. Verify V0.2 protected Artifact metadata cannot be reached by legacy download/bootstrap/recovery paths.
2. Map official OMP 18.10.4's actual *private* context guard (pre-provider / restored / compacted / final) to `brain.revalidateReceipt`; do not register private tools if this cannot be proven. Save exact receipt dependency set independent of model text.
3. Wire `businessBrainExtension` through original model Session and bound FD transport only under approved enterprise profile; preserve original Run, requestId, token reservation, cancellation, quote approvals and budget limits. Do not silently run live model on opening the read-only brief.
4. Test same original model session with two real messages after `contextSave`, using only safe reviewed source fields; verify private context rejection when permissions change.
5. Only when user-reviewed recipient, endpoint price, cumulative CNY5 budget remainder and cost controls can be verified, perform minimum real DeepSeek test; otherwise leave real-model status unconfigured.
6. Next: mobile cards populated from actual `/brief`, choice to open the *same* owned original Goal/Conversation, followed by original WorkerDesk handoff with human review. Do not start unapproved external business actions.

**Cooperation:** this PR owns Brain source/tool contracts and original Host security seams. Coordinate with Dot/xy and original OMP Host integrator to avoid parallel source permissions, DB, execution loops or scheduling. This document/PR comment does not imply Dot has read or accepted the work.


## V0.4 source adapter seam

The original Host may optionally pass `goalBrainOptions.sourceAdapter`. It is the only supported path for non-Library business metrics:
- `list({identity,binding,receiver})` returns reviewed source references.
- `read({identity,binding,reference,receiver,signal})` may perform the existing service's normal asynchronous read but must return only `workspaceId/reference/observedAt/validUntil/values`.
- `current({identity,binding,reference,expected,receiver})` is synchronous and must read the same authoritative state for commit-time revalidation. No network request is allowed inside the original Store write transaction.
The Brain never stores a second copy of those source records. Inquiry, Shopify/commerce cohort and market-validation services can later implement this seam using their own existing authority and permissions.


## V0.4 host wiring

- `server/index.mjs` passes the original Goal Brain host into the existing Pi business-agent adapter.
- `server/pi-business-agent.mjs` binds one Brain to the current enterprise Session + conversation + active Run and loads its existing Pi extension; no second AgentSession or execution queue is created.
- `scripts/pi-workspace-agent.mjs` now correctly invokes the caller-provided session preparation hook and can run additional Host-owned receipt validators before each model call. This also fixes the previous local shadowing bug where the caller hook was never reached.
- Brain memory writes (`context.save`, `decision.save`) require the current enterprise Run but do not require the separate external business-submit approval. External actions remain under the original Workspace execution gates.
- `server/goal-brain-http.mjs` adds the read-only `diagnosis` route. No HTTP route can create a decision, dispatch a Worker or approve a business action.
