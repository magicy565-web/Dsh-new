# Workspace authenticated ingress — 2026-10-18

Status: reviewable source and synthetic local verification, **not deployed**.
Base: e63b33a56b51244f194c562c8332649a83adcc18.
Branch: codex/workspace-authenticated-ingress-20261018.
Target: codex/omp-all-plugins-integration-20261017.

## Result and exact boundary

The existing enterprise HTTP backend can receive authenticated browser requests
through this narrow chain:

Browser HTTPS → Caddy basic_auth → protected local Unix socket → Node signing
proxy → one configured numeric loopback HTTP backend.

Caddy authenticates the supplied username/password. It overwrites
X-Workspace-Authenticated-User with its authenticated username. The Node proxy
requires an exact, case-sensitive username → existing member subject mapping,
then calls the unchanged server/auth-ingress.mjs signWorkspaceRequest for every
request. The unchanged server/access.mjs verifies its Ed25519 assertion and
continues to own roles, browser Session, CSRF, replay protection and audit.
There is no account API, password discovery, automatic owner mapping, automatic
key generation, role assertion, Session replacement or OMP/Store change.

Ordinary reverse proxying or a browser-provided identity header cannot
authenticate. The signing proxy itself does not verify passwords: **every process
that can connect to its socket can impersonate any configured mapping**. Socket
access and Caddy configuration control are signing authority. Do not expose the
socket via any unauthenticated TCP bridge, permissive container mount, shared
group or alternate Caddy route. This prototype targets a single approved owner;
additional mappings require explicit review and existing backend membership.

## Verified Caddy capabilities

