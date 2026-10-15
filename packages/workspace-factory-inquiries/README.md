# Workspace factory inquiries

Private local standard package for official Pi 1.1.0 and OMP 18.10.4. It supplies one thin original-artifact save adapter and an optional Skill. The official model/tool loop decides whether to read existing authorized inquiry/product data, ask a focused question or write useful reply documents. There is no prepare tool, fixed three-document template, parser, model executor, Library transport, storage, queue, credential discovery or sender.

`factoryInquiriesExtension({client, authorize})` registers only:

```js
workspace_factory_inquiry_save({
  inquiryDocumentId, documentVersion, productId,
  sources, // the two unchanged original document/product read references
  documents: [{ name: 'reply.md', content: 'Model-written substantive body' }],
  requestId
})
```

IDs are exact original UUIDs; document version is 1–100. Documents: 1–5 unique safe Markdown filenames, nonempty bodies and a combined maximum of 60,000 UTF-8 bytes. Sources retain original record/revision/projection SHA and document/artifact version/SHA fields. The Host independently validates their full contents against fresh original reads. A stable requestId is required. There are no field, path, URL, identity, recipient, budget or model selectors; no `requirements`, `expectedDraftHash`, `confirmed` or approval fields are accepted.

The Host injects `client.save(input, signal, model)` and rejecting `authorize(signal, model)`. Authorization runs before and after save; cancellation is forwarded. No injection returns `unconfigured`; missing model, invalid input or Host errors return safe blocked JSON without private receipts or raw error text. Blocked/unavailable client results remain errors. Ordinary installation grants no Library access; an Agent Bearer cannot stand in for the original enterprise Session. The controlled Host must retain exact member/enterprise/receiver/expiry/version policy and full original-journal reauthorization before each provider call. Cached receipts must reject unknown fields and changed extraction, selectors or artifact references. Its custom inquiry profile exposes materials/document tools, save and the fixed Skill reader, without the legacy generic factory extension/tools or business RPC methods. Private material cannot become public web input or migrate to another engine/model.

`./drafts` exports `validateInquiryDrafts(input)` for data validation and `factoryInquiryHash(value)` for generic canonical sorted-key JSON SHA256. It generates no prose and issues no authorization or human approval. There is no `prepareFactoryInquiry` or returned `draftHash` contract. The original service freshly reads the selected inquiry/product, checks unchanged sources and persists the supplied bodies through original artifacts, adding provenance/extraction limits and review markers only. It does not assess prose as factually or commercially correct.

Saved receipts remain `humanReviewed:false`, `humanReviewRequired:true`, `sent:false`; files retain internal visibility and original conversation/creating Run/artifact associations. Readonly Runs cannot write. Stable identical replay preserves existing IDs; partial-save recovery uses the original Store and fills only missing files. Changed bodies/file sets/source context under the same request ID are refused. Exact source references and internal hashes are integrity evidence, not reviewed quotations, real inventory, accepted manufacturing fit or permission to contact. Prices, qualification, delivery commitments, sample stock/fees/dispatch and previous communication remain unknown unless supported by authorized evidence. The save operation neither approves nor sends anything.

The manifest declares the extension and selected Skill. Pi supports local install/resource disable/remove; OMP supports plugin link/disable/enable/uninstall. In the controlled Host, official `sdk.loadSkillsFromDir` discovers only selected Skills, and constrained `workspace_skill({name})` reads a loaded Skill via the official `skill://` resolver/native ReadTool. Inquiry/customer profiles omit the generic factory-export Skill and do not separately duplicate full Skill text in the prompt. These Host controls do not grant ordinary package installations private access.

Optional writing principles—evidence-based relevance, a concise purpose, one easy question and meaningful new supplied information before a follow-up—are independently adapted from cold-email v2.2.0. [sources.json](sources.json) records commit `55ff469422c3592dac45bcad08dfb40221981c02`, immutable resource/license URLs, SHA and MIT attribution (Copyright © 2025 Corey Haines). They are suggestions, not a mandatory sequence or document set. No collection, account/domain setup, sending code or automatic follow-up is installed or executed.

Current preservation evidence records actual official package/SDK and original services using finite keyless scripted responses. Different scripts prove supported tool paths and document counts, not real-model intelligence or suitable business output. Actual enterprise material disclosure, a safe paid-model configuration, remaining original cumulative CNY5 budget, real inquiry quality and human review remain unaccepted. No npm publication is intended.

## Interface version 0.2.0

See [the interface and migration contract](https://github.com/magicy565-web/workspace-agent/blob/codex/standardize-factory-plugin-interfaces-20261015/docs/FACTORY-PLUGIN-INTERFACES.md) for supported fixed upstreams, errors/cancellation, original source and artifact checks, and integration boundaries. The local `./contracts` export supplies the published JSON Schema, pure input validator and TypeScript DTO declarations. The default and named extension entrypoints remain compatible; incomplete inquiry source references and callback approval/sent claims fail closed. Ordinary installation remains unconfigured. Private adapter code is `UNLICENSED`; retained upstream/reference notices keep their own licenses.
