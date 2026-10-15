# Factory plugin interfaces — 0.2.0

Base: PR #68, `d82d35fd7213012ff6b0e5f2f24d765aba021a9e`. Development branch: `codex/standardize-factory-plugin-interfaces-20261015`. This document is the integration contract for the parallel market-validation plan/monitor work. It does not introduce a new framework, execution loop, schedule, approval service or connector.

## Packages and supported upstreams

The three private ESM packages remain standard Pi packages: `pi.extensions` points to `src/extension.js`; `pi.skills` selects only the corresponding Skill. Default exports register unconfigured tools without discovering credentials, permissions or accounts. Named extension factories retain `{ client, authorize }` injection. Existing tool names and root exports remain stable, including the inquiries `./drafts` export and the customers root `validateCustomerDrafts` export.

Each package now exports `./contracts` with its JSON Schema, pure runtime validator and TypeScript input declarations. These modules contain business DTO checks only. They have no runtime dependencies, lifecycle scripts, credential lookup or model calls. Schemas are passed directly to the official `registerTool` API. The official SDK validates model tool arguments; runtime DTO validators also protect direct Host calls. Schema constraints and business-policy constraints are tested separately using the actual upstream validators.

| Target | Lock and verification | Extension/package/Skill source |
| --- | --- | --- |
| Pi 1.1.0; Node 24.19.0 | Root `package-lock.json`; exact optional peer | Installed `@earendil-works/pi-coding-agent/docs/{extensions,packages,skills}.md`; `dist/core/extensions/types.d.ts`; `@earendil-works/pi-agent-core/dist/types.d.ts`; `@earendil-works/pi-ai/dist/utils/validation.js` |
| OMP 18.10.4; Bun 1.3.14 | `support/omp-coding-agent/package-lock.json`, `compactaudit.json`; exact optional peer; verified official runtime install | Installed `src/extensibility/extensions/{types,wrapper}.ts`, `src/extensibility/plugins/{manager,types}.ts`, `src/extensibility/skills.ts`; `@oh-my-pi/pi-ai/src/utils/{validation,schema/json-schema-validator}.ts` |

These are tested versions, not a promise of compatibility with arbitrary future SDKs. OMP requires Bun and has no implicit Node fallback. Pi and OMP own the model/tool loop and Skill loading. OMP's `approval: read/write` metadata describes the operation; it creates no Workspace permission. No native approval system is replaced.

Both upstream coding-agent packages declare MIT. The OMP package contains its complete MIT notice; the installed Pi archive omits a root LICENSE file, so its repository license was checked separately at the resolved v1.1.0 tag commit. Registry archive integrity is pinned in the existing lockfiles. Metadata/license checks do not claim independent publisher provenance verification; the OMP audit still states `publisherBuildSigstoreVerified: false`. See the scoped validation evidence for checked paths, hashes and source URLs. These private business adapters declare `UNLICENSED`; upstream MIT does not grant a new license to this repository. No upstream implementation code or Skill collection was copied into these changes.

The optional inquiry-writing reference remains cold-email 2.2.0 at `55ff469422c3592dac45bcad08dfb40221981c02`. Its resource/license SHA-256 values were re-fetched and matched `packages/workspace-factory-inquiries/sources.json`. It supplies optional method guidance. Customer work has no fixed four stages, inquiry work has no fixed three drafts, and saving is optional. The existing Skills retain that distinction.

## Composable tools and DTOs

| Tool | Input | Original capability |
| --- | --- | --- |
| `workspace_factory_materials_status` | `{}` | Current original Library disclosure status |
| `workspace_factory_materials` | `{ productId?: UUID, limit?: integer(1..20) }` | Exact approved product revisions and fields |
| `workspace_factory_document` | `{ documentId: UUID, documentVersion: integer(1..100) }` | Exact approved document/asset version and bounded extraction |
| `workspace_factory_customers_save` | `{ requestId, documents, sourceToolCallIds }` | Same-conversation original successful public search/browser receipts and original artifact save |
| `workspace_factory_inquiry_save` | `{ inquiryDocumentId, documentVersion, productId, sources, documents, requestId }` | Re-read exact original inquiry/product sources and save original artifacts |

