# Validation

## Reader safety integration — 2026-10-30

Base: `2810079559b8fea13e6d5c57ab3f3b47ca9af243` (clean core). The four
reader implementation/test files carry the reviewed pin-snapshot and final source
revalidation changes without restoring retired modules or changing Client behavior.

Fresh execution on Node 24.22.1 / npm 11.9.0:

- `npm ci --ignore-scripts`: passed with a dedicated writable temporary cache.
- `npm run check`: all five retained bundles built/checked; 182 plugin/domain
  tests and 4 cleanup regressions passed, zero failures or skips.
- Focused Library/Commerce reader suites: 54 tests passed, zero failures/skips.
- Differential control: the same 54 tests against an isolated clean-core baseline
  with the two original reader implementations returned 19 passed / 35 failed.
  Node counts include parent tests and subtests; this is not 35 distinct defects.
  The fixed candidate passed all 54. No original checkout was reverted.
- `npm run test:client`: all eight retained scripts passed. Existing Library
  React act warnings remain; these are DOM/synthetic service checks, not browser QA.
- `npm run package:business-services`: Commerce and Billing archives built.
- `git diff --check`: passed.

Covered failures include caller pin replacement/reordering during reads, product
archive/revision changes, document archive/review withdrawal/version or certificate
changes, cancellation, authorization revocation and native service replacement.
Latest-source checks are bounded point-in-time observations, not atomic locks
across services. Tests use temporary synthetic records, not real business data.

No host installation, active profile modification, external service/model call,
deployment or CI run is part of these source results. No claim of rc.3 host, live
Shopify/Grok/Muse, browser or production acceptance follows.

### Existing native runtime verification

Four guarded, in-process tests exited successfully on the existing official DSH
`0.2.1-rc.2` runtime:

- Actual Session, ToolRuntime and LocalAttachmentStore: normal reference resolve/
  verify plus archive and slot races, including six reference tool calls.
- Caller pin mutation: attachment body, source metadata and SHA remained consistent.
- Fixed historical attachment bytes: normal read, mismatch refusal and cancellation.
- Product context: normal read, archive/revision refusal and cancellation.

Preload guards prohibited network/server use. These checks used synthetic records,
no credentials or model calls, and no retired modules. Reader implementation
SHA-256 values were unchanged before and after execution:

- `resources.js`: `cd529e6f0ab8570b08abe21094ee95c80d83f2ce07636330c2da68b68de1bb15`
- `references.js`: `f5c1d307c6028c629a6466c4b302e300c370e79b84b58def790c70c6c98f19f2`

The full 182 plugin/domain plus 4 cleanup tests, eight Client scripts and business
package builds were also independently rerun successfully. The `rc.3` runtime was
absent; this is not browser, active-host, live-service or production validation.

## Historical clean-core acceptance

This cleanup starts from commit `843f91f26eb5ce6fad88cc26587635f513a7bae5`.
The old all-module acceptance narrative is preserved in Git, not presented as
acceptance of this reduced tree.

Required local checks: `npm ci --ignore-scripts`, `npm run check`,
`npm run test:client`, `npm run package:business-services`.

Executed on Node 24.22.1 / npm 11.9.0 in an isolated source checkout:

- Clean `npm ci --ignore-scripts`: passed using a writable temporary npm cache.
- `npm run check`: five retained bundles/locales built and checked; 146 retained
  plugin/domain tests plus 4 cleanup regressions passed, zero failures or skips.
- `npm run test:client`: all eight retained Client scripts passed, including AI Work,
  canvas/delivery interactions, business mandates, Billing and business progress.
  Library's existing React act warnings remain; no claim of warning-free browser QA.
- `npm run package:business-services`: Commerce and Billing archives built; package
  file lists and SHA-256 receipts were written under ignored dist/business-services.
- `git diff --check`: passed.

After removing retired RFQ/sample/ERP model labels, edge labels and layout ranks,
the complete check, eight Client scripts and both package builds were rerun and passed.
The cleanup guard also rejects reintroduction of those retired labels/ranks.

The first install/pack attempt encountered an unwritable default npm cache; using
`npm_config_cache=/tmp/dsh-clean-npm-cache` resolved it without permission changes.
Removing ERP exposed an implicit Lucide dependency; root now explicitly pins the
same lucide-react 1.61.0 used by the retained Commerce UI.

No new DSH host, browser, model, external service, deployment or CI run was executed.
No reader-safety patch or runtime migration is included in this cleanup. Local tests use temporary/synthetic
records. They do not establish real Shopify OAuth/API, Grok/Muse connectivity,
current DSH browser/host acceptance, payment processing or production readiness.
