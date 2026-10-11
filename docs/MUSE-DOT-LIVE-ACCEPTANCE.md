# Production Muse / Dot connection acceptance (read-only preparation)

**This overlay does NOT change the production host.** The earlier recovery checkpoint (2026-10-11) identified an original Singapore Huawei ECS and the existing ChatGPT dot MCP endpoint `https://dot.cnsubscribe.xyz/mcp/dot`, with separate auth server `auth.cnsubscribe.xyz` and workspace `workspace.cnsubscribe.xyz`. These are historical configuration facts, **not** confirmed online state at the time of this local development.

## Evidence recorded in this development conversation

- The connected Workspace — xy `workspace_worker_identity({})` tool returned an **internal tool failure**. Earlier conversation errors included OAuth token refresh failures. Neither result proves the client has a valid authenticated, claimable connection.
- Read-only unauthenticated attempts to fetch the production domains through available tools did not yield a usable health observation.
- Existing V22 source contains a Dot MCP bridge and an independent Muse REST Worker bridge, with offline tests. Their presence does not prove a valid production callback subscription, live cloud Executor, lease, or uploaded original artifact.
- No live Muse task was claimed, no refresh token was reset, no OAuth consent was requested, no original session/Goal or task ID was recreated, and no production work order was submitted from this local overlay.

## Single-writer production restoration sequence

1. On the **original** authorized Huawei ECS, confirm account instance state, IP and ingress version; back up original state and inspect existing tasks/leases before any service restart. Do not deploy this pilot branch yet.
2. Check Nginx/HTTPS routes, the actual Dot `/mcp/dot` and OAuth protected-resource metadata, the original backend and IdP processes, local readiness and safe logs without printing bearer credentials.
3. Verify existing Dot OAuth grant expiry, refresh token rotation, issuer/audience/scope and **current** connection epoch. Preserve authorization unless the host proves re-consent is necessary; do not hard-code old epochs.
4. Verify `workspace_worker_identity` then `workspace_worker_inbox` using the already installed Workspace — xy connector. Successful identity/inbox alone is *not* successful task execution or online attestation. Check current Events subscriptions and callback delivery separately.
5. Muse: use its existing independent credential and `/api/muse-worker/v1` identity/inbox only. Compare expected owner and Worker identity, current reviewed scopes, budget gates and native Harness registration. Never use Dot credentials for Muse.
6. For an authorized public research order only, verify exact approval → queue → claim/attempt/fence/lease → heartbeat → original file upload/hash/evidence → result → session delivery → human acceptance. Preserve original requestId and approved payload on retry; never invent a replacement Task/Goal.
7. After a successful isolated production acceptance, stage the Supply Network pilot as a **separate** reviewed release, behind private feature flags and with rollback/backups; do not merge an unreviewed V22/UI or Muse Draft PR into the original writable host.

## Unverified/blocked

Actual production SSH access, current ECS health, current Dot OAuth refresh and Events subscription, Muse live execution, Shopify live store, Grokbot credentials, external spending caps, and multi-tenant isolation are **not verified** in this conversation.
