# Original Library factory materials plugin

Issue #71 builds on PR68's original enterprise Session/Conversation/Run and the
existing Library, artifacts and reviewed model-read policy. It adds no upload
store, task queue, login, credential, permission producer or execution engine.
The existing Library upload/product/document/version/review APIs remain the only
writers. Missing capacity, MOQ, lead time and certificate verification stay
missing; the Skill asks focused follow-up questions instead of inventing facts.

`plugins/workspace-factory-materials` is a standalone private local Pi/OMP
package with a standard extension/Skill manifest. It exposes
`workspace_factory_materials_status`, `workspace_factory_materials` and
`workspace_factory_document`. Ordinary installation injects no client or authority
and returns `unconfigured`, including when an Agent Bearer is present. An existing
Host can inject `factoryMaterialsExtension({client,authorize})`. The exact current
official model is required; authorization runs before and after reads. Failures
return safe structured receipts, without forwarding Host error text or contents.
The package README contains installation, disable and uninstall instructions.

## Reviewed fields and exact sources

The original `createApp({libraryModelReadPolicy})` policy can optionally carry a
`factoryMaterials` section. The original policy must still be explicitly enabled
and reviewed for an enterprise member, workspace, future expiry and exact model
provider/model/destination. No environment flag authorizes this disclosure.
Existing policies without this optional section retain their original scope and
read no factory materials. Product fields are selected explicitly from:

- `name`, `description`, `category`, `status`;
- `skuSpecifications` (original SKU ID/code/specifications/unit/MOQ/lead time);
- `capacityNote`, `documentReferences`, `provenance`.

SKU prices, commercial terms, images and arbitrary record fields are excluded.
Document references are intersected with explicitly approved document pins.
The original public-reference provenance remains reference-only and cannot
become evidence of this factory's capacity, qualifications or commitments.

The optional section has the following shape; all identifiers and values below
are explanatory placeholders, not an activated grant:

```js
factoryMaterials: {
  products: [{ id: originalProductId, revision: reviewedProductRevision }],
  productFields: ['name', 'category', 'skuSpecifications', 'capacityNote',
    'documentReferences', 'provenance'],
  documents: [{ id: originalDocumentId, revision: reviewedDocumentRevision,
    documentVersion: reviewedDocumentVersion,
    asset: { artifactId: originalArtifactId, version: originalAssetVersion,
      sha256: reviewedSha256 } }]
}
```

The original signed Session can GET
`/api/library/model-read/factory/status`, `/materials?limit=1..20`,
`/materials?productId=<UUID>` and `/documents/<UUID>/<version>`, using the existing
`X-Workspace-Library-Recipient` hash. The original ingress/Session checks and
member/workspace/expiry/model checks precede Library reads. Bearer-only, foreign
member or enterprise, unapproved fields/IDs and changed revisions are refused.
Writes and arbitrary identity/path/URL/field selectors are not accepted. A
partially missing selection returns no earlier successful records.

Every returned projection carries the original record ID/revision and projection
hash. Documents also retain document version and artifact ID/version/SHA. File
reads reuse original artifact integrity validation. Documents must remain active
at the approved current version; a new version or review revision requires fresh
original review. Certificate metadata and internal administrator review are
reported separately from independent certificate authentication, which is false.

Text/Markdown/CSV and PDFs are bounded to 64 KiB original bytes. PDF extraction
uses the fixed official OMP ReadTool in an isolated Bun subprocess with no agent,
model, auth store, external requests or OCR. Extracted text is bounded, and scan
hints/truncation remain explicit. Absence of OCR hints does not prove all pages
were reviewed. Unsupported formats or unavailable native reader return a blocked
receipt. Only the extraction's owned temporary directory is removed on close,
failure or cancellation; original artifact bytes remain in their original store.

## Controlled OMP host

The default `omp:18.10.4:public-v1` scope remains public-only. Trusted host metadata
`WORKSPACE_OMP_PROFILE=factory-materials` selects the distinct
`omp:18.10.4:factory-materials-v1` scope. This choice grants no Library access by
itself. The existing host still must supply the original reviewed policy and safe
model configuration/budget. The native Session remains in the original host;
only readonly projection RPCs and receipts cross the private worker fd. Worker
credentials are never promoted to Session authority.

This profile disables public search/browser/subagents and public-file tools, so
private factory uploads cannot flow into a public search query. The terminal
pins its expected profile; changing profile or receiver cannot adopt an old
transcript. Official OMP extension initialization supplies the actual current
model. Before every model request, including after reopen, the guard checks all
original journal entries and outgoing context for factory material receipts,
reauthorizing the same original Session, recipient, scope, record versions,
artifact bytes and extraction policy. Branch/tree/compaction switching remains
disabled in this controlled profile. An original revision change blocks before a
new model request; it does not silently retain older model-visible materials.

Actual deployment, authorized real factory materials and a real model remain
separate acceptance gates. This implementation and its finite keyless tests do
not establish them or the original cumulative CNY5 allowance. No paid model,
production action, credential creation, permission expansion or deployment was
performed. Seven-day recipient/continuous notification consent is unchanged.