Official [basic_auth documentation](https://caddyserver.com/docs/caddyfile/directives/basic_auth)
defines the authenticated username placeholder and hashed-password requirement.
Official [reverse_proxy documentation](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy)
defines Unix upstreams, header replacement and default request preservation.
SSE flushes immediately by default. Negative flush_interval disables cancellation
after client disconnect; the template deliberately leaves the default intact.
Official [import documentation](https://caddyserver.com/docs/caddyfile/directives/import)
supports a literal private include whose absence is a configuration error.

The parent reports installed Caddy 2.11.7 running as caddy:caddy. This environment
initially had no Caddy executable. A separate official 2.11.7 release was
downloaded into /tmp for tests, with its archive checked against the release's
SHA-512 checksum. No system Caddy, DNS, users, groups or units were changed.
The release archive SHA-256 was
727b91701a392de6ebc5027509f548bf39979e5216340d0faed8fa5e69c84f8b.

## New files

| File | Purpose |
| --- | --- |
| server/workspace-authenticated-ingress.mjs | Linux-only explicit configuration loader and Unix-only signing HTTP proxy |
| test/workspace-authenticated-ingress.test.mjs | Transport fixture using real original signature/access/audit/session code |
| test/workspace-authenticated-ingress.http.test.mjs | Original createApp, real Store and Artifact HTTP integration; disabled model provider |
| test/workspace-authenticated-ingress.caddy.test.mjs | Real Caddy Basic authentication and Unix transport with disposable credentials |
| deploy/workspace-authenticated-ingress.Caddyfile.example | HTTPS site fragment; private credential include; authenticated username replacement |
| deploy/workspace-authenticated-ingress.credentials.caddy.example | Credential-format placeholder only, no usable hash or password |
| deploy/workspace-authenticated-ingress.config.json.example | Explicit signer configuration without secrets |
| deploy/workspace-authenticated-ingress.service.example | Uninstalled, reviewed-path/user/group systemd template |

No existing file is changed. In particular auth-ingress.mjs, access.mjs,
index.mjs, package.json, package-lock.json, UI, plugins and shared Host/budget/
Store files remain at the fixed baseline. PR112 and paused receipt/permission
work were not reviewed, merged or retried.

## Required operator inputs before any deployment

The parent must separately confirm all fields below. The approved future
workbench.cnsubscribe.xyz route is not approval to create administrator
credentials, keys, users, groups or socket access.

| Input | Required relationship |
| --- | --- |
| publicOrigin | Exact approved HTTPS origin, initially https://workbench.cnsubscribe.xyz; must equal WORKSPACE_PUBLIC_ORIGIN, including any explicit non-default port |
| workspaceId | Existing WORKSPACE_ID |
| issuer / keyId | Existing WORKSPACE_INGRESS_ISSUER / WORKSPACE_INGRESS_KEY_ID |
| privateKeyFile | Approved existing/provisioned Ed25519 signing key, readable only by signer; matching public key configured in original backend |
| membersFile | Exact reviewed file used by WORKSPACE_MEMBERS_FILE; original {subject, role} array format |
| usernameSubjects | Explicit approved Caddy username and exact existing member subject; no inferred equality or default admin |
| upstream | One exact http://127.0.0.1:PORT or http://[::1]:PORT origin; explicit non-default port, no DNS name/path/query/userinfo |
| socketPath / socketMode | Reviewed absolute canonical path, at most 100 bytes; 0600 for same OS user or explicitly approved 0660 group sharing |
| private Caddy include | Exact approved Basic username and privately provisioned password hash; readable by actual Caddy user, excluded from git |
| service OS user/group and paths | Approved signer UID, existing Caddy GID/membership, actual Node/application/config paths and backend service ordering |

Do not copy a real hash into the currently 0644 Caddyfile. The site fragment
imports /etc/caddy/workspace-authenticated-ingress.credentials.caddy by a literal
path; that future file should be private, for example caddy:caddy 0600, with a
protected parent directory. The signer key should be signer-owned 0600.
The signer config and members file must be root- or signer-owned regular files
without group/other write permission; the key additionally rejects all group/
other permissions. Paths must be absolute and canonical without symlinks.
The loader reads no .env, scans no directories and never generates credentials.
Configuration files are capped at 100,000 bytes.

The systemd example proposes a dedicated signer user with Group=caddy, a
signer-owned RuntimeDirectory at 0750, UMask=0007 and a 0660 socket. The socket
directory must already exist, be owned by the signer UID, have no group write
and no other permissions, and contain no symlink path components. The code
changes only the mode of its newly bound socket. It does not create/chmod/chown
the directory or modify an existing socket/file. An existing path fails startup;
there is no automatic stale-socket unlink. Root and the authorized socket group
remain trusted. Cross-UID group setup has not been exercised by these same-UID
temporary tests and requires the parent's deployment verification.

Caddy configuration readers/controllers can access its loaded credential
configuration and route to the signer. Keep private includes, adapted JSON,
Caddy admin access, debug logs and backups under the same reviewed boundary.
Do not print a real adapted configuration into shared logs.

## Start/configure shape, without secrets

After the parent has reviewed and provisioned the inputs, the CLI shape is:

    node /opt/workspace-agent/server/workspace-authenticated-ingress.mjs /etc/workspace-authenticated-ingress/config.json

The JSON format is the checked-in .config.json.example. It names key and members
files but contains no password, hash, key bytes or real account. The Caddy site
and credential examples are separate files. The placeholders are intentionally
unusable. These examples were not installed or applied.

The original backend must still start in enterprise mode with its original
production guard, matching public key/origin/issuer/workspace/key ID/members,
one original data directory and one original writer. Do not change it to local
mode or start a second backend. Mapping, member, password or key changes require
coordinated parent review/restart; the original backend owns Session revocation
on restart. The proxy reads the members file at startup; original backend
membership remains authoritative even if the two snapshots differ.

## Request and streaming behavior

Only GET, HEAD, POST, PATCH and DELETE are supported, matching the original
signer. GET/HEAD/DELETE reject request bodies. Exact incoming Host must match
publicOrigin. Target remains the original origin-form string, including query
order/escaping; no URL serialization, route rewrite or parsed-body re-encoding
occurs. The proxy reads the bounded body before minting a 30-second original
assertion, then forwards exactly those bytes once with recalculated
Content-Length. It never retries, follows redirects or chooses an upstream from
request headers/targets.

A request-header allowlist retains Content-Type/Encoding, Cookie, Origin,
Sec-Fetch-*, X-CSRF-Token, X-Workspace-Login/Session/Client, Last-Event-ID,
Idempotency-Key and standard browser content/cache/conditional/range headers.
All browser identity/assertion/forwarding headers, Authorization, service bearer
credentials and unlisted custom headers are omitted. The authenticated username
header itself is not sent upstream. No Origin, Fetch metadata, login intent,
CSRF token, Session or browser identity is invented. Dedicated Agent/Worker/MCP
bearer clients must retain their separately reviewed routes; this browser ingress
does not forward their Authorization credentials.

Duplicate security headers are rejected before folding. The parser bounds total
header bytes to 16 KiB and the handler rejects more than 80 fields rather than
silently truncating. Connection-nominated custom fields, Trailer declarations,
Expect, upgrades, WebSocket and CONNECT are unsupported and rejected. Undeclared
trailers are not forwarded or used for identity or the signed body.
This is the existing browser HTTP/SSE surface, not a general tunneling proxy.

Body limit defaults/hard-caps at 7,100,000 bytes (the original artifact JSON
envelope ceiling). Original route limits, JSON validation and 5 MiB decoded
artifact ceiling continue downstream. Chunked input obeys the same byte cap.
maxInFlight defaults to 8 and permits 1–32; active SSE counts toward it.
The default worst-case body buffers alone are roughly 113.6 MB before runtime/
stream overhead. maxConnections is 128. Body timeout defaults to 60 seconds
(range 1–120 seconds); response-header timeout defaults/caps at 25 seconds
(range 100–25,000 ms). An SSE response has no new proxy duration limit; the
original assertion/session watcher still ends it, including 30-second assertion
expiry and logout/revocation. Reconnect performs a new Caddy-authenticated,
freshly signed request.

Responses preserve status, bytes, Set-Cookie arrays and original security
headers, remove hop-by-hop and internal assertion/username fields, and stream
with Node backpressure. Client disconnect and shutdown destroy upstream
requests. Upstream connection failures return a fixed 502, pre-header timeout
a fixed 504; after response headers an upstream failure terminates the stream.
The proxy logs no request URL/body/header/assertion/key or raw exception.
Startup failure is a fixed redacted message. Original backend business-error
bodies are passed through unchanged.

## Actual verification and retained failures

Environment: Node 24.19.0, npm 11.9.0, Linux; synthetic users, temporary Ed25519
key, real temporary files, loopback TCP and temporary Unix sockets only.
No Tencent connection, production secret read, model/paid API call, production
account, persistent credential, deployment or system permission change.

Commands/results (counts below overlap; do not add repeated runs):

| Command | Actual result |
| --- | --- |
| node --check server/workspace-authenticated-ingress.mjs; module import | Passed, no external package needed for this signer/access path |
| npm ci --ignore-scripts --no-audit --no-fund | First failed ENOENT creating default /home/agent/.npm/_cacache; no lock change |
| same install with --cache /tmp/workspace-authenticated-ingress-npm-cache | Passed, 280 locked packages; no lifecycle scripts or lock changes |
| node --test test/workspace-authenticated-ingress.test.mjs test/access-audit.test.mjs | Initial completed run: 18 passed, 0 failed/skipped; final combined run below includes two additional timeout/truncated-response checks |
| WORKSPACE_INGRESS_TEST_CADDY=/tmp/workspace-authenticated-ingress-caddy/caddy node --test test/workspace-authenticated-ingress.caddy.test.mjs | 1 passed, 0 failed/skipped; actual Caddy 2.11.7 validates the substituted template and authenticates ephemeral Basic credentials |
| node --test test/workspace-authenticated-ingress.http.test.mjs | 4 passed, 1 failed, 0 skipped; full original backend, detailed below |
| npm run build:web | Passed typecheck/Vite build; existing large-chunk warning |
| node --test test/access.test.mjs | Before frontend build: 21 passed, 2 failed due absent static dist/index.html (404 vs 200); after successful build: all 23 passed |
| npm run build | Failed ENOENT for pinned support/omp-bun-linux-x64/node_modules/@oven/bun-linux-x64-baseline/bin/bun; no fake runtime or installation substituted |
| WORKSPACE_INGRESS_TEST_CADDY=/tmp/workspace-authenticated-ingress-caddy/caddy node --test test/workspace-authenticated-ingress*.test.mjs test/access.test.mjs test/access-audit.test.mjs | Final run: 49 total, 48 passed, 1 retained original maximum-binary regression failed, 0 skipped/cancelled |

Initial core run had 12 passed/1 failed because events.once(response, 'close')
rejects on an expected ECONNRESET during deliberate shutdown. The test now waits
for close directly while permitting that reset; all 15 ingress core tests pass.
No production behavior was relaxed.

The retained full-backend failure is the advertised maximum 5 MiB binary PNG
upload. Both a directly signed original backend request and the proxy request
return 500 INTERNAL_ERROR. The original artifacts.mjs base64 regular expression,
when run independently with that synthetic input, raises RangeError: Maximum
call stack size exceeded on this Node version. The regression still expects 201
and remains failing; it is not skipped or converted into passing evidence.
That shared file is outside the authorized write scope. Normal 32 KiB binary
upload/download round-trips exact bytes; exact 5 MiB text upload/download works;
original decoded-size/JSON limits and the proxy envelope limit are verified.
The initial single upload test stopped on that 500; tests were separated so
the remaining upload/limit checks actually execute.

The core HTTP routing fixture is a substitute for domain routes, not a fake
authenticator: it uses the real signWorkspaceRequest, validateAccessConfig,
createAccessControl, durable audit, login, body hash, membership, CSRF, logout,
watchStream and replay checks. The separate .http test uses real createApp,
Store and Artifact storage without SDK/storage mocks. Its disabled provider
throws if model execution is attempted. The Caddy test uses the actual Caddy
binary plus real original access control with a thin transport fixture; it does
not claim full TLS, production OS-group or deployed OMP evidence.

If no reviewed Caddy executable is available, the Caddy test explicitly skips
and says to set WORKSPACE_INGRESS_TEST_CADDY. Such a run is not Caddy evidence.
The source baseline's OMP build and retained maximum-binary regression remain
unpassed. No general backend suite, real browser/HTTPS login, certificate
issuance or production acceptance is claimed.

## Parent integration and rollback

Before admitting users, review the diff and retained failures, confirm the
actual credential/key/subject/group fields, verify backend enterprise mode and
matching public key, and test the authorized HTTPS hostname with real browser
login/Session/CSRF plus stream cancellation. This draft does not provide that
approval. Basic browser credentials can remain cached after application logout;
logout revokes the original application Session, while disabling/changing the
Caddy credential is a separate operator action.

Rollback order after any future approved deployment:

1. Remove/disable only this new hostname route or return a maintenance response.
   Never roll back to unauthenticated forwarding or enterprise local mode.
2. Validate and reload the reviewed previous Caddy configuration; preserve other
   existing routes and their authorization. Close/revoke affected Sessions via
   the original backend as required by the parent.
3. Stop only the new signing proxy unit; it destroys upstream streams and Node
   removes its owned Unix socket on clean close. Leave the original backend/
   Store/OMP writer and data untouched.
4. For an abnormal leftover socket, first confirm the signer is stopped and
   inspect exact ownership/path before an authorized operator removes it.
   The proxy intentionally refuses to unlink it automatically.
5. Restore the reviewed previous ingress config and key-ID/public-key pairing
   if changed. Credential revocation/key rotation and file removal require the
   parent's separate credential lifecycle decision; they are not implied here.

All changes are additive in this branch and can be reverted without data
migration. The parent owns independent review, integration and deployment.

## Selective integration note · 2026-10-18

Source PR115 is fixed at `6cdfb3cfe27ac997348440864580336152889095`.
Eight source/test/deployment-template files retain the exact author bytes. This
document alone corrects the trailer description after independent review:
Trailer declarations are rejected; undeclared trailers are not forwarded or
used for identity or the signed body. No new trailer policy or runtime change
was introduced during integration. The author's original 48/49 result above is
retained; integration does not establish corrected HTTP, cross-UID/socket or
public HTTPS acceptance and does not provision credentials.
