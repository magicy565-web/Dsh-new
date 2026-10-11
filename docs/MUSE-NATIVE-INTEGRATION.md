# Native Muse deployment candidate

This is an overlay for the verified Huawei Cordis release at
`/opt/workspace-dot/releases/7279e6346910b43fc879f5a99fd581be47a9a73f`.
The directory name is not claimed to be its Git commit. It is not a replacement
standalone application. The backend code overlay is active; genuine Muse authorization and task acceptance remain pending. The original frontend and native Harness are preserved.

`OVERLAY_MANIFEST.json` records the exact original SHA256 for modified production
files and candidate SHA256 for every payload. Reject any changed baseline or
unexpected existing new module before applying the overlay to a fresh candidate
directory. Do not apply directly to the running release or data directory.

The production service, HTTP frontend and native Host entry were retrieved as raw
bytes and verified against independently measured Git blob hashes. Their mixed
newlines are preserved outside the changed anchors. Muse reuses the parent's
guarded writer, artifact service, reviewed owner and Cordis lifetime. The WorkerDesk
implementation from PR15 is reused once; the production release had no WorkerDesk
module. No listener, writer, model runtime, native Agent or scheduler is created.

The Host mounts Muse only when `WORKSPACE_MUSE_REST_FILE` points to an explicitly
selected private configuration. Its schema is `{version:1, worker, actor}`;
`actor` must exactly match one original `plugin.operators` entry. `worker` permits
only `workerId`, `ownerId`, `tokenDigest`, `enabled`, `scopeReviewed`,
`externalBudgetVerified`. Use a separate reviewed Muse digest and leave the three
execution gates false for the first identity/inbox handshake. The actual bearer
belongs in Muse Secure Vault, not this package or a chat message.

The trusted local HTTPS proxy must forward the exact original Workspace Host to
the existing backend and expose only `/api/muse-worker/v1/` on the reviewed HTTPS origin.
Employee APIs retain original ingress assertions, sessions, roles and body checks.
Muse business orders/acceptance/import require the reviewed administrator and fixed
native actor. A Muse bearer cannot enter those employee routes.

Uploads and accepted receipts use the artifact service's native `workerOwner`
admission, plus fixed owner metadata. Shared editing cannot forge reserved Muse
ownership or upload/receipt request identities. The production
`worker-artifact-access.mjs` was retrieved and confirms immutable `workerOwner`
controls ownership. Editable metadata alone cannot authorize a download.

Lifecycle changes expire the original Muse lease without changing attempt IDs,
fences or remote receipts. They do not replay work. Explicit trusted Host reviews
withdraw and drain the old Muse binding before remounting the same configuration
at the reviewed epoch. Cached handles then fail closed. Unfinished Muse tasks
prevent scope resume until the original order is reconciled or stopped.

Node 24.21.0 validation: nine memory native-boundary tests passed, zero failed or
skipped. A combined run with the existing host, contract, ingress and probe tests
passed 35 tests, zero failed or skipped. These overlapping counts are not additive.
They test actual HTTP/bridge/WorkerDesk code with synthetic memory parent services;
they are historical memory-only results. The Linux checks below cover durability and Cordis boot; none are authenticated Muse or research evidence.
Syntax checks passed for all three modified production modules.

Required deployment checks: isolated Linux tests using actual production source
and native Harness, shutdown/drain/rollback, original Dot/OAuth regression, narrow
HTTPS ingress and TLS, then independent Muse identity/inbox. Real execution still
requires Secure Vault authorization, reviewed public scope, provider-side budget,
and administrator approval. No actual Muse task has been executed or accepted.

A paused Host can use the original private review file with action `muse-reconcile`,
version 1, a stable requestId, exact expectedEpoch/configurationHash, and an empty
callbackCandidateIds array. No other fields are allowed. This withdraws and drains
the same Muse binding, then remounts its existing configuration only for read/cancel/
original-attempt stop reconciliation. The mount remains paused, old cached handles
stay revoked, and execution can resume only through a separate exact Host review
after unfinished work has been stopped. It changes no Dot grants or callbacks.

The Linux-only production test also checks actual disk-backed submission, manual
acceptance, opportunity import, paused original-attempt stop and explicit resume.
Its expanded flow now passes on Linux with synthetic fixture inputs.

Linux validation on the verified ECS: 11 native binding, real durable service and
original Cordis boot tests pass with zero failures/skips. They use isolated
fixture identities/storage, gates false for the Host handshake and no paid model
request. The native Worker ID is a lowercase UUID, preserving the original
immutable artifact owner schema; incompatible IDs fail before a write.

TypeScript and Vite build pass. Linux DOM tests pass 19/19 after waiting for the
actual enterprise settings input instead of the earlier loading modal. Full
backend run: 361 passed, 3 failed, 3 skipped. Its three source fixture failures
refer to SDK server and agent-loop testkit modules omitted from the deployed
Harness subset; three built-export tests are unavailable. This is not a full
backend pass and not real Muse execution/acceptance.

The deployed base path is `https://workspace.cnsubscribe.xyz/api/muse-worker/v1`.
Only this prefix has a dedicated proxy to the original backend; employee routes
retain the original gateway. Public TLS verification succeeds and identity returns
`404 MW_GATEWAY_UNAVAILABLE` because no independent Muse credential/configuration
has been issued yet. The Host remains paused with execution disabled.

The original production Dot/Harness test also passes against the candidate under
synthetic isolated identities, including shared Worker slot, original Session
return, OAuth MCP file return, idempotency and pause fencing. Real old-connector
OAuth refresh is a separate recovery activity; its invalid_grant is not reported
as resolved by this fixture. The identity service was not restarted.

Private predeployment backup has SQLite integrity `ok`. The first code switch
was automatically reverted when copied vendor directory traversal blocked the
service account. Directory permissions were repaired, all candidate modules were
imported as the actual service user, and the second switch passed. Code rollback
removes only the backend drop-in and restores ingress configuration; preserve
current workspace data, OAuth, leases and tasks.