All DTOs reject unknown fields at direct entry. UUIDs and SHA-256 strings use lowercase hexadecimal. Callers cannot select a Session, recipient, workspace, private path, URL transport, fields or approval by adding input fields. Official SDKs may repair/coerce some model arguments before dispatch; the extension revalidates the resulting DTO and the original Host independently rechecks permission and provenance. A model `confirmed` field never constitutes human review, whether rejected or removed by upstream normalization.

Inquiry `sources` contains one complete `factory-document` reference and one complete `factory-product` reference. Both require `kind, workspaceId, recordId, revision, projectionSha256, api`. A document additionally requires `documentVersion, artifactId, version, sha256`; a product cannot carry those document-only fields. The API path, selected IDs/version and workspace must match. Revisions/asset versions must be positive safe integers. The runtime validator normalizes source order to document then product, independent of the order in which the model chose to read them. The original Host re-reads and compares the exact references and current authorization; supplied hashes do not create authority.

Save input contains 1–5 unique safe Markdown filenames and substantive model-written bodies. Inquiries accept safe names up to 83 ASCII characters, a stable `[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}` requestId, at most 6,000 serialized source-reference bytes and 60,000 total UTF-8 body bytes. Customers retain the narrower alphanumeric/underscore/hyphen filename stem, at most 100 filename characters, 24,000 Unicode characters per body, 60,000 total UTF-16 body units, and 1–20 unique original public tool-call references. Customer strings also undergo the original private-material/credential/path disclosure screening. Empty/whitespace bodies and NULs are rejected. Aggregate sizes, filename uniqueness, correspondence between selectors/references and public-only screening are explicit business rules beyond JSON Schema.

## Host injection and return values

Keep these existing signatures:

```js
authorize(signal, model)                         // current original authority
materialsClient.status(signal, model)
materialsClient.materials(input, signal, model)
materialsClient.document(input, signal, model)
materialsClient.revalidateReceipt(receipt, model, signal)
customerClient.save(input, signal, model)
inquiryClient.save(input, signal, model)
inquiryClient.revalidateReceipt(receipt, model, signal)
```

The exact current official model receiver is required. The extension checks cancellation and authority before dispatch and again before disclosing the result. The existing private worker RPC forwards per-operation cancellation to the original Host, combined with original Run cancellation. Client errors expose reviewed business codes/categories only; arbitrary Host error messages or codes never become tool text. The original Library transport also checks cancellation before request/after response and cancels a pending response reader. Original artifact commit checks remain authoritative. Cancellation after a commit is possible: retry with the same requestId and exact body to reconcile; a cancelled tool result does not prove that no earlier artifact committed.

Each tool returns the upstream shape `{ content: [{ type: 'text', text: JSON.stringify(receipt) }], details: receipt, isError?: true }`. `content` and `details` carry the same receipt. Materials preserve `available`, `empty`, `partial`, `blocked`, `unconfigured`, `unavailable`; partial extraction remains useful data with its original limitations. Save success is `saved-draft`; an incomplete batch is `partial` with `reason: ORIGINAL_ARTIFACT_SAVE_INCOMPLETE`, the already saved original artifact references, and `isError: true`. All blocked/unconfigured/unavailable results also set `isError: true`. There is no automatic retry.

Successful save receipts contain `sources` and `artifacts: [{ name, artifactId, version, sha256, duplicate }]`. Inquiry receipts also retain original `authorization`, `input` selectors, extraction limits, `sourceHash` and `batchHash`. These are provenance/data-integrity evidence, not semantic validation of prose. Save clients must explicitly return `humanReviewed:false`, `humanReviewRequired:true`, `sent:false`, `externalActions:false`; customers additionally require `verifiedBuyer:false`, `contactPermission:false`. A callback returning contrary flags or the wrong plugin/status is refused, rather than silently presented as a valid saved draft.

Safe failure receipts have no source contents. The `reason` codes callers can distinguish are:

