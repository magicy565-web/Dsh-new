# Enterprise Context OSS — PR #87 blocked review repaired (2026-10-16)

**Still Draft / disabled / not deployed.** This changes only PR #87's independent adapter, package, tests and documentation. It does not modify the original Pi/OMP Host, enterprise Library/Store/Artifact code, main, PR #79 or PR #86. No paid model, ERPNext, Mem0 or Docling production access occurred.

## Data ownership and ERPNext reuse

- **Canonical today: original Workspace Library** (Profile, Products, Documents, original versions and human reviews). It remains authoritative until a separately approved, reconciled ERPNext migration and explicit cutover. No automatic dual write. All Pi receipts and status now say `Workspace Library`, never `ERPNext` as the present canonical store.
- ERPNext business objects and final Quotation/Pricing Rules stay owned by ERPNext when it eventually becomes the approved system of record. Until then ERPNext is an *external observation*, not a replacement for the Library. No status response claims that ERPNext is live.
- **No duplicate ERPNext reader in PR #87.** Removed the Item/full-record and Item Price list client and two Pi tools. Use PR #86's existing `workspace_erpnext_read` for **one exact document name and approved scalar fields** (`Quotation`, `Sales Order`, `Sales Partner`, `Item Price`) with its existing `authorizeRecord` per-record/field/receiver checks. PR #86 is on another base branch, so do not import an unmerged path into PR #87 or create a shadow policy. Original Host integrator will mount PR #86 independently after shared-base reconciliation. PR #86 does not claim general Item catalog read; original Library/PR #79 continues product queries.

## Mem0: explicitly disabled pending no-vector policy decision

Mem0 OSS `POST /search` uses embeddings and semantic/hybrid retrieval, not a deterministic non-vector lookup. Its `POST /memories` typically processes facts/embeddings too. User specified **no vector RAG**. Therefore default `createEnterpriseContextClient` rejects `memorySearch`, `memoryAdd` and `memoryHistory` *before any Mem0 request*, including when a Mem0 client is injected. They only become reachable if the trusted Host supplies `memoryApproval: {enabled:true, semanticVectorApproved:true, decisionId:'...'}` based on a NEW, explicit owner approval; do **not** set these flags now. The original Pi/OMP extension remains unconfigured because Host wiring does not exist. This opt-in path exists for isolated negative/positive contract tests, not authorization to deploy. A future owner decision may instead replace Mem0 with a deterministic non-vector memory ledger backed by the existing Library, in which case delete or leave these tools disabled.

The hypothetical reviewed path is fail-closed by design:

- A memory stores `workspaceId`, `customerId`, `sourceRef`, positive integer `sourceVersion`, lowercase 64-byte SHA-256, `authority` and `provenance`. Old records without these pins are unreadable until independently re-imported with evidence.
- `workspace-customer-v2:` + base64url(JSON-array tuple) creates an injective namespace for `(workspaceId, customerId)`. Do not reuse the old colon-concatenated `user_id`. No silent migration or cross-scope lookup.
- `scope.sourceRefs` exact-pins `{customerId,ref,version,sha256}` are only an allowlist, not proof of live authority. The original Host **must inject** `assertSourceCurrent({workspaceId,subject,customerId,sourceRef,sourceVersion,sourceSha256,action,model,signal})` to verify the current Workspace source entity exists with that exact version and SHA AND the actual customer's current read grant (including revoked, expired, field/recipient restrictions). It must return exactly `true`, otherwise nothing is disclosed. `authorize` must also revalidate original Session/Run/receiver before/after calls. No default allow helper.
- Each search result is checked for correct `user_id`, enterprise/customer provenance, source revision/SHA and live grant, **both per entry and again before return**. Invalid entries reject the **entire** search response; never drop bad rows and return a misleading partially authorized set.
- History retrieves the exact memory ID and requires source provenance for the current item **and every historical event**, then checks each event's current authorization, including a second check before return. Native Mem0 history entries might not provide per-event source metadata; those are deliberately **refused**. A reader cannot infer an old event's authorization from its latest item metadata.
- Writes require explicit `allowMemoryWrite`, complete source pin, original live source grant and a successful post-write grant recheck. A denial after an upstream side effect may leave an unseen note; do not claim atomic transaction, and do not enable in production without a compensation plan.

## Docling dispatch TOCTOU fix

For each exact original file `{artifactId,version,sha256}` from a reviewed `scope.uploads` selection:

1. `authorize` checks original live Session before dispatch; `assertUploadCurrent` must independently verify exact original artifact version, SHA and present caller grant.
2. Download the original artifact bytes; compare its recorded and calculated SHA-256.
3. **After download, immediately before Docling network dispatch**, call `authorize` with `action:'upload.dispatch'` and resource target, then `assertUploadCurrent` *again*. Deny if source was revoked between download and remote transfer.
4. After Docling conversion, check `upload.return` and `assertUploadCurrent` again before returning extracted content. Missing callback, stale source, revoked Session or incorrect hash always fail closed.

`assertUploadCurrent({workspaceId,subject,artifactId,version,sha256,action,model,signal})` is supplied only by the trusted original Host, not a client argument. Production deployment must also ensure Docling runs on the private trusted network, response/operation limits, and original cached-receipt checks across reconnect/fork/compaction.

## Validation / handoff

The source change has **14/14 independent Node 22.16.0 tests passing** via:

```sh
node --test test/enterprise-context-oss.test.mjs test/enterprise-context-extension.test.mjs
```

These tests use synthetic in-process Mem0 responses, strict simulated source grants and a loopback Docling fetch stub. They cover default-off no-network, separator collisions, foreign-customer results, missing/mismatched source version and SHA, revocation in a multi-row response/history, incomplete history metadata, file revocation between download and dispatch, tampered bytes and ERPNext reader deduplication. They do **not** establish genuine user authorization, Node 24 full app acceptance, real Mem0 history shape compatibility, production Pi/OMP SDK integration or service installation. An unsupported history metadata shape is a known safe rejection, not a successful history feature.

### Handoff for Dot (xy) and shared Host integrator

Review **this new commit on PR #87**, not the initial PR. Reconcile the PR #79 factory ingest branch and PR #86 free-trade ERP reader into one shared integration baseline; do not build another ERP client or privilege path. Keep original user Session/recipient/Run/Library source checks, no grant from Agent tokens. Only integrate these scoped adapters after (1) owner decides no-vector memory strategy, (2) `assertSourceCurrent` and `assertUploadCurrent` are real original authority callbacks, (3) original host/cached-context tests prove revocation, (4) Node24/full-app/browser tests pass. No enable, deploy, merge, real data, external Worker access or paid model calls now.

GitHub PR comment and Issue #85 can serve as coordination records but cannot confirm Dot has actually received or accepted a private message; Workspace—xy connection status must be independently verified.


## Original Host integration follow-up

The preceding sections preserve PR87's independent Node22 repair evidence. A subsequent selective integration starts at PR89 cbbad133049747e3d28720ba885b3613eb7f5a34 on `codex/enterprise-context-host-integration-20261016`. Its one package is `plugins/workspace-enterprise-context`0.2.0; the original adapter moved into that package, not copied into another client. Actual original Node24 Host/Library/Artifact/Session and pinned Bun/OMP now supply source/current grant/dispatch/native-cache/final-delivery fences. Mem0 remains disabled. The readonly Host gate blocks business Artifact saves; it was not relaxed. Current commands, synthetic/live boundaries, evidence and remaining work are in `docs/validation/enterprise-context-host-integration-20261016/`. No production Docling/model, TED retry, deploy, credentials or permission change is claimed.
