# Enterprise context through the original Workspace Host

Private `@workspace-agent/pi-enterprise-context` 0.2.3. Selectively received PR87 repair `13cccff0df703e6471329cd0e1815aee3f6179a9` onto PR89 `cbbad133049747e3d28720ba885b3613eb7f5a34`. Canonical package: `plugins/workspace-enterprise-context`, with its adapter code inside the same package for standalone loading/packing. No older Host files or PR79 baseline were copied.

Workspace Library remains the authority for company/product/documents, current versions, SHA and human reviews. ERPNext exact-record reads stay in `workspace-free-trade`; this package adds no ERP client. Mem0 is disabled in this Host for search, add and history. No vector stack, account, database, permission store, approval service, scheduler or Agent Loop is added.

## Actual tools

| Tool | Current behavior |
| --- | --- |
| `workspace_enterprise_context_status` | Original source selection and service state, not a live service success. Configured private metadata receives original native provenance proofs. |
| `workspace_enterprise_context_parse_upload` | Exact original `{artifactId,version,sha256}`, already selected by the trusted Host and authorized by original Library plus a fresh explicit complete-file transfer check. Fixed reviewed Docling origin; no URL, customer or authority argument. |
| `workspace_enterprise_context_memory_search` / `memory_add` / `memory_history` | Always `OSS_MEM0_DISABLED` in this integrated Host; no Mem0 request or approval flag. |

Ordinary external installation and local CLI loading without the original Host return `unconfigured`. Loading a manifest does not authorize enterprise reads. The default project config leaves this package disabled. It can coexist with the probe/free-trade packages; an enterprise private context cannot inherit unguarded public tender outbound tools. ERP read and Docling use their separately reviewed original Host profiles; this patch does not merge their private bindings into a broader grant.

## Zero-request preflight and reproducible acceptance

Existing reviewed dependencies are Node24+, Bun1.3.14 and OMP18.10.4 with the repository's pinned locks/audit. Do not install another runtime.

```sh
node scripts/enterprise-context-preflight.mjs
node --test test/enterprise-context-oss.test.mjs test/enterprise-context-extension.test.mjs
node --test test/enterprise-context-host.test.mjs
npm run plugins:pack-check
npm run build
```

Preflight reads no credentials or business records, makes no service/model request and creates no Session. Host tests launch the actual original signed Session/Run/Library/Artifact and native OMP worker with a local HTTP **Docling stand-in** and finite synthetic model. This is a reproducible integration test, not an installed/working Docling parser or real inference. Normal `npm start` is unchanged; setting a new environment flag does not create this private binding.

For an ordinary external Pi package manager, the package path is `/ABS/repository/plugins/workspace-enterprise-context`; use its original install/remove mechanism. Actual testing here uses the pinned OMP native loader, including an outside-repository package copy. Other Pi CLI versions and a real self-hosted Docling instance are unverified.

## Trusted original Host binding

Only existing in-process Host code can select `createWorkspaceOmpEngineAdapter({paths,configuration,enterpriseContext:true})` and return its original readonly Session client/model plus:

```js
enterpriseContextHost: await app.enterpriseContextSessionBinding(actor, {
  recipient: existingReviewedModelRecipient,
  selection: existingReviewedCustomerDocumentSelection,
  connection: existingReviewedSafeDoclingConnection,
  authorizeParserTransfer: existingLiveCompleteFileTransferCheck,
})
```

The app injects its own access, instance, Session client, Library authority, Artifact service and Store. Model arguments, bearer tokens, owner UID or a customer label cannot create authority. Selection is `{enabled:true,reviewed:true,customerId,sources:[{documentId,asset:{artifactId,version,sha256}}]}` with at most eight pins. `customerId` is trusted Host narrowing/namespace, not a new customer database or ACL: **each selected document must independently pass the existing exact Library policy**. It cannot expand that policy. Changing customer/selection/Host/Session/recipient binds a different scope and cannot inherit previous private native receipts.

Connection is fixed reviewed `{reviewed:true,baseURL,apiKey}` supplied through the existing safe channel; optional trusted `timeoutMs` is 1–30000, default15000. This patch creates/configures none of those values in production. Missing Library grant or safe connection is explicitly unavailable/unconfigured; it never substitutes local extraction and calls it Docling. The original Library model policy must already authorize the actual signed operator/admin, exact model receiver, document ID/current revision/current document version and artifact version/SHA. No new HTTP grant endpoint or role exists.

A model-field read policy is insufficient for complete original-file transfer. The trusted Node Host must also supply `authorizeParserTransfer(request)`, backed by its **existing** live consent source. Absence, anything other than `true`, error, cancellation or timeout fails closed with no original-file dispatch. This patch adds no production consent, credentials, grant endpoint or approval store. The callback is never supplied by tool/model input and never crosses to Bun.

