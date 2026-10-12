# Pi TUI checkpoint validation — 2026-10-12 UTC

Base: `8ce17ef22190a878f520bad1871029748f211513`.
First pushed source checkpoint: `533a2ab759f8208c3b3300ae7f4e91342eab0ff1`.
Draft PR: https://github.com/magicy565-web/workspace-agent/pull/58.
All authored paths are under `tui/`; original server, supplier MCP, root lockfile
and PR56 client files are unchanged.

Environment: Linux, Node `v24.19.0`, pinned actual Pi coding-agent `1.1.0`,
Python 3.12. Root and isolated TUI dependencies installed from their lockfiles.
`npm --prefix tui start -- --version` returned `1.1.0`. An actual interactive
startup showed the registered extension, and an unconfigured owner command
returned `EXISTING_OWNER_TRANSPORT_REQUIRED`.

| Run | Result | Evidence |
| --- | --- | --- |
| `npm --prefix tui test` | 5 pass, 0 fail/skip | [TUI flow tests](validation/tui-tests.txt) |
| `npm --prefix tui run test:terminal` | 7 actual PTY checkpoints | [Terminal evidence](validation/terminal-tests.txt) |
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

Not accepted: Windows/PowerShell, actual enterprise owner transport, current
remote Muse consumer installation/version/egress, real Muse online/claim/return,
real external work or budget, production deployment, supplier publication,
unattended notification consent or delivery. The existing native owner binding
and specifically approved real task remain required. The host transport contract
is documented, but a live adapter is not invented or provisioned by this PR.
