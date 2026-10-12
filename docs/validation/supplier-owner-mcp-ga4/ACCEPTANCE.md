# Supplier owner MCP / GA4 synthetic acceptance

Baseline: `8ce17ef22190a878f520bad1871029748f211513`, including PR54.
Branch: `codex/supplier-owner-mcp-ga4`. Draft PR: [57](https://github.com/magicy565-web/workspace-agent/pull/57).
Contract checkpoint `00c0920f0d1b387a3ba9571aba74ddec4868f548` was pushed and its remote SHA verified.
Implementation checkpoint `4fc6b9677978d5a2cb4b1c0f142203d61cdff46a` was also pushed and verified with `git ls-remote`. Acceptance-only commits through `fb7651050ac7bc1a1fd9d1a13d89f2dfc3bec29b` retained its production hashes. The subsequently authorized original-owner-session adapter is fixed at `8af564f15fcb821cde1054984356d2e3f3c75c0c`, pushed and remote-SHA verified. PR56 comment `6130929559` delivers that exact source and two-line incremental `index.mjs` wiring.

## Current session adapter acceptance

`POST /api/conversations/:cid/supplier-session-mcp` carries the same original owner HTTP decision through existing signed ingress, live session (cookie or original `X-Workspace-Session`), Origin/CSRF, exact method/target/body signature and recursive privacy checks. Shared dispatch invokes original owner/service methods and their original manual approvals. No grant, credential, identity, session store, listener or worker privilege is added. The external `/supplier-mcp` still requires its original resolver and never falls back; leased-worker tools remain two supplier reads. Catalog `ownerSessionMcp` reports route availability/session requirement separately from external `ownerMcp` configuration.

- New actual HTTP session-MCP scenarios: **6/6 passed** (`session-tests.txt`). Covers initialize/list/call/discover, both original session transports, wrong workspace/method/path/body/signature/CSRF, missing session, worker credentials, foreign conversation/service, body privacy, same original HTTP service and Store persistence, manual publication approval and disabled monitoring, original request expiry before image commit, local-mode refusal and external-resolver denial without fallback.
- Current directed 16-file suite: **156/156 passed**, zero failed/skipped (`session-targeted-tests.txt`). Includes original worker transport, access, supplier publication/service/monitoring, external owner MCP and GA4 scenarios.
- Current full `npm test`: **696 passed, 0 failed, 7 existing skipped** of 703 (`session-backend-tests.txt`). Same six native-source/runtime and one Windows conditional skips. Directed/new tests overlap this total.
- Syntax and `git diff --check` passed. Earlier frontend/mini builds remain recorded; this increment changes no frontend/client/package files and was not deployed.

TUI coordination was posted before implementation to PR57 comment `6130810874`: reuse the same original signed host and session transport, no new proxy/identity. This environment has no cross-thread send tool; no acknowledgement from the separate TUI thread was available at this checkpoint. The original session-header transport itself is exercised in the passing synthetic test. No real TUI/host connection is claimed.

## Changes and boundaries

- The original signed enterprise Workspace ingress/session/CSRF/body checks admit the external owner MCP route. Every external-connector call requires the original host's fresh exact owner grant; mutations bind input hash and expiry. The separate session facet is described above. Local no-login mode, worker credentials, foreign owner/workspace/conversation and invalid authority are refused.
- Fifteen closed tools reuse original supplier, artifact, business-library, publication and monitoring methods. No approval-decision, schedule-activation or notification/subscription tool is exposed. Original request/revision/scope fences and partial/uncertain recovery remain authoritative.
- GA4 metadata loads on the ordinary `createApp`/CLI path from a private existing configuration file. Snapshot authorization is read only on sample invocation through the original adapter. No credential creation, refresh, account permission expansion or new persistent access exists.
- Catalog distinguishes implemented support, configuration and actual observation. Unknown public images remain unusable. Publication-time monitoring requires original `shopify-observation`, not a request/write receipt.
- No Pi TUI, readiness, Shopify identity, client, package manifest or lockfile changes. `server/index.mjs` contains only imports, optional binding/configuration wiring, catalog callbacks and route delegation.

## Executed checks

Node `v24.19.0`. `npm ci --ignore-scripts --no-audit --no-fund --cache /tmp/workspace-supplier-npm-cache` completed. The initial default-cache install failed because `/home/agent/.npm/_cacache` was unavailable; no approval or registry restriction was bypassed and the lockfile was unchanged.

- `npm run build`: passed (original bundle-size warning retained in `build.txt`).
- `npm run build:mini`: passed (`mini-build.txt`); no upload/deployment.
- Directed original/new backend tests: **132/132 passed**, zero failed/skipped (`targeted-tests.txt`). The 8 new owner HTTP scenarios and 29 new/original GA4 scenarios are subsets of this total, not additional counts.
- Complete `npm test`: **672 passed, 0 failed, 7 skipped** out of 679 (`backend-tests.txt`). The existing conditional skips require unavailable native runtime/source exports (six) or Windows storage (one); they are not acceptance passes. Directed tests overlap this suite.
- Additional owner/ordinary-CLI verification: **10/10 passed** (`owner-and-cli-tests.txt`), consisting of the eight owner scenarios rerun with explicit worker-tools isolation assertions and two new actual child-process CLI checks. The child inherits no environment, uses synthetic metadata and an absent authorization snapshot, confirms `configured_unverified`/`binding_required`/model `setup_required`, and rejects malformed metadata before listening. Production implementation is unchanged from `4fc6b96`.
- Follow-up existing-host audit regression: **11/11 passed** (`host-resolver-tests.txt`), rerunning owner/ordinary-CLI scenarios plus the actual original native-session identity resolver denial. A live synthetic administrator identity/session cannot become a supplier mutation grant. These tests overlap the prior verification; production implementation remains unchanged.
- Final resilience/nullability combination: **68/68 passed**, zero failed/skipped (`resilience-tests.txt`). Includes the 12 owner MCP scenarios and original/new GA4/configuration/startup/monitoring cases. The actual client times out after image bytes commit; reconnect/reload reuses the same artifact and rejects changed input. Concurrent profile calls yield one revision; original publication review/execute/reconcile, observation and monitor create/check/stop receipts survive reload. Expired image scope is denied before commit. GA4 missing/invalid/restricted values and incomplete pagination stay null; original persisted check/summary/reload values remain `[0,null,null,null,null,null,null,7,0]`, with no source calls on receipt replay. These checks overlap previous suites, and production source remains unchanged.
- `git diff --check`: passed.

Directed command:

```sh
node --test test/supplier-owner-mcp.http.test.mjs test/supplier-service.http.test.mjs test/supplier-publication.http.test.mjs test/supplier-publication.test.mjs test/supplier-monitoring.test.mjs test/supplier-muse-mcp.test.mjs test/supplier-profile.test.mjs test/product-traffic-ga4.test.mjs test/product-traffic-config.test.mjs test/dot-mcp.test.mjs test/dot-mcp-contract.test.mjs test/access.test.mjs test/access-startup.test.mjs
```

Before the original frontend build, the first directed run was 130/132: two original access tests expected the built static shell and received 404. Building the source resolved that prerequisite; the final full directed rerun above passed without changing those assertions.

Owner tests use real local HTTP `initialize`, `notifications/initialized`, `tools/list`, `tools/call` and existing modern discovery. They cover original ingress/session/body/CSRF denial, exact scope/expiry/revocation, cross-owner and cross-workspace isolation, private image/facts/consumer-sale-unit preview persistence, public URL unknown state, private product response-loss recovery, original publication approval consumption, actual observed publication-time origin, disabled monitoring, and partial Shopify reconciliation without retry after reload. Shopify responses originate only from the original loopback fixture. Model invocation is forbidden by the fixture.

Logs retain command output with terminal escape codes/trailing whitespace removed; no runtime Store, private image data directory or real authorization is included.
`SOURCE.json` binds current implementation source bytes to `8af564f` and records test-file hashes, retaining prior checkpoint metadata. The earlier worker-route probe initially used browser headers from the owner fixture and correctly hit `DOT_BROWSER_FORBIDDEN`; the fixture sends the original worker server-to-server request without Origin. No authentication implementation or expectation of worker rejection was weakened.

GA4 tests use disposable metadata/snapshot files and synthetic responses. They cover private-path/schema/size/mode validation, missing configuration/provider/authorization, revocation/expiry, exact workspace/shop/property identity, producer rotation, startup wiring and overrides, original Store reload, partial failure and catalog accuracy. No real secret was read, copied, generated or injected.

## Remaining gates

The baseline has no existing external owner `readReviewedScope` implementation callable by the CLI. The external connector host must supply its original grant resolver; without it `/supplier-mcp` returns `SUPPLIER_OWNER_BINDING_REQUIRED`. This remains an external-plugin integration gap. The separately authorized original-session protocol adapter above needs no such grant and does not manufacture one. No substitute grants or worker-token promotion were introduced.

The follow-up [source audit](../../SUPPLIER-OWNER-HOST-AUDIT.md) traces original Workspace identity, Pi/Muse bindings, historical native host and OAuth modules. The visible sources have identity and narrow worker/connector/publication scopes, but no supplier owner grant producer; this is an authorization integration implementation gap, not only a missing runtime variable. It records the minimum nonsecret external-resolver handoff or separate authorization decision needed. PR57 comment `6130647802` coordinates this boundary with the Pi TUI/integration tasks; this environment exposes no cross-thread message tool.

The restricted feasibility check distinguished the external-connector gap from the already-authorized direct owner HTTP path, as recorded in PR57 comment `6130714508`. Only after the subsequent explicit instruction was the minimal session protocol adapter implemented at `8af564f`; it reuses that exact HTTP decision and does not alter roles, original scopes or approval mechanisms.

Real owner/Muse host integration, existing Shopify/GA4 authorization, live source observation and deployment remain unverified. Seven-day future notification consent and durable recipient permissions await the user's approval and were not developed. Existing manual approvals remain. These synthetic tests establish neither production readiness nor independent security review, real publication/notification, real-device acceptance or a completed seven-day observation window.

GitHub Actions for implementation `4fc6b96` reported `startup_failure` (runs [38293155118](https://github.com/magicy565-web/workspace-agent/actions/runs/38293155118) and [38293072878](https://github.com/magicy565-web/workspace-agent/actions/runs/38293072878)); the queried latest run had zero jobs. This is not passing hosted CI. No run was retried, alternate entry used, or paid quota action performed; the precise platform cause was not returned by the connector.

The current session implementation `8af564f` also reports `startup_failure` in run [38296263848](https://github.com/magicy565-web/workspace-agent/actions/runs/38296263848). The queried run has zero jobs. It is not passing hosted CI; no rerun or alternate execution entry was attempted.