Every request pins `workspaceId`, `subject`, actual `sessionId`, `nativeSessionId`, model, exact `target:{artifactId,version,sha256}`, `documentId`, `documentRevision`, `documentVersion`, `recipient:{kind:'docling',destination:'<fixed-origin>/v1/convert/file'}`, `purpose:'document-extraction'`, `transfer:'complete-file'`, `action` and `signal`. Only explicit consent for **all** these file/receiver/purpose facts may return `true`; a generic field-read permission or a customer label is insufficient. The fixed transport configuration is copied at binding creation. Different recipient/file/version/SHA needs the original Host's own explicit authorization, never an automatic model fallback.

This selectively reuses the live `checkParserGrant`/`verify` semantics from PR87 `b7bd2410a623a9d7ec654a0a826ac3778cae64c3` `server/enterprise-context-original-authority.mjs` inside the existing PR91 Host. Existing bridge checks retain original active Run ownership/cancellation; existing Library checks retain source authority. No second authority instance/module is attached. Checks run before source download, twice at post-download/pre-dispatch, after return and when a parse proof is reused/disclosed (including final delivery). Session/source are rechecked after an asynchronous consent decision. The decision wait is bounded by the existing trusted `timeoutMs` and original Run signal even if the callback ignores cancellation or resolves late. Arbitrary checker diagnostics are discarded. Library/status metadata remains independently guarded and cannot confer transfer consent.

## Dispatch and disclosure fences

The original Library `documentRef` validation is reused without invoking another extractor. Exact original bytes are downloaded only on Node. The PR87 adapter checks recorded and calculated SHA; original Session/receiver/current document/asset permission is checked after download **before any Docling bytes leave**, and again after conversion. Docling API credentials and raw original uploads do not enter Bun, model tools, argv or logs.

Successful parse and private status receipts bind document ID/revision/version, original artifact/version/SHA, exact namespace/Host/native Session and body hash. Each status proof pins the complete actually disclosed `sources` array; every source is checked independently through Node final delivery. The `source` field remains a first-source alias, never the dependency list. Cached status proofs missing or truncating that complete list are refused before another model request, including after compaction; parse proofs additionally require Node-authenticated credential-screening evidence. Unscreened legacy parse receipts are refused even when their original body is no longer in context; no version flag can upgrade them. The MAC binds the complete proof (body/source/scope/native Session) to the current Node-only Docling credential after screening. A credential rotation therefore also refuses old parse evidence. Start a fresh safe Session; this patch neither migrates nor deletes old journals. The existing OMP loader/context hooks and original disclosure guard snapshots carry these obligations across resume/compaction. Before every model preparation/dispatch/completion, worker delivery and final original Node delivery, current Session and Library source are rechecked, including actual original byte SHA for consumed proofs. Guards do not call Docling again merely to validate a cached parse. Missing plugin/guard/proof, changed source, revoked Session or cached-text tamper refuses reuse before another model request or final delivery.

External extraction is untrusted text, not a new canonical fact or approval. Limits: at most four parse attempts per owned worker turn, eight cumulative distinct proofs, 5MiB input, 2MiB service response and 48KiB accepted extracted text. Oversized/unsafe output is refused. Timeout/cancel propagates through the original Run/private RPC to the single HTTP request; no automatic retry. Node also rejects the known Docling connection credential in a successful service response or parsed result, independent of generic secret-format detection. Supported echoes include raw value, JSON/Unicode/hex escapes, common/numeric HTML entities, URI encoding, Base64/Base64url and hex, with up to three common escape-normalization passes. The whole decoded JSON response is checked, including error arrays, before any result crosses private RPC. HTTP/transport failures keep static error codes and discard upstream bodies/exception text. `OSS_CREDENTIAL_ECHO_REFUSED` contains no credential, match or response excerpt. No credential or complete upstream response is logged, even in synthetic tests. Native Session is the original private journal, not a business Artifact or a replacement memory database. Hashes pin original Host-recorded receipts; arbitrary caller-edited journals do not confer authorization.

## Artifact save blocker

The original readonly Session client rejects `workspaceExecution:true` with `SESSION_READONLY_EXECUTION_REFUSED` **before a Run or SDK/service call**. This profile therefore exposes no save tool and performs no business Artifact write. The actual original Artifact service is used for source download and integrity checks only. A future separately scoped integration may reuse an existing write-authorized Host binding and original Artifact commit guard; this patch does not relax the readonly gate, create a bearer, or build a ledger to bypass it. Existing Library ingestion/Artifact tools remain in their original approved profile.

## Evidence and remaining work

The historical PR87 tests/handoff are `docs/ENTERPRISE-CONTEXT-OSS-20261016.md`; initial integration evidence is `docs/validation/enterprise-context-host-integration-20261016/`; subsequent final-disclosure and credential-echo repairs are recorded in `docs/validation/enterprise-context-disclosure-fixes-20261016/`. Unit contract tests retain hypothetical Mem0 source-validation fixtures, but this Host supplies no memoryApproval or Mem0 client and exposes no semantic activation switch. Those fixtures are not owner approval or live Mem0 verification.

Still unverified: real Docling deployment/version/format compatibility and production authorization, real model quality, production customer configuration and write-authorized business Artifact saving. No real external model, TED retry, service deployment, credentials, main merge or permission expansion occurred. Coordination: https://github.com/magicy565-web/workspace-agent/issues/85.
