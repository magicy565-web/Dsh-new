# Personal Muse → Workspace Worker REST gateway (review-only, not deployed)

**Status (2026-10-10):** Source integration staged in a feature branch. No public HTTPS host, Muse Connector registration, vault credential, live task or hard external spending cap has been verified. Never display "Muse online" from a local test or an authenticated `identity` call.

This is a **personal Muse-initiated pull connector**. It does not represent a Muse SDK, hosted A2A service, or a public API to start a user's Muse session remotely. Reuses `createDotWorkerBridge`'s durable task logic but with:
- dedicated `museTasks` persistence (Dot uses `dotTasks`);
- a reviewed single Muse `workerId` and different server-side bearer token digest;
- worker ownership checks for **every** task lookup including status, cancellation and artifact mutations;
- separate REST prefix `/api/muse-worker/v1`, not the Dot MCP endpoint `/mcp`.

## Deployment / egress allowlist

Run the persistent single-writer Node.js 24+ Workspace app on a reviewed private host with a proper TLS ingress. Expose **only** `/api/muse-worker/v1/*` to the Muse connector, not the enterprise administrator APIs. The Node server binds 127.0.0.1; do not expose it directly on a public interface. The hostname is **not known or validated**; no fake hostname should be supplied to Muse.

The connector's configured REST base URL will be:
`https://VERIFIED-HOST/api/muse-worker/v1`.

Use the Muse Secure Vault's **API key** option with `Authorization: Bearer <token>`. Tokens must be private 32–256 character URL-safe strings (letters, digits, underscore or hyphen). Do not paste the token into chat, source, logs, or a UI. Store only its exact lowercase SHA-256 digest in the Workspace host's secure configuration. The Dot token MUST differ.

Host-side opt-in variables (all disabled until independently reviewed):

```text
WORKSPACE_MUSE_WORKER_ID=muse-personal-owner
WORKSPACE_MUSE_OWNER_ID=personal
WORKSPACE_MUSE_BRIDGE_TOKEN_SHA256=<reviewed token hash, not plaintext>
WORKSPACE_MUSE_ENABLED=0
WORKSPACE_MUSE_SCOPE_REVIEWED=0
WORKSPACE_MUSE_EXTERNAL_BUDGET_VERIFIED=0
```

All three boolean flags must be `1` **only if** personal Muse owner/tool permissions, public data scope, deployed TLS/authentication, and an actual enforceable provider-side spending limit are evidenced and audited. The boolean flags themselves are **not evidence of a financial cap**. Without those conditions `identity` returns `approved:false`, `inbox` is empty, and the WorkerDesk will not offer Muse as executable. This allows a read-only connector handshake without generating any paid work.

## REST contract (JSON)

| Action | Method | Relative path | JSON body |
| --- | --- | --- | --- |
| identity | GET | `/identity` | none |
| inbox | GET | `/inbox` | none |
| read | GET | `/tasks/{taskRef}` | none |
| claim | POST | `/tasks/{taskRef}/claim` | `{ "requestId": "stable-unique-id" }` |
| status | GET | `/tasks/{taskRef}/status` | none |
| heartbeat | POST | `/tasks/{taskRef}/heartbeat` | `{ "attemptId": "...", "fence": 1, "requestId": "stable-id" }` |
| upload | POST | `/tasks/{taskRef}/upload-file` | `{ "attemptId": "...", "fence": 1, "uploadId": "stable-id", "filename": "report.json", "base64": "<encoded original bytes>", "sha256": "<hex digest>" }` |
| submit | POST | `/tasks/{taskRef}/submit-result` | see below |
| report-blocked | POST | `/tasks/{taskRef}/report-blocked` | `{ "attemptId": "...", "fence": 1, "requestId": "stable-id", "message": "..." }` |
| confirm-stop | POST | `/tasks/{taskRef}/confirm-stop` | `{ "attemptId": "...", "fence": 1, "requestId": "stable-id" }` |
| ack-event | POST | `/tasks/{taskRef}/events/{eventId}/ack` | `{}` |

All paths are relative to the REST base, not the MCP server. Auth headers are mandatory on every action. Client-supplied `workerId` and body `taskRef` do **not** select another worker's account or task.

**Identity:** `{workerId,muse,contract:"workspace.muse.pull.v1",approved,connected:false,allowedServices}`. `connected:false` is intentionally conservative; a successful credential handshake is not proof of an active Muse loop. `inbox` returns `{workerId,tasks:[{taskRef,serviceId,deadlineAt,status:"pending"}]}` for only approved, pending tasks assigned to this exact worker. No pagination yet; at most 200 tasks per provider queue; this limitation must be revisited before expansion.

