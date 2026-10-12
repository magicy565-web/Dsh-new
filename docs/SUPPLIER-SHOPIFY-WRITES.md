# Supplier Shopify adapter: later development round

This is a new round based on `08a760c045474ed92244bf2ac01e883d91a0a17d`, after the fixed 20:30 delivery. PR45's source archive and PR46's frontend delivery are preserved. Five Shopify-only files were selectively recovered from PR44 integration `1e0cc43d973b5d10861561f2cd4979065d5f33f6`, then adapted to the current business service. `docs/validation/supplier-writes/SELECTIVE-REUSE.json` records their original Git-blob byte hashes. No PR44 runtime, scheduler, queue, identity system, frontend or model executor was copied. Pi remains pinned to 1.1.0 and the existing original Workspace Store/capabilities/Connector/Muse binding remain authoritative.

## Implemented adapter

An existing host shop and token are the only shop configuration. `WORKSPACE_SUPPLIER_SHOPIFY_WRITES_ENABLED` defaults off; the original supplier Connector is created disabled only during an explicit configured review (or an explicit host setup call). Startup does not create it or grant permissions. An existing authorized administrator must enable the Connector. No OAuth installation, shop authorization, credential creation or privilege expansion is implemented or performed.

A draft review freezes the supplier owner, Workspace, original conversation and entity revision, complete public preview, image references/SHA256, exact shop/currency, deterministic handle, host configuration and original Connector revision in the original approval. Its explicit domain-bound decision admits exactly one original `connectorRun`. Credentials must arrive through that approved Connector's exact `shopify` environment reference; the adapter cannot substitute a host token omitted by the credential broker. Every external step checks the current Connector revision/enabled state and supplier intake, and records intent before starting. Revocation/cancellation stops subsequent writes.

The adapter transfers private artifact bytes through the original supplier file reader, preserving the original Muse owner/Session protocol when applicable. It checks the reviewed version, SHA256, type and size before requesting `stagedUploadsCreate(resource: IMAGE)`, then posts the original bytes without an Admin token to the bounded Shopify staged-upload host. Signed upload parameters never enter durable receipts. Currently supported upload hosts are the documented Google staged-upload host and its exact storage bucket path; any different staging host is blocked pending explicit support. `PRODUCT_IMAGE` is deprecated and is not used.

`productCreate` creates a DRAFT with the reviewed public title/description and one original intent marker; `productVariantsBulkUpdate` sets the reviewed single retail variant. Source wholesale/MOQ/production fields are excluded from the reviewed public preview. Media completion requires acknowledged original MediaImage IDs plus a complete READY read-back with a HTTPS image URL. The content fingerprint includes those media IDs, alt text and URL, so an observed replacement is incomplete. Source-byte SHA256 and upload acknowledgement do not prove equality of Shopify's transformed CDN bytes; `remoteBytesVerified` remains false. A lost product-create response lacks media-identity acknowledgement and stays partial even if a product is subsequently found.

Formal publication requires a separate review, separate approval and exact existing Publication GID. It first verifies the original complete remote DRAFT, then activates with a publication intent marker, rechecks remote content, and calls `publishablePublish` for that channel. A successful read-back proves ACTIVE + publishedOnPublication + the original marker. `Product.publishedAt` concerns Online Store only; the selected arbitrary channel receipt does not invent a channel publication date. The monitor therefore needs an explicit startAt unless its existing independent Online Store timestamp contract is met.

## API contract

All routes use the existing authenticated/owned conversation and supplier service:

- GET `.../supplier-services/:serviceId/publication`: current readiness and original operation history.
- POST `.../shopify-review`: original requestId, expectedRevision, expectedPreviewHash, confirmed:true, action `draft` or `publish`; publicationId is required only for publish.
- POST `.../shopify-decision`: requestId, operationId, expectedScopeHash, confirmed:true, decision approved/denied.
- POST `.../shopify-execute`: requestId, operationId, expectedScopeHash, confirmed:true.
- POST `.../shopify-reconcile`: same exact operation command, performing reads only.

Keep the same requestId and body when recovering a lost local response. Review/decision/admission receipts survive reopen and prevent duplicate connector admission. An uncertain remote result keeps its original operation/step and blocks blind replacement creation. Reconciliation cannot upload, create, price, activate or publish. Missing writes after partial creation require a future separately reviewed repair; repair is intentionally not implemented in this round. Existing `/shopify-draft` remains the prior non-writing boundary, so its old confirmation cannot silently grant a write.

## Authorization versus missing code

Draft creation, reviewed image transfer, formal publication and read-only original-operation reconciliation now have callable real API adapters. Their local tests use a synthetic HTTP fixture, not a real Shopify account. Existing shop configuration, existing `write_products`, existing `write_publications` for publication, Connector enablement and each explicit review/approval remain authorization blockers. No live call was made. Multi-shop onboarding, implicit repair and an external notification sender are not implemented. Product-attributed analytics still requires a usable existing authorized source; see `SUPPLIER-MONITOR-SOURCES.md`.

## Official references verified in this round

- [productCreate / initial variant / write_products](https://shopify.dev/docs/api/admin-graphql/2026-10/mutations/productCreate)
- [productVariantsBulkUpdate](https://shopify.dev/docs/api/admin-graphql/2026-10/mutations/productVariantsBulkUpdate)
- [stagedUploadsCreate](https://shopify.dev/docs/api/admin-graphql/2026-10/mutations/stagedUploadsCreate), [IMAGE and deprecated PRODUCT_IMAGE](https://shopify.dev/docs/api/admin-graphql/2026-10/enums/StagedUploadTargetGenerateUploadResource)
- [publishablePublish / write_publications](https://shopify.dev/docs/api/admin-graphql/2026-10/mutations/publishablePublish)
- [Product.publishedAt](https://shopify.dev/docs/api/admin-graphql/2026-10/objects/Product)

Ordinary implementation/regression tests are not a new independent security audit. The separately blocked audit is not retried or replaced.
