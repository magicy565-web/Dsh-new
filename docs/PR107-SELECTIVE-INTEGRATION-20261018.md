# PR107 Space selective integration candidate

Date: 2026-10-18 UTC. Parent mainline: `a9f6243e970e16a72cbe652d0524479946d95214`. Fixed PR107 source: `4b91b8d8137f6aeb578f88b97c13a8eb6973b2d7`.

## Selected scope

The candidate includes 28 source/test paths plus this note. It does not merge the entire historical PR branch. Twenty-two paths retain the fixed PR107 bytes: ten standalone Space/approved-source implementation files, eight normal Space/catalog test files, and four directly compatible AccessControl/Library/catalog paths. Six paths use minimal additions to the current mainline: the original App's Space attachment points, two approved-reader re-exports, and three PR109 response-policy marker additions.

The mainline's durable model budget, trusted Goal owner propagation, Brain page-read authority, complete document tuple schemas, and PR111 backend selection/cancellation/close lifecycle are retained. PR109's source-hash comparison, version limits, validation, review snapshot and compare-and-swap bodies remain current. Its three additions only expose the existing current-source review policy marker for the read-only source adapter.

The existing standalone product-catalog source receives protocol compatibility corrections: keep review version zero, use the exact GET snapshot's review hash, and import CSV approval requests as ready-for-review rather than granting approval. This does not replace or redeploy the already selected official Medusa Admin UI.

Excluded: historical accept-space script with its fixed branch/PIN, old line-number preservation assertions, old success reports, runtime logs, screenshots and deployment data. No old OMP receipt restoration, migration or PR112 review is included.

## Existing behavior and limits

Space uses the original Store and enterprise identity/access controller. `WORKSPACE_SPACE_ENABLED=1` is an explicit operator startup choice; default is off. The bootstrap adapter prevents Space's private namespace from leaking through the original general bootstrap response, including while Space is disabled.

Library product/document references retain native IDs, revisions and exact Artifact tuples. Medusa references retain native product/source IDs, review version and source hash. They are separate authorities; a checkedAt remote snapshot is not a cross-database atomic lock. The selected code preserves its bounds of 30 total references, eight Medusa references, and 100 reviewed remote catalog candidates.

The default CLI Space enablement does not create a Medusa credential or automatically bind a live Medusa source. An approved source is supplied only through the existing trusted createApp `spaceOptions.medusaSource` composition. Neither page references nor the reader's installation authorize model disclosure or remote product writes.

The normal Space operation-status API is distinct from native-model Session receipt recovery. Its tests use the new Space create/save request IDs, current original writer/access, and `/api/library/spaces/operations/:requestId`; they do not restore an OMP journal or change the prohibited old recovery path.

## Local candidate evidence

The exact selected patch was applied to a fresh isolated copy of the available Git-verified parent source. Existing historical/non-source files omitted from that local source copy are not represented as a complete Git checkout. The shared mainline worktree was not modified while preparing this candidate.

Node `v24.19.0`, original assertions, synthetic data, no SDK substitution or lock change:

```sh
node --test test/space-core.test.mjs \
  test/space-http-loopback.test.mjs \
  test/space-original-store.test.mjs \
  test/medusa-catalog-edit.test.mjs
```

Actual result: 48/48, fail/cancel/skip/todo 0, exit 0, 1185.513367 ms. Log SHA256: `42d0308079bf7bc14f9f10499ed218db8225aa2e185dbcc6a0a102f041596fac`. This combines explicit unit identity/Store fixtures, real loopback HTTP with fixture authorization, one real original Store cold-open case with fixture identity, and catalog protocol checks. It is not original signed-App, browser or live Medusa evidence. Selected changed JS/MJS files also passed `node --check`.

Earlier independent review separately ran eight catalog cases and five limited probes; those results are not added to the 48 count. It confirmed the selective index preserves the current budget/Goal/Brain/backend attachment points. Its original Host-source file did not load because the local locked pi-ai dependency was absent; nine bodies were not executed. Its full Web build stopped at missing assistant-ui dependencies before Vite. These are preserved pending boundaries, not successful acceptance.

## Before release

The exact integrated candidate still needs the original signed-App, Space source Host, DOM/build and official SDK compatibility runs with the pinned dependencies. The separate fixed-305 Web/auth package and the PR111 runtime slice must retain their own identities; their results cannot automatically validate this later candidate. No deployment, credential creation, paid model or real Medusa/PostgreSQL request occurred in this local verification.
