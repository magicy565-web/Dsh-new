# Validation

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