| Reason | Meaning / next action |
| --- | --- |
| `FACTORY_MATERIAL_INPUT_INVALID`, `FACTORY_CUSTOMER_INPUT_INVALID`, `FACTORY_INQUIRY_INPUT_INVALID` | Repair input; no client operation was dispatched |
| Original `*_REQUIRED` unconfigured reason | Bind the existing reviewed Host; installing a package or providing Agent Bearer is insufficient |
| `EXACT_MODEL_RECEIVER_REQUIRED` | Use the exact current receiver from the official context |
| `ORIGINAL_AUTHORIZATION_REFUSED` | Recheck existing authority/Run intent; no replacement permission is created |
| `ORIGINAL_OPERATION_CANCELLED` | Stop dependent work; reconcile committed artifacts only under existing authority |
| `ORIGINAL_HOST_OPERATION_FAILED` | Original operation failed; no success or model fallback is inferred |
| `INVALID_ORIGINAL_READ_RECEIPT`, `INVALID_ORIGINAL_SAVE_RECEIPT` | Correct Host integration; no returned data is disclosed |
| `FACTORY_INQUIRY_SOURCE_CHANGED`, `FACTORY_INQUIRY_REQUEST_CHANGED`, `PUBLIC_DRAFT_REQUEST_CHANGED` | Re-read current sources or resolve the changed request; never overwrite the original batch |
| `FACTORY_INQUIRY_ARTIFACT_CHANGED`, `PUBLIC_DRAFT_ARTIFACT_CHANGED` | Original draft was edited/versioned; replay cannot claim the original content still matches |
| `ORIGINAL_PUBLIC_SOURCE_RECEIPT_REQUIRED`, `PUBLIC_SOURCE_URL_REFUSED`, `PUBLIC_SOURCE_METADATA_LIMIT` | Use successful bounded original public receipts from the same owned journal |

Original source clients may return their existing more specific blocked reasons, such as `FACTORY_MATERIAL_SESSION_REFUSED_HTTP_404`; these remain compatible. Package loading without a Host stays unconfigured.

## Idempotency and migration

The existing original artifact service remains the only store/serialization boundary. Request grouping uses original workspace, subject, conversation and stable requestId. Exact replay reuses artifacts; changes to documents, file set or resolved sources conflict. Partial batches can resume with the same exact input. Concurrent exact requests in the same Run create one artifact per filename. Existing original Run associations are retained on replay. The adapters now additionally check original artifact version, expected content hash, name, conversation, batch/source metadata and review flags before reporting a duplicate as saved. They do not undo user edits or create a replacement approval record.

0.1.0 consumers using the valid original Host need no tool-name/signature changes. Custom callback doubles/integrations must supply the explicit review/unsent flags above. Inquiries must now supply full document/product references that already exist in the original materials receipts; incomplete or extra-field source objects previously accepted by the shallow validator now fail before save. Use the exported validator for direct calls; old `./drafts` and root customer validator imports continue to work. Error/unconfigured results and incomplete save batches now consistently mark upstream `isError`. Existing valid original journals/receipts and artifacts are not rewritten. Old prepare/three-template receipts remain unsupported as in PR #68. Read current authorized sources in the existing conversation or open a fresh authorized one when historical data no longer meets the original guard.

## Boundaries for A/B and Shopify research

A market plan/Skill or seven-day monitor can compose the above tools with other existing capabilities. It must not encode a mandatory customer-development sequence or manufacture review permission from model output. Saving these drafts grants no future notification, sending, commercial publication, price commitment, order, payment or dispatch authority. Follow the existing Host's permissions for those operations.

Product upload/publication, orders, inventory and metric reads belong to the existing Shopify service/connector. Reuse those operations in the plan and independent Shopify operations plugin; do not duplicate authentication, a Shopify connection or commerce writes inside the seven-day capability. This branch does not modify the A/B `workspace-market-validation` package, `market-validation-plan.mjs`, `market-validation-monitor.mjs`, Shopify services, or a shared startup registry.

