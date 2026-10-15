# Fifth-route source-bound offline evidence · 2026-10-15

Baseline PR68 `d82d35fd7213012ff6b0e5f2f24d765aba021a9e`; branch `codex/agent-factory-library-20261015`. [source-evidence.json](source-evidence.json) hashes the new package, adapter, native reader, test code and reused unchanged original boundaries. No production runtime data, credentials, actual enterprise uploads or third-party model outputs are included.

| Exact command | Result | Evidence |
| --- | --- | --- |
| `node --test test/factory-library-ingestion.test.mjs` | 12 pass, 0 fail, 0 skip | [service-tests.txt](service-tests.txt) |
| `FACTORY_INGESTION_PACKAGE_FACTS=/tmp/factory-ingestion-package-facts.json node --test test/factory-ingestion-package.test.mjs` | 4 pass, 0 fail, 0 skip | [package-tests.txt](package-tests.txt), [package-facts.json](package-facts.json) |
| `node --test test/artifacts.test.mjs test/store.test.mjs test/factory-materials-read.test.mjs` | 37 pass, 0 fail, 0 skip | [original-services.txt](original-services.txt) |
| `node --test test/library-api.test.mjs test/library-recovery.test.mjs test/library-containment.test.mjs` | 21 pass, 0 fail, 0 skip | [library-regression.txt](library-regression.txt) |
| `npm run typecheck` | pass | [typecheck.txt](typecheck.txt) |

These suites are separate; none of these numbers is a claim that full application regression or real-model acceptance passed. Source dependency installation used the repository's fixed lockfiles, ignore-scripts and disposable npm caches. Official Bun 1.3.14 was verified with the existing setup script. Genuine official Pi 1.1.0 and OMP 18.10.4 loaders exercised copied-package install, Skill loading, disable/re-enable/remove, unchanged native tools and another plugin. The OMP SDK fixture uses a finite keyless script (5 scripted responses, 4 tool calls) with actual original local Store/artifacts/Library and native ReadTool, then saves and queries one **synthetic** product. It makes zero external HTTP/model requests and zero paid model calls. Fixture Session authority is synthetic. Do not describe that trace as genuine model understanding or real enterprise authorization.

Real native text/PDF/image reading is verified separately with synthetic local source bytes; no OCR/vision model was called and image-only product observations remain unverified report entries. All sources and saved metadata stay in the original private artifact/Library services. No new store/schema/agent loop, shared plugin edits, worker/bridge/session edits, main changes, merge, deployment, Shopify publication or credential changes were made.

The shared live Session/upload-consent seam and production profile wiring are deliberately unimplemented in this independent branch. [Host wiring specification](../../FACTORY-LIBRARY-INGESTION-HOST-WIRING.md) identifies exact files, reasons, authority requirements and post-integration acceptance. Real model configuration/current pricing/cumulative CNY5 remaining allowance/hard cap, actual enterprise extraction quality, real human confirmation and external certificate authenticity remain unaccepted. Full browser/application/deployment acceptance was not run.
