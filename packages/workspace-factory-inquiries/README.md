# Workspace factory inquiries

Private local standard package for official Pi 1.1.0 and OMP 18.10.4. Two tools delegate to the existing reviewed Host; a separate pure module prepares source-bound review drafts. No environment/credential discovery, Library transport, parser, store, queue, model executor or external sender is supplied.

`factoryInquiriesExtension({client, authorize})` registers:

- `workspace_factory_inquiry_prepare({inquiryDocumentId, documentVersion, productId, requirements})`.
- `workspace_factory_inquiry_save({...sameInput, requestId, expectedDraftHash})`.

Both UUIDs are exact original IDs; document version is 1–100. Requirements admit only `product`, `spec`, `quantity`, `targetMarket`, `requestedDelivery`, `requirements`, each null or a string of at most 1,000 characters. There are no field, file, URL, identity, role, model, budget or recipient selectors.

The Host injects `client.prepare(input, signal, model)`, `client.save(input, signal, model)` and rejecting `authorize(signal, model)`. Authorization runs before and after each operation. No injection returns `unconfigured`; missing model, invalid input or Host errors return safe `blocked` JSON without error text or private receipts. A blocked/unavailable client result remains an error. Ordinary package loading never grants private Library access. The controlled Host must retain its exact Session/recipient/expiry/version policy and full original-journal reauthorization before every provider call.

Import `prepareFactoryInquiry({inquiry, materials, requirements})` and `factoryInquiryHash(value)` from `./drafts`. Inputs are original validated `workspace-factory-materials` document and single-product DTOs with identical authorization. Nonempty requirement values must be exact substrings of `inquiry.document.text`; the function does not extract, guess or numerically compare them. It checks source IDs/revisions/asset references and projection hashes, retains original source receipts, and returns deterministic quotation/sample/follow-up drafts plus pending human comparison. Price fields are absent, so all pricing remains pending. Sample availability/cost/dispatch and previous communication remain unknown.

The returned `input` contains only the exact document ID/version, product ID and normalized requirement excerpts for fresh replay. `draftHash` is `factoryInquiryHash(payload)` over the entire returned JSON payload **before adding `draftHash`**: authorization, sources, input, requirements, match, drafts and human-review-required, humanReviewed:false and sent flags. The exported hash function is generic canonical sorted-key JSON SHA256; it does not automatically remove fields. Do not hash the whole receipt including its existing `draftHash`. Any source/version/authorization/content change requires fresh preparation and an unchanged expected hash. This is data integrity, not evidence of human review. Save/replay/idempotency/artifact integrity are the original Host's responsibility; the pure function performs no persistence or authorization issuance.

`available` describes draft preparation from available inputs, not a verified product match, approved quotation, real stock or business completion. Partial extraction, missing inquiry fields or reference-only product data remain explicit. No sending occurs. The original model receiver must remain pinned; private transcript authorization is never permission to disclose inquiry text to public search or a different engine/model.

The package's manifest declares only its extension and selected Skill. Pi can install/remove this local path and disable its extension/Skill resources; OMP can plugin link/disable/enable/uninstall it. No npm publication is intended. The community source is fixed in `sources.json`; the package uses only independently written concise drafting principles, with no source collection installation or operational sending instructions.

Saving persists unreviewed drafts only (`status: saved-draft`, `humanReviewed:false`). Model parameters, including an attempted `confirmed:true`, cannot establish human approval. Original explicit execution intent permits this internal draft write; review and any later external action retain their existing human approval boundaries. No exact-draft approval is issued by this plugin.