### Minimal A/E integration points (not implemented by this branch)

Use the same original Host for the plan/monitor and the new factory-ingestion package. No second Host, model loop, enterprise data store or credential conversion is needed. The plan/monitor PRs #77/#76 and ingestion are separate capabilities; their new tools are **not wired by this branch**.

1. **Original authority and service binding:** `server/pi-business-agent.mjs`, `complete()`, beside construction of `materialsClient`, `inquiryClient`, `customerClient` and the existing `engineAdapter.complete(...)` call. Bind any new client to the already verified identity, conversation, Run, original Session, `authorize` closure and original service. Models pass business DTOs, never identities or service URLs. Private Library transport combines the caller's operation signal with the original Run signal.
2. **Owned worker transport:** `server/workspace-omp-worker.mjs`, `start()`. Pass the selected new extension's client callbacks into `createWorkspaceOmpSession`; forward them through existing `request(method, args, signal)`. A callback has `(input, signal, model)`; a status callback has `(signal, model)`; cached receipt revalidation has `(receipt, model, signal)`. Serialize only DTO/model data into `args`; never serialize an AbortSignal or credentials. `cancelRequest` already maps an aborted operation to the original pending request. New clients reuse that transport.
3. **Profile-specific Host dispatch:** `server/workspace-omp-bridge.mjs`, `handleLine()`. Admit the selected new method explicitly for the corresponding authorized profile, call the bound original service with `rpcSignal`, and preserve the existing original Run/member authorization boundary. `rpcSignal` combines tool cancellation and Run cancellation. Add only reviewed finite business codes to the existing error-code allowlist when a new capability needs them; arbitrary exception text/code is deliberately suppressed. Do not broaden the generic business allowlist or let the model choose an RPC name.
4. **Official tool/Skill loading:** `server/workspace-omp-session.mjs`, selected Skill root plus `selectedSkills` assertion, `admittedTools`, and the `sdk.createAgentSession({ extensions: ... })` list. Register a new package factory once, pass its client and `authorize`, and add its exported exact tool-name constants only to the intended profile. Update the existing active-tool filter and saved-journal allowlist together. Keep official Skill discovery/`skill://` reading; do not paste whole Skills into prompts or turn the plan into an obligatory workflow. Capabilities changing a profile's private/public disclosure meaning need an explicitly reviewed compatible engine scope; never inherit private receipts into the public profile.
5. **Cached private receipts:** extend the existing `revalidateFactoryContext()` dispatch only if a new tool returns private Library contents/source receipts. Reauthorize and re-read/revalidate them before every provider call, including saved whole-journal replay. Empty safe failures may be skipped; a successful or incomplete save with private sources must retain its data receipt and be revalidated even when `isError` is true. Do not add a second permission cache.
6. **Original data/commerce services:** factory ingestion should call the existing `businessLibrary` company/product/document operations, original `artifacts.create` and document version append, with their existing request IDs, source references, revision checks, visibility and review rules. Existing `libraryHttp` routes remain the human-facing API. Original `library-model-read` policy still controls later model disclosure of those records; creating a product or importing a file does not auto-authorize its disclosure or review. Shopify operations reuse the existing Shopify service. The B monitor retains the original task association, scheduling and dispatcher; a tool's success must not create a new independent scheduler or grant future action permission.

For every new boundary, use the same upstream return envelope and cancellation/error meanings above. An aborted or refused call cannot supply success data or human approval. A save receipt's original ID/hash is usable as a reference under current authority, not as a substitute for it. Verify package loading, a valid call, invalid DTOs, service failure, cancellation, exact replay and foreign/expired authority in the existing Host before claiming integration complete.

## Validation limits

The scoped evidence distinguishes real upstream package/CLI/SDK/schema loading and real original Session/HTTP/Store/artifact checks from finite keyless model scripts and synthetic identities/materials. Those scripts prove interface compatibility and guarded execution. They do not prove real autonomous tool selection, writing quality, authorized enterprise facts or business outcomes. No paid model, real commercial publication, deployment, main modification or merge is part of this work.
