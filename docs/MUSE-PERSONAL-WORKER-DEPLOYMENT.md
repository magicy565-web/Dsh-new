# Personal Muse REST ingress — controlled deployment plan

This guide is for a **single-tenant persistent Node 24 Workspace server**; it does not provision a VM, domain, credential, Vault connector or vendor spending cap. **Current status: not deployed.** This source feature remains in Draft PR #15 until source tests, identity, HTTPS and live acceptance are independently verified.

## Attach to an existing host

Use [the shared-services host factory](../server/muse-worker-host.mjs) when the
existing host already owns storage, artifacts and the HTTP listener. Pass that
host's actual `store` (`read`/serialized `update`) and artifact service
(`create`/`download`), private Muse configuration and bounded Node HTTP helpers.
The factory creates no store, artifact directory, listener, scheduler or model
runtime. It returns `workerId`, `bridge`, `adapter`, `handle` and `close`.

```js
const muse = createMuseWorkerHost({
  store, artifacts, config: museWorkerConfig,
  workerAdapters, dotWorkerConfig, readBody, respond,
});
// Register before the existing WorkerDesk is constructed; do not create a
// second desk or writer just to add the Muse route.
const adapters = { ...workerAdapters, [muse.workerId]: muse.adapter };
// In the existing Node HTTP request callback, before employee auth:
if (await muse.handle(req, res, pathname)) return;
// Existing employee/OAuth/MCP routes continue here.
// On host disposal, before parent artifacts/storage are closed:
await muse.close();
```

`handle` returns false for unrelated paths. The existing host must handle
errors (including `MuseWorkerError`) with its safe JSON error and audit policy.
A separate Muse HTTPS ingress must still deny unrelated paths: returning false
is **not** an external hostname access policy. The factory rejects duplicate
Worker IDs and the Dot token digest. Execution stays disabled until all three
explicit enrollment/budget/scope flags are true.

Closing immediately disables adapter readiness and new HTTP/adapter operations,
then drains operations already admitted. It does not close parent services,
cancel external execution, clear leases or submit another attempt. A host must
withdraw its route/adapter before allowing a replacement mount; it must not
mount two gateways for the same Worker concurrently (rate limits are per mount).

This seam is integrated into the standalone `createApp()` in this branch.
**It is not yet a production Cordis binding.** The older native plugin branch
uses `personalWorkers` and actor-bound services, while this PR uses WorkerDesk
orders plus `museTasks`. Sharing a directory alone cannot reconcile those
contracts. Inspect the deployed business services, native authority and host
lifecycle before mounting this factory; do not replace actor guards with a raw
store handle or start a second Workspace process.

Local Node 24.21.0 host/contract/probe checks: 18 passed. The seven new host tests
use real HTTP, bridge and WorkerDesk code with explicitly in-memory parent
services. They do not prove disk durability, Cordis compatibility or live Muse
execution. On the Windows development host, the existing disk-backed HTTP and
restore tests fail at directory `fsync` (`EPERM`); keep the storage checks intact
and rerun them on the supported Linux deployment/build host.

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
