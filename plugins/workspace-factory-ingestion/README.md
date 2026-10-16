# Factory Library / Products ingestion plugin

Installable private standard Pi/OMP package. It supplies a Skill and four thin tools: `workspace_factory_ingestion_status`, `_read`, `_save`, `_query`. The official model/tool loop chooses which authorized uploads to read, which products to recognize and whether questions are needed. There is no business stage machine, model executor, database, queue, general file discovery or external connector.

The matching original-host adapter is [`server/factory-library-ingestion.mjs`](../../server/factory-library-ingestion.mjs). The package itself has no service transport, credentials or private access. An ordinary install returns `unconfigured`. Its copied-package install/remove and official SDK tests do not require credentials or paid model calls.

## Install and remove

From the matching repository checkout, install the fixed reviewed dependencies:

```sh
npm ci --ignore-scripts --no-audit --no-fund --cache /tmp/factory-ingestion-npm-cache
node scripts/setup-omp-runtime.mjs
node scripts/workspace-omp-install.mjs
```

For official OMP 18.10.4, use the repository's fixed Bun/CLI (replace the absolute path):

```sh
support/omp-bun-linux-x64/node_modules/@oven/bun-linux-x64-baseline/bin/bun \
  support/omp-coding-agent/node_modules/@oh-my-pi/pi-coding-agent/dist/cli.js \
  plugin link /absolute/path/workspace-agent/plugins/workspace-factory-ingestion
```

Use the same CLI with `plugin disable @workspace-agent/pi-factory-ingestion`, `plugin enable ...`, or `plugin uninstall ...`. Official Pi 1.1.0 also supports `node node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js install /absolute/package/path` and `remove /absolute/package/path`. Disable its package resources with `extensions:[], skills:[]` in its existing package settings. No npm publication, scripts, dependency installation hooks or modification of other packages is involved.

Normal OMP startup with an installed package still requires a reviewed model and original-host injection. Do not try a live model while configuration, destination, current pricing, the original cumulative CNY5 remainder and enforceable provider hard cap remain unverified. No `WORKSPACE_OMP_PROFILE=factory-ingestion` launch path is shipped in this branch; the existing shared launcher has deliberately not been changed. See the [host wiring specification](../../docs/FACTORY-LIBRARY-INGESTION-HOST-WIRING.md).

## Host injection

`factoryIngestionExtension({client, authorize})` accepts the original host client with `status(input,signal,model)`, `read(...)`, `save(...)`, `query(...)`. All four and rejecting authorization are required; partial injection is unconfigured. Missing model, invalid input, cancellation or authority failure returns blocked JSON without raw error/private receipt text. The original host must retain its Session, member, enterprise, recipient, expiry, fields, Run and cached-journal controls. Agent Bearer tokens do not substitute for Library Session authorization. The adapter also exposes `revalidateReceipt(receipt,model,signal)`; call it on every historical plugin receipt before provider requests, including reload/fork/switch/compaction.

The client constructor takes original `store`, `artifacts`, operator `identity`, `conversationId`, `scope`, `authorize` and `canSave`. `scope` is ephemeral trusted-host input, never a model/tool parameter or a new persisted permissions store:

```js
{
  workspaceId, subject, expiresAt, recipient, // original exact reviewed binding
  uploads: [{artifactId, version, sha256}], // 1–20 already private authorized uploads
  companyRevision: 1, // null refuses company disclosure/writes
  products: [{id, revision}], // original exact approved update targets
  fields: {
    company: ['legalName', 'displayName', 'description'],
    product: ['name', 'description', 'category', 'skus', 'images', 'supply.capacityNote']
  }
}
```

Fields must be derived from the original reviewed model-disclosure policy, never widened to fit this example. Product SKU projection excludes pricing. Other original supply fields can be selected only if the original authority admits them explicitly. Existing images are disclosed only when their exact assets are also selected uploads. `authorize(signal,model)` must return `{assertCurrent(state)}` whose synchronous rejecting function rechecks original live Session/role/recipient/run/revocation against the current original transaction; async or false-returning checks fail closed. `canSave()` must return boolean true for original explicit execution intent. No no-op example authority should be used in production. The new adapter wraps the existing Library service with that commit check; it does not bypass its roles, validation, links, revisions, quotas or durable operation receipts.

## Source and save contract

`status({})` returns exact selected uploads and permitted original company/product projections. `read({asset})` verifies original bytes, invokes the fixed official OMP local ReadTool, and returns text, image content, extraction limits and `source:{asset,readHash}`. No arbitrary path/URL, image question, model-backed OCR, credential discovery or remote conversion is admitted. Temporary source bytes are private and cleaned on success/failure/cancellation. Image pixels can be shown to an already authorized compatible model; an image alone does not verify text.

