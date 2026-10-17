# Brain product supply completeness correction

Base: `a4e87524974386c25e2a53152f0db46754c7e52c` on Draft PR99. The remote head was rechecked before editing. The clean local source snapshot was reconstructed from an existing source archive plus exact-ref GitHub files. All 1,232 nonhistorical source, test, configuration, lockfile and documentation blobs matched the head tree before editing. Historical screenshots, evidence and delivery archives were excluded; this was not a full Git clone.

## Defect and minimal change

The default `createBusinessBrainSourceAdapter` counted missing supply by inspecting only values present on `product.supply`. An empty or partial object could therefore appear complete. It also counted public-reference products as missing enterprise supply, although original Library provenance forbids those products from claiming enterprise supply policies.

The existing optional product source already had the required behavior. Its pure supply predicate is now shared in `server/brain-product-completeness.mjs` and used by both adapters:

- Ordinary products require nonempty strings for packaging, samplePolicy, paymentTerms, shippingTerms and capacityNote.
- Public references do not require enterprise supply. Their other completeness checks remain in place.
- Archived products stay excluded from active completeness counts.

The default source ID, field list, completed-day window, hash-derived revision, observedAt and current-source checks are unchanged. The optional source keeps its original hourly window and sequence revision. No profile, permission, source-selection policy, model tool, receipt, storage schema or external action is changed. The complete optional adapter was not substituted for the default adapter.

## Reproduction and results

Node 24.19.0, synthetic in-memory products and Store facades only. No model or business-service calls.

Before the production correction, the three new regression groups returned **1 pass, 2 failures, 0 skips**. The failures demonstrated the default adapter's empty enterprise supply and public-reference classification errors. After the correction, the six focused files below returned **24 passes, 0 failures, 0 skips**:

```sh
env -i PATH="$PATH" HOME=/tmp NO_COLOR=1 node --test \
  test/business-brain-product-completeness.test.mjs \
  test/business-brain-observations.test.mjs \
  test/goal-brain-product-source.test.mjs \
  test/business-brain-pulse.test.mjs \
  test/business-signals.test.mjs \
  test/decision-planner.test.mjs
```

The new groups cover missing/null/empty/partial/blank enterprise supply; a public reference with and without its document; complete enterprise supply, archived exclusion, workspace mismatch, stable same-day references, and refusal of a changed product observation.

Syntax checks passed for all four changed/new JavaScript source and test files. `npm run plugins:pack-check` passed all 14 packages, with zero business tools or model requests. `npm run build:omp` was attempted but stopped with ENOENT because this clean snapshot has no installed fixed Bun binary at `support/omp-bun-linux-x64/node_modules/@oven/bun-linux-x64-baseline/bin/bun`. No runtime was installed or substituted. Native OMP compilation, full backend/browser suites and real-service integration are therefore not claimed.

Local log SHA-256 values, without committing the logs or runtime data:

- Original three-group counterexample: `f1a8a99cd33c2f7b59d0aa08d7defe1d13ea13f557c582aa4dadf766364e7fc9`
- Final 24-test regression: `1f09a9a990850c658d1596d71610bbb829cf013351ee3dc37eb2515a39310099`
- Static package closure: `0733dce885174b81fa2c0f72469e44452ecd91c56d3952b2ab2bd5c519bc5e20`
- Blocked native build: `03dbba427e4007eabb1db7a0051e20f15f88c98f842f35191687019806d98b61`

No server deployment, main modification, model spending, credential operation, permission expansion or enterprise runtime-data upload was performed. This change fixes one product-derived Brain signal; it does not complete the enterprise-document/structured-memory-to-Brain integration.
