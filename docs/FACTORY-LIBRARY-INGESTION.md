# Factory Library and Products ingestion delivery

Branch `codex/agent-factory-library-20261015`, based exactly on PR68 `d82d35fd7213012ff6b0e5f2f24d765aba021a9e`. This fifth development route adds the installable `@workspace-agent/pi-factory-ingestion` package with its own Skill, an original Library/Products/company adapter, fixed native local source reader, independent tests and integration instructions. No existing plugin, worker, bridge, session, store schema or shared service was changed. No subagent was started.

The model can inspect authorized uploads, recognize several source-backed products and enterprise observations, save original Library/Products/Profile records and query the actual saved batch. Tool order and substantive extraction belong to the official OMP model loop and Skill; the adapter contains no agent loop or business stage machine. Raw uploads, extraction limits, original versions/SHA, quote offsets, missing information, conflicts and unverified observations remain inspectable. Catalog fields stay private drafts. Existing populated fields are protected; automatic updates fill blanks and append original source versions. Original administrator document reviews remain separate from external certification and do not become a model-confirmation flag.

Read [package installation, API and limits](../packages/workspace-factory-ingestion/README.md). The [precise shared-host wiring specification](FACTORY-LIBRARY-INGESTION-HOST-WIRING.md) is explicitly **not applied**, to avoid collision with the other development routes. Ordinary package installation is unconfigured; the live frontend upload→Agent→save path is still an integration gate. The independent official SDK acceptance does execute original native read→original product save→original query with disposable synthetic data, a finite keyless model script and synthetic authority. It is not real-model acceptance or real-enterprise authorization.

## Commands

From the repository root after the fixed dependencies are installed:

```sh
# Reproducible independent plugin/service acceptance; no credentials/model billing
node --test test/factory-library-ingestion.test.mjs test/factory-ingestion-package.test.mjs

# Original service compatibility checks
node --test test/artifacts.test.mjs test/store.test.mjs test/factory-materials-read.test.mjs
node --test test/library-api.test.mjs test/library-recovery.test.mjs test/library-containment.test.mjs
npm run typecheck
```

The normal application source startup remains `npm run workspace -- --serve`. This branch does **not** add a selectable ingestion profile to that shared launcher. For this branch's install/start/dispatch acceptance, `node --test test/factory-ingestion-package.test.mjs` starts isolated official Pi/OMP CLI/SDK processes with the package and tests save/query against disposable original services. Once unified host wiring is accepted, the existing launcher must opt into a distinct reviewed private ingestion profile; do not invent that selector before integration.

## Evidence and remaining acceptance

Source checksums, exact test commands/results and official package facts are in [validation/factory-library-ingestion-20261015](validation/factory-library-ingestion-20261015/README.md). Service tests cover multiple files/products, original company updates, exact byte/SKU deduplication, protected-field conflicts, original source version and review retention, explicit unknowns, parser failure, image-only observations, source forgery, field masks/private-price exclusion, model/recipient/file/target refusal, expiry/revocation/cached drift, modified/forged journals, cross-conversation denial, and cancellation/restart after a product has already committed. Genuine native ReadTool tests use local synthetic text, PDF and PNG without a model. Official package tests cover copied-package install, disable/re-enable/remove, native tools/other-plugin coexistence, unconfigured defaults, and actual official OMP dispatch to original services with a finite script.

Not accepted: shared original live Library Session/upload consent seam and full frontend integration; real enterprise uploads and multi-product extraction quality; real model intelligent choices; actual vision/OCR completeness; external certificate authenticity; subsequent human field confirmation UX; safe live model configuration/current prices/cumulative CNY5 remaining allowance/provider hard cap; full application/browser/deployment regression. Image-only observations deliberately remain report-only pending review. Source quote matching verifies provenance, not semantic truth. Multi-record writes are resumable, not atomic; cancellation does not roll back completed original writes.

This delivery made no paid model calls, private external transfers, external contacts, Shopify publication, credential creation/permission enlargement, deployment, main edits, force push or merge. Future Shopify publishing remains separately authorized and uses the existing original connection; no old PR connector or replacement commerce stack was introduced.
