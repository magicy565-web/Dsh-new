# Pi TUI checkpoint validation — 2026-10-12 UTC

Base: `8ce17ef22190a878f520bad1871029748f211513`.
First pushed source checkpoint: `533a2ab759f8208c3b3300ae7f4e91342eab0ff1`.
Draft PR: https://github.com/magicy565-web/workspace-agent/pull/58.
Authored paths are under `tui/` plus one small registration patch in
`server/wechat-ingress.mjs`. Supplier MCP, root lockfile, server/index and PR56
client files are unchanged. The ingress returns a Host-internal launcher; its
existing login and HTTP routes keep their original behavior.

Environment: Linux, Node `v24.19.0`, pinned actual Pi coding-agent `1.1.0`,
Python 3.12. Root and isolated TUI dependencies installed from their lockfiles.
`npm --prefix tui start -- --version` returned `1.1.0`. An actual interactive
startup showed the registered extension, and an unconfigured owner command
returned `EXISTING_OWNER_TRANSPORT_REQUIRED`.

| Run | Result | Evidence |
| --- | --- | --- |
| `npm --prefix tui test` | 9 pass, 0 fail/skip | [Mounted host + handoff tests](validation/mounted-host-handoff-tests.txt) |
| `npm --prefix tui run test:terminal` | 8 actual PTY checkpoints | [Terminal evidence](validation/mounted-host-terminal-tests.txt) |
| `node --test test/wechat-ingress.test.mjs test/pi-muse-binding.test.mjs test/pi-muse-policy.test.mjs` | 7 pass, 0 fail/skip | [Original ingress/binding regressions](validation/mounted-ingress-regressions.txt) |
| Original Pi Muse binding/policy tests | 3 pass, 0 fail/skip | [Original regressions](validation/original-pi-muse-tests.txt) |
| Checked-in Muse CLI's standalone offline suite | 40/40 | [Consumer checks](validation/consumer-offline-tests.txt) |

The terminal run starts the **real installed Pi CLI**, types the registered
command, fills the actual TUI dialogs, selects No once, then separately selects
Yes for exact approval and dispatch. The checked-in Python Muse v4 CLI claims
the resulting original order, repeats the same claim key, renews its lease,
uploads and submits. Real TUI refresh displays `result_returned`, the original
Session stores the returned summary, and a fresh Pi process reads that same
task. All observations are from temporary loopback fixture data; model runs
remain zero and `realMuseVerified` is false.

The signed enterprise HTTP suite independently covers the original owner/admin
session, CSRF, worker-token rejection, wrong tenant, other owner, revoked session,
stale review hash, declined confirmations, cold backend recovery, lost draft
response and exact same-request replay. Journal failure prevents the request;
cross-owner/workspace/conversation recovery is rejected.

Initial test-development failures involved a non-UUID synthetic worker ID,
Worker requests carrying an owner-only Origin header, empty fixture arrays,
and PTY key/output synchronization. Those fixture drivers were corrected; no
server policy, assertion gate or original consumer protocol was weakened.

Follow-up: the concrete native HTTPS owner transport and private Host→TUI RPC
bridge now exist. The trusted Host retains token/CSRF and uses the original
native ingress for fresh signed requests; the child receives neither secret nor
signing material. Its minimal child environment excludes Worker/provider keys.
`npm --prefix tui run diagnose` is GET-only. The original native ingress + signed
loopback backend + actual child-process RPC fixture passes, including expiry,
scope mismatch and denied routes. See [Host tests](validation/owner-host-tests.txt)
and [PTY rerun](validation/owner-host-terminal-tests.txt).
One PTY rerun reached the returned result but its harness did not drain Pi's
fullscreen-exit output, causing a cleanup timeout. The original failed output
is retained in [initial terminal run](validation/owner-host-terminal-initial.txt);
the driver now drains the real PTY during normal exit and the rerun passed.

The final native-ingress test calls its actual `launchOwnerTui()` registration,
derives the existing owner from the original live session and launches a real
diagnostic subprocess. Worker/viewer/foreign-owner sessions are denied, no order
is created and `/api/session/tui` remains 404. The new handoff command writes only
one approved/dispatched public scope plus an exact-order consumer runbook; it
rejects drafts/cancelled tasks/wrong workers and leaves the pending task unclaimed.
No credential or private owner/conversation ID appears in that generated file.

Not accepted: Windows/PowerShell, production mounting of the implemented owner bridge, current
remote Muse consumer installation/version/egress, real Muse online/claim/return,
real external work or budget, production deployment, supplier publication,
unattended notification consent or delivery. The existing native owner binding
and specifically approved real task remain required. The native ingress method
is registered, but the actual original login host must invoke it from a reviewed
foreground terminal action. A browser-only SSO terminal handoff is absent; this is
not solved by entering a few environment variables. The existing session still
expires/revokes and is not recreated by this bridge. Exact gaps and manual steps
are in [OWNER-CONNECTION.md](OWNER-CONNECTION.md).
