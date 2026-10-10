# Personal Muse REST ingress — controlled deployment plan

This guide is for a **single-tenant persistent Node 24 Workspace server**; it does not provision a VM, domain, credential, Vault connector or vendor spending cap. **Current status: not deployed.** This source feature remains in Draft PR #15 until source tests, identity, HTTPS and live acceptance are independently verified.

## Public network boundary

- Keep the Workspace backend listening on `127.0.0.1:8787`. Never bind the app directly to a public interface.
- Production Node requires `NODE_ENV=production`, `WORKSPACE_ACCESS_MODE=enterprise` and the pre-existing **reviewed signed employee ingress** defined in [DEPLOYMENT.md](DEPLOYMENT.md). Do not publish the default local mode or replace signed employee auth with an `X-User` header.
- Use a **separate** HTTPS virtual host solely for personal Muse REST calls. The example [Muse-scoped Caddyfile](../deploy/muse-worker.Caddyfile.example) serves only `/api/muse-worker/v1/*` and responds 404 for everything else. It deliberately does not expose the Dot MCP route, `/api/worker-orders`, artifacts, employee sessions, or the enterprise dashboard.
- Configure a real domain you administer and verify DNS/TLS certificates; a Cloudflare tunnel or proxy, if used, needs equivalent origin/path policies. Do not use a placeholder, IP or localhost in Muse's egress allowlist.

## Auth and safe first handshake

1. Review the PR and run Node 24 `npm ci && npm run build && npm test && npm run test:browser` on an authorized build machine. The GitHub Actions `BuildFailed/startup_failure` is a separate pre-job blocker tracked by [issue #16](https://github.com/magicy565-web/workspace-agent/issues/16). Do not count unavailable CI as a pass.
2. On the production host, generate a unique **32–256 character URL-safe** API token via an audited secret manager; keep the plaintext only in Muse's secure credential flow. Store only the lowercase SHA-256 digest as `WORKSPACE_MUSE_BRIDGE_TOKEN_SHA256` in the host's private configuration. Do not reuse the Dot credential, expose tokens in HTML, store in Git or paste into chat.
3. Set `WORKSPACE_MUSE_WORKER_ID` to the assigned enrolled worker, and keep `WORKSPACE_MUSE_ENABLED=0`, `WORKSPACE_MUSE_SCOPE_REVIEWED=0`, `WORKSPACE_MUSE_EXTERNAL_BUDGET_VERIFIED=0`. Mere token authentication must not create a paid task.
4. Start/restart the Node service under the existing dedicated systemd service account (see [workspace.service.example](../deploy/workspace.service.example)); check private `GET /api/health` only from an authorized loopback/admin ingress, not the Muse hostname.
5. Once HTTPS is live, an authorized operator may run the **GET-only probe** `node scripts/check-muse-readonly-connection.mjs` with these three values securely injected into its process environment: `WORKSPACE_MUSE_PROBE_URL=https://VERIFIED_HOST/api/muse-worker/v1`, `WORKSPACE_MUSE_PROBE_TOKEN`, `WORKSPACE_MUSE_PROBE_WORKER_ID`. The script never prints the credential or any task body. It fails closed for redirected hosts, HTTP, untrusted IDs or unexpectedly approved/queued work.
6. In the actual personal Muse session, complete the secure API-key access card (no credentials in chat) and call only `identity`, then `inbox`. Do not assume scheduled Muse work or remote wakeup is available; a successful GET proves only authenticated REST access.
7. **Do not enable work orders** without recorded independent evidence of the personal Muse owner's authorization, allowed public-only data, external provider-side enforceable maximum spend, and a demonstrated cancellation path. A Workspace Credits checkbox is not a vendor-level spending limit.
8. When the execution gates are verified, approve one limited public research order in the Workspace admin UI, dispatch it, and check a real Muse `claim → status → heartbeat → upload → submit` sequence, preserving `attemptId`, `fence`, `requestId`, sources and honest evidence limitations. Review server audit and artifacts; acceptance remains an explicit admin action.

## Host checks and rollback

- Probe success must show `connection:"authenticated-read-only"`, the exact workerId, `approved:false`, `inboxCount:0`, `liveExecutionVerified:false`.
- Verify external Muse hostname returns **404** for `/mcp`, `/api/worker-orders`, `/api/artifacts`, `/`, `/api/health` and `/api/dot-worker/v1/identity`. Only the Muse REST prefix is routable.
- Confirm an absent/bad Muse Bearer returns 401; the Dot Bearer cannot access the Muse endpoints. No passwords, tokens, prospect data or private RFQ bytes in logs.
- To stop new work: disable Muse enrollment in private server configuration and restart the service; only the real personal Muse owner can confirm that an already-running external agent stopped. Cancellation status remains `cancel_requested` until worker acknowledgment. Do not kill/replay tasks merely because the local host restarted.
- Backups/recovery: use [RECOVERY.md](RECOVERY.md). The new restore path explicitly blocks unfinished Dot/Muse tasks and invalidates old fences; production must validate restored artifacts and operator approval separately.
