# Deployment and operations contract

Status: release-candidate source/configuration, not a provisioned or production-
accepted service. The current development cloud computer is not established as a
persistent production host. Sites/Workers cannot run this existing architecture
unchanged: native child processes and persistent local storage are requirements.
Choose and authorize a persistent Node 24 host/container/VM before deployment.

## Supported boundary

One enterprise, one shared workspace, one active backend writer. All members can
read shared conversations, goals, memory, artifacts and operational metadata. This
is not per-user confidential storage or tenant isolation. Roles:

- viewer: read shared workspace; no business-data mutation
- operator: chat/goal/run/memory/artifact actions
- admin: operator actions plus settings, skills, connectors, approvals, schedules,
  session revocation and audit access

Default local mode binds loopback and trusts the local operator. It must never be
placed behind a public forwarder. NODE_ENV=production refuses local mode. The
systemd example forces both production and enterprise mode in its command line;
missing configuration then fails startup rather than silently becoming local.

Enterprise mode still binds only loopback. A reviewed same-host TLS and employee-
authentication ingress is required. Neither forwarding X-User/X-Email nor placing
an ordinary reverse proxy in front is sufficient. Existing OIDC/SAML employee
login can be retained, but its gateway needs the documented signing adapter.
The application does not implement an identity provider or claim plug-and-play
compatibility with any gateway. Target-specific adapter work and review remain a
launch gate until the chosen host/identity stack is known.

## Exact authenticated ingress protocol

The ingress must authenticate and authorize its logged-in user on every request,
strip all client-supplied X-Workspace-Assertion/identity headers, derive a stable
subject, and generate a fresh assertion for each forwarded request/attempt. Never
return the assertion or signing key to the browser. Proxy to the loopback backend
only, preserve the exact public Host and request target (including query), forward
the original body bytes, and set/retain the true browser Origin. Do not forge
same-origin browser requests on behalf of arbitrary cross-origin clients.

Header: X-Workspace-Assertion. Compact signed JWT with Ed25519 and exact header
`{alg:"EdDSA",typ:"workspace-ingress+jwt",kid:configuredKeyId}`. Claims:

- iss: exact configured issuer; aud: exact HTTPS public origin
- workspace: configured workspace ID; sub: an allowlisted stable subject
- iat and exp: integer Unix seconds, lifetime at most 30 seconds
- jti: fresh random base64url ID for every request, never reused
- method and target: exact upstream method and URL including query
- bodySha256: SHA-256 of the exact body; empty-body hash for GET/HEAD/DELETE

Use server/auth-ingress.mjs signWorkspaceRequest only after real gateway identity
verification. It is a reference signing primitive, not a login service. A valid
signature cannot grant a role: the backend's member map is authoritative. The
private signing key belongs only in the ingress; the backend reads a public key.
Static assets require ingress authentication; private APIs additionally require a
browser session. TLS certificates, issuer configuration, credential provisioning
and persistent access grants require their normal explicit authorization.

## Browser sessions and cross-site defenses

GET /api/session reports access mode/current identity and CSRF state. Same-origin
POST /api/session/login with JSON {} and X-Workspace-Login:1 establishes an opaque
Secure, HttpOnly, SameSite=Strict, Path=/ __Host-workspace_session cookie. No user
password or API key is entered into this application. Mutations require the exact
public Origin, valid ingress assertion, session and X-CSRF-Token. Conflicting
Host, cross-origin requests, forged/replayed assertions, duplicate security
headers, stale sessions and insufficient roles are refused.

Sessions expire after 15 minutes idle or 8 hours absolute by default, are rotated
on login, can be revoked by admins and never persist over restart. Session
revocation blocks later admissions and closes live event streams; it does not
undo or cancel work already admitted. SSE reconnects need a new ingress assertion
and authenticated session. Role/key/member changes require a backend restart,
which revokes sessions. Employee offboarding must also revoke upstream SSO.

## Host configuration checklist

- Install a supported Node 24 runtime and the verified release in a read-only app
  directory; service account is dedicated and unprivileged
- Use one persistent, private WORKSPACE_DATA_DIR, local filesystem, single writer;
  do not run replicas against the same JSON store or put it on uncertain network FS
- Adapt deploy/workspace.service.example to actual runtime/path ownership and
  service account. It is a template and has not been installed in this environment
- Review the signed-ingress contract above; deploy TLS + employee auth + signing
  adapter, restrict backend reachability to loopback, verify header stripping
- Configure exact origin/workspace/issuer/key ID, safe public-key file and approved
  members file. deploy/members.example.json contains placeholders, not real users
- Enter newly authorized provider credentials in the host's secure settings;
  never in source, frontend, command arguments, shared zip or chat
- FastAIToken requires WORKSPACE_RUNTIME=fastaitoken, FASTAITOKEN_API_KEY and an
  explicit approved FASTAITOKEN_MODEL. No model is automatically chosen
- Native Harness has separate build/profile/protocol and runtime persistence
  gates in NATIVE-HARNESS.md; the text-only systemd template does not establish them
- Select backup encryption/access/retention/off-host destination and test restore
- Set provider-account spending limits before a bounded live acceptance test;
  output-token reservations alone are not a monetary spending guarantee
- Run actual desktop/mobile browser and target deployment acceptance, then obtain
  explicit authorization before admitting real users/public traffic

## Health, audit and incident handling

GET /api/health is authenticated. It reports access audit health, store ownership
and provider configuration, plus schema/migration diagnostics and restore-time facts.
Incomplete restores and native path mismatches fail startup. See NATIVE-RECOVERY.md
and STORE-MIGRATION.md. onlineVerified:false and liveWriteProbe:false are
intentional: the route does not make paid calls or claim a write/recovery test.
Alert on service failure, disk/backup failures, audit capacity, 5xx, rejected auth,
provider errors and recurring blocked runs using the authorized monitoring stack.

Enterprise audit is local fsync'd hash-chained JSONL, 64 MiB maximum; audit failures
stop admission. The API exposes the most recent 5,000 records with truncation
metadata. Hash chaining detects damaged records, but does not resist the OS owner
or malicious rollback; independent protected archive digests are needed. Request
bodies, raw assertions, cookies, CSRF tokens and provider keys are not logged.

If authentication/audit/storage becomes uncertain, stop ingress admission and the
service, preserve evidence, inspect without overwriting and restore to a new data
directory if required. Never delete a suspicious lock blindly. Review external
provider/connector outcomes before retrying; local rollback cannot undo external
actions. Follow RECOVERY.md and the audit maintenance procedure. Decide RPO/RTO,
incident contacts and retention obligations with the deployment owner.

## Production acceptance evidence required

Record exact package digest, Node/OS, host/domain, ingress/IdP version and review,
member roles, TLS/redirect/forgery tests, live selected-provider report, browser
screenshots/reference acceptance, graceful restart, off-host backup and restored
artifact bytes, audit archive drill, and monitoring/rollback owner. Never fill
these with fixture results. Approval to develop does not authorize deployment.
