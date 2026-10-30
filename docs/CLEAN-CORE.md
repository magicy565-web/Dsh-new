# Clean core scope — 2026-10-30

Baseline: `843f91f26eb5ce6fad88cc26587635f513a7bae5`.
Cleanup is isolated on a development branch; history and runtime data are preserved.

## Kept

Commerce (AI Work/canvas/mandates/Worker lifecycle), independent Billing, Shopify
Admin, Workspace Library, and optional Workspace Brand. Shared dependencies are
`domain-commerce-network` and `dsh-commerce-contracts`.

Library is required for Commerce product/evidence resolution: `index.js` obtains
`workspaceLibrary`; `resources.js` resolves and verifies the source before access.
Brand is retained because it is an existing working optional skin, not an unfinished
replacement frontend. No separate reader safety patch is folded into this cleanup.

## Removed from source

- Mini ERP, Sourcing, Buyer Magazine, Workspace Memory and Inquiry Recovery plugins.
- Their unused business-memory, product-library and inquiry-recovery domain packages.
- ERP build/pack scripts, ERP screenshots, retired module setup and historical
  all-plugin acceptance instructions. Historical versions remain recoverable in Git.
- Commerce RFQ/quote/sample/ERP projections and inspector, RFQ import UI, `/trade`
  HTTP route, `commerce_trade_read`, missing-service lookups and ERP-dependent
  customer assignment/dispute commands. Their obsolete tests are removed too.
- Default build/test/CI/workspace references to deleted source.

Billing previously imported its fetch helper from the removed TradeInspector.
That authenticated helper is preserved in `src/billing-api.mjs`; Billing's actual
read/write/evidence checks remain. Worker grants, resource fences, business mandates,
service billing and delivery acceptance remain in scope.

No storage migration or destructive runtime operation occurs. Historical fields
remain readable in stored records; removal of a command is not erasure of its
past results. Existing generic graph/domain compatibility data is not synthesized
into new transactions. No real provider identity or integration is inferred.

## Acceptance

Run all commands in DEVELOPMENT.md. Cleanup regression tests check retained bundle
inventory, workspace lock links, relative source imports, Markdown targets and
absence of retired transaction entry points. Test output is local evidence only.
Actual commands/results are summarized in VALIDATION.md after execution.