`save({requestId,sources,records})` accepts up to 60,000 UTF-8 bytes, 20 source receipts and 40 model-extracted records. Each record uses `key,kind,values,evidence,missing,conflicts`; optional `recordId,expectedRevision` pin an existing product. `kind:'document'` selects `sourceIndex` for source classification/certificate metadata. Every populated leaf requires `{path,sourceIndex,start,end,quote}` with exact UTF-16 offsets into the returned native text. For example, `skus.0.moq` references that particular MOQ's source fragment. Offsets are into extracted text including native line markers, not the original PDF byte stream. Page numbers are not inferred; exact fragments work when native page provenance is absent. Quotes verify source location only, never semantic accuracy.

Company fields reuse the original company Profile. Product fields reuse original Products/SKUs/images/supply. `oem`, `odm`, `dropshipping`, `capabilities` and `certificates` are retained as explicitly unverified source observations in the private Library report. A model may also accurately describe them in an authorized original description/capacity field with evidence. It must not fabricate SKU codes or turn unknowns into facts. Certificate classification uses original certificate fields and never calls original administrator review. Human confirmation, source matching and independent external verification are separate. Save results always have `humanConfirmed:false, independentVerification:false, externalActions:false`.

Image-only observations use `{path,sourceIndex,observation:'image-unverified'}`. Such records are saved for review in the report and do not populate company/catalog fields. Product image assets must be exact approved image uploads and have source-backed descriptive evidence. Missing/unreadable/truncated sources and conflicting interpretations remain explicit. Source reports preserve model proposals even when a protected field prevents application.

## Duplicates, versions, protection, recovery

Exact source SHA values reuse original document versions; a new version of the same original artifact appends an original document version. Old bytes and administrator reviews remain pinned to their own version. Duplicate files within a batch are not copied into a replacement store. Product identity uses exact case-insensitive SKU codes or an explicit original product id. No fuzzy merge is performed. Multiple identity matches or an unapproved existing target refuse without revealing its contents.

All populated existing fields are conservatively protected, including any human-confirmed field. Only blanks, new SKUs/spec keys and approved image/document links can be added. Conflicting replacements are recorded with existing/proposed values for human editing in the original UI. This deliberately does not introduce a parallel field-confirmation registry. Semantic company/product recognition remains the model's responsibility.

The original artifact service stores one immutable private plan and one private source report; the original Library stores source documents, product/company writes and operation receipts. These are ordinary original files/records, not a new database. Batches are not atomic: cancellation/outage can leave completed original writes. Retry with the exact requestId/body to resume only missing writes using original idempotency; a changed body refuses. Interrupted plan/report states are queryable as incomplete; do not claim rollback. `query({requestId})` reads the report and actual original saved product/company projections in the same authorized conversation. A later human revision or narrowed field/target scope requires fresh authorization instead of silently revealing new content.

## Reproduce acceptance without a live model

```sh
node --test test/factory-library-ingestion.test.mjs test/factory-ingestion-package.test.mjs
```

The service tests use real original Store/artifact/Library services and explicit synthetic authority/parser callbacks. The native text/PDF/image test uses the genuine fixed OMP ReadTool. The package tests copy the package outside the repository, exercise official Pi/OMP install/disable/re-enable/remove, then run genuine OMP SDK dispatch with a clearly labelled finite keyless model and actual original services. The scripted read→save→query trace is only a test scenario, not a programmed production business workflow. It does not establish real-model comprehension, enterprise authorization or real factory quality.

## Unified project plugin directory

This existing package moved from `packages/workspace-factory-ingestion` to `plugins/workspace-factory-ingestion` without changing its tool interfaces. Its original tested/unverified claims above remain scoped to that evidence. Project discovery lists it; local startup executes it only when its path is explicitly present in `plugins/config.json` `extensions` and is not in `disabledExtensions`. Add/remove the entry to enable/unload, or use `--disable-plugin workspace-factory-ingestion` for a local invocation. Explicit disable wins; restart applies changes. Native standalone loading uses OMP's `-e /absolute/path/to/this/package` (review the code before enabling). The original controlled remote Host profiles still supply their reviewed clients and authorization; directory migration does not create these bindings. No model/credentials/network is provisioned by build discovery. Package dependencies and pinned runtime peers are in package.json. Development memory is AGENTS.md; business guidance is the declared SKILL.md.