**Read:** adds public `inputs:{product,market,objective}`, `acceptance`, `maxCredits`, `deadlineAt`, `attemptId`, `fence`, `leaseUntil`, `canExecute` and `cancellationRequested`. The maxCredits is an internal envelope, **not** evidence of a provider account spending ceiling.

**Claim:** returns the original server-issued `attemptId`, integer `fence`, `leaseUntil` and `claimed:true`. Replaying the *same* `requestId` while the original lease is valid returns the *same* attempt and fence with `duplicate:true`. A different claim or second concurrent Muse task returns HTTP 409. One unfinished attempt per registered Muse Worker. A 15-minute expired lease does not authorize new claiming or an implicit retry. Continue to use `status` and `heartbeat` and stop immediately on `cancellationRequested:true` or `canExecute:false`.

**Uploads:** JSON with canonical Base64 payload, filename suffix `.json`, `.md`, `.csv` or `.txt`, at most **1 MiB** raw bytes per file, at most 20 files per attempt. Original SHA-256 is mandatory; reuse `uploadId` on ambiguous retries. PDF/image/presigned uploads are deliberately **not implemented**, rather than silently accepting files that cannot be safely validated.

**Submit result:** Upload at least one genuine file first. `sources` must include 1–20 public HTTPS sources, without placeholder domains. Supply **either** 1–20 actual tool receipts **or** a documented limitation using `evidenceNote`. The latter is allowed for Muse because its tool layer currently does not expose a server-verifiable receipt format. Never invent receipt IDs. Example **shape only**, not a valid real submission:

```json
{
  "attemptId": "server-provided-attempt-id",
  "fence": 1,
  "requestId": "stable-submit-request-id",
  "summary": "Work performed, with public sources in the sources array.",
  "sources": ["https://REAL-PUBLIC-SOURCE/PATH"],
  "toolEvidence": [],
  "evidenceNote": "Muse does not expose an independently verifiable tool receipt. Sources and original uploaded deliverables supplied for manual review."
}
```

The server returns `{taskRef,status:"submitted",reviewRequired:true,independentlyVerified:false}`. The enterprise `/api/worker-orders/:id/refresh` and `/accept` remain **administrator-only** and are not exposed to Muse. For `buyer-discovery`, upload a structured JSON with `schema:"workspace.worker.delivery.v1"`, exact `orderId`, and source-backed `deliverables`, `evidence`, `prospects` arrays. A narrative-only completion cannot become an accepted buyer-discovery deliverable.

**Errors:** JSON envelope `{error:{code:"MW_*",message:"..."}}`. Key status groups: 400 invalid arguments, 401 missing/wrong Bearer, 403 disallowed data/scope, 404 missing or foreign task (the same response to avoid existence disclosure), 409 stale attempt / competing claim / conflicting retry, 413 oversized JSON body, and 429 rate limit. A `cancel` request is not a confirmed stop; Muse must call `confirm-stop` after actually stopping. Only verified evidence and manually accepted results are ready for business use.

**Rate limits:** Single-host in-memory fixed window, per authenticated Muse, **120 GET / 30 POST / 10 uploads per 60-second window**. An HTTP 429 will not renew leases or grant retries. These limits assume the reviewed single-writer host; multiple Node replicas would require a central rate limit and shared durable coordinator.

## Muse-side skill changes needed

Muse has scaffolded `~/workspace/skills/enterprise-workspace/` locally. Update its `submit` CLI to allow `toolEvidence:[]` **only when** it supplies a genuine, bounded `evidenceNote`, at least one true source URL and an uploaded artifact. Preserve its journaled `requestId`/attempt/fence on retries; do not create surrogate tool receipt IDs. The existing Dot schema is unchanged.

Suggested safe live sequence after HTTPS + Vault registration:
1. `identity` (must show matching worker identity and `approved:false` initially).
2. `inbox` (empty while budget/scope gates are closed).
3. After independent security/financial review, enable work, approve **one** small public research order in Workspace and dispatch it.
4. Muse `inbox → read → claim → heartbeat → upload → submit`.
5. Admin `refresh → inspect evidence → accept/reject`; separately exercise cancellation acknowledgment and full restart recovery.

## Scope / known limitations

- No remote initiation of a user's personal Muse conversation. The connector must be invoked by that Muse / owner goal.
- No currently verified HTTPS deployment, tokens, authenticated Muse execution, source verification or settled costs.
- Only one explicitly enrolled Muse Worker per single-tenant Workspace deployment; not an open self-service personal agent marketplace.
- Private RFQs and automatic buyer outreach remain disallowed.
- Do not interpret a successfully saved task, connector handshake, local fixture or budget flag as proof of provider-side commercial readiness.
