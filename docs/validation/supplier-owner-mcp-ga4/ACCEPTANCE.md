# Supplier owner MCP / GA4 synthetic acceptance

Baseline: `8ce17ef22190a878f520bad1871029748f211513`, including PR54.
Branch: `codex/supplier-owner-mcp-ga4`. Draft PR: [57](https://github.com/magicy565-web/workspace-agent/pull/57).
Contract checkpoint `00c0920f0d1b387a3ba9571aba74ddec4868f548` was pushed and its remote SHA verified.

## Changes and boundaries

- The original signed enterprise Workspace ingress/session/CSRF/body checks admit an optional owner MCP route. Every tool call requires the original host's fresh exact owner grant; mutations bind input hash and expiry. Local no-login mode, worker credentials, foreign owner/workspace/conversation, expired/revoked grants and unreviewed input are refused.
- Fifteen closed tools reuse original supplier, artifact, business-library, publication and monitoring methods. No approval-decision, schedule-activation or notification/subscription tool is exposed. Original request/revision/scope fences and partial/uncertain recovery remain authoritative.
- GA4 metadata loads on the ordinary `createApp`/CLI path from a private existing configuration file. Snapshot authorization is read only on sample invocation through the original adapter. No credential creation, refresh, account permission expansion or new persistent access exists.
- Catalog distinguishes implemented support, configuration and actual observation. Unknown public images remain unusable. Publication-time monitoring requires original `shopify-observation`, not a request/write receipt.
- No Pi TUI, readiness, Shopify identity, client, package manifest or lockfile changes. `server/index.mjs` contains only imports, optional binding/configuration wiring, catalog callbacks and route delegation.

## Executed checks

Node `v24.19.0`. `npm ci --ignore-scripts --no-audit --no-fund --cache /tmp/workspace-supplier-npm-cache` completed. The initial default-cache install failed because `/home/agent/.npm/_cacache` was unavailable; no approval or registry restriction was bypassed and the lockfile was unchanged.

- `npm run build`: passed (original bundle-size warning retained in `build.txt`).
- `npm run build:mini`: passed (`mini-build.txt`); no upload/deployment.
- Directed original/new backend tests: **132/132 passed**, zero failed/skipped (`targeted-tests.txt`). The 8 new owner HTTP scenarios and 29 new/original GA4 scenarios are subsets of this total, not additional counts.
- `git diff --check`: passed.

Directed command:

```sh
node --test test/supplier-owner-mcp.http.test.mjs test/supplier-service.http.test.mjs test/supplier-publication.http.test.mjs test/supplier-publication.test.mjs test/supplier-monitoring.test.mjs test/supplier-muse-mcp.test.mjs test/supplier-profile.test.mjs test/product-traffic-ga4.test.mjs test/product-traffic-config.test.mjs test/dot-mcp.test.mjs test/dot-mcp-contract.test.mjs test/access.test.mjs test/access-startup.test.mjs
```

Before the original frontend build, the first directed run was 130/132: two original access tests expected the built static shell and received 404. Building the source resolved that prerequisite; the final full directed rerun above passed without changing those assertions.

Owner tests use real local HTTP `initialize`, `notifications/initialized`, `tools/list`, `tools/call` and existing modern discovery. They cover original ingress/session/body/CSRF denial, exact scope/expiry/revocation, cross-owner and cross-workspace isolation, private image/facts/consumer-sale-unit preview persistence, public URL unknown state, private product response-loss recovery, original publication approval consumption, actual observed publication-time origin, disabled monitoring, and partial Shopify reconciliation without retry after reload. Shopify responses originate only from the original loopback fixture. Model invocation is forbidden by the fixture.

GA4 tests use disposable metadata/snapshot files and synthetic responses. They cover private-path/schema/size/mode validation, missing configuration/provider/authorization, revocation/expiry, exact workspace/shop/property identity, producer rotation, startup wiring and overrides, original Store reload, partial failure and catalog accuracy. No real secret was read, copied, generated or injected.

## Remaining gates

The baseline has no existing owner `readReviewedScope` implementation callable by the CLI. The real authorized host must supply its original grant resolver; without it the endpoint returns `SUPPLIER_OWNER_BINDING_REQUIRED`. This is an explicit integration gap, not an installed/connected owner plugin. No substitute grants or worker-token promotion were introduced.

Real owner/Muse host integration, existing Shopify/GA4 authorization, live source observation and deployment remain unverified. Seven-day future notification consent and durable recipient permissions await the user's approval and were not developed. Existing manual approvals remain. These synthetic tests establish neither production readiness nor independent security review, real publication/notification, real-device acceptance or a completed seven-day observation window.
