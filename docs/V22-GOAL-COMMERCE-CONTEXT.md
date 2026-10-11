# V22 continuation: goal conversation and product hosting

This increment continues the Muse goal-first UI and business libraries from the
V22 follow-on branch at `5974f07ab69f47cb03295d81a887404200083116` (PR #17).
It does not apply the separate seven-page design mockup.

## User-facing behavior

Opening a hosted product's research goal now retains its business context inside
the existing goal conversation. “托管与渠道” expands a compact section with:

- The product name and revision fixed when hosting was confirmed, public summary,
  market, objective, business budget currency, duration and validation target.
- The actual linked WorkerDesk research order, its state, Credits ceiling,
  deadline, and delivered evidence counts when present.
- Actual saved order-evidence freshness/completeness and currency-separated net
  receipts. Unread evidence is never represented as zero sales. Research
  acceptance is never represented as a sale or billable revenue.
- Direct links to the exact hosting project and research order.

The section is collapsed by default so the single conversation remains central.
The original navigation, company/product libraries, runtime, approvals and
dispatch remain intact. The narrow goal layout now fits 320px instead of
inheriting the old global 360px minimum.

## Read contract

`GET /api/goals/:goalId/commerce-context` runs after the existing access gate.
It returns `{ goalId, projects }`, selecting only projects whose saved
`researchGoalId` equals the requested goal. Similar titles or products do not
create relationships. A missing goal returns `404 GOAL_NOT_FOUND`; a valid
unlinked goal returns an empty list.

The response uses an explicit field allowlist. Request fingerprints, staging
intents, order sync bookkeeping and current private product descriptions are not
included. No external request, write, execution or approval occurs during read.

The React view follows workspace revisions and offers manual refresh. Switching
goals remounts the view; obsolete asynchronous responses are ignored by the
existing `useRead` lifecycle. Failure, loading and unlinked states are distinct.

## Reproduce checks

On a supported filesystem with Node 24+:

```sh
npm ci
npm run build
npm run test:goal-context
npm run test:goal-context:browser
```

Use `CHROMIUM_PATH` for an installed Chromium browser and
`GOAL_CONTEXT_QA_OUTPUT` for browser evidence output if needed.

This local Windows host rejects directory `fsync` in the unchanged baseline
store. The original commerce suite reached **1 pass / 11 failures** before
business setup completed; those failures are not application regressions proven
by this increment and are not counted as passing tests. No production storage
guarantee was weakened.

For functional QA on this host, the following explicitly substitutes test memory
storage and an inert artifact service, while retaining real app HTTP handlers,
runtime/business services and the production React bundle:

```sh
node --experimental-test-module-mocks --import ./test/fixtures/goal-commerce-memory-preload.mjs --test test/goal-commerce.http.test.mjs
node --experimental-test-module-mocks --import ./test/fixtures/goal-commerce-memory-preload.mjs test/goal-commerce.browser.mjs
```

The preload lives only under tests, is never imported by the application, reports
`test-memory-only` durability, and rejects artifact writes. It does not validate
disk persistence, recovery, enterprise SSO or production runtime connectivity.

The final verification record is included with this delivery. No paid model,
external Worker dispatch, live Shopify operation, merge or production deployment
was performed. The optional complete private native Harness source is not part
of the GitHub repository snapshot.
