# Cloud Pi recovery, 2026-10-12

Verified remote recovery baseline: PR33 `e37d4b98c0a9a981c3e1ce37c9afca73c1fb1c89`.
`git merge-base` confirms that both PR32 `7b891844821803ec61aaf564fe5dfcb903d83a8f`
and PR28 `1a669dc81e6e3dab6fa11d3fbf0afbced08f8c39` are ancestors.
The existing cloud checkout was clean at `b9546e1d7e6d7ac1381f84327a4f15cbfc60598f`.
Development uses a separate worktree and branch `codex/cloud-pi-runtime-20261012`.
No main modification, merge, force push, deployment or production access is authorized.

The complete remote head listing contained no prior Pi runtime branch, including
the reported `codex/tt041-pi-runtime-20261012`. No local migration bytes were
present. The reported 34 tests are historical and are not acceptance evidence for
this implementation. PR33 UI and PR28 governance/connector code are recovered;
missing Pi runtime and frontend integration must be implemented and tested anew.

No AGENTS.md or .agents/skills files were found in either the checked out
repository or the cloud environment's .agents directory.

Official source was cloned and checked out at release v1.1.0,
`abe508e1b89912adde45528136c3221eb69acdd7`:
https://github.com/earendil-works/pi/tree/abe508e1b89912adde45528136c3221eb69acdd7
All four direct Pi dependencies are exact 1.1.0, including pi-agent-core, pi-ai,
pi-durable and chord. package-lock.json records registry URLs and integrity.
The registry did not supply gitHead, so a registry integrity pin is not claimed
as a byte comparison of published output against the TypeScript source tree.

Pi-durable is the execution harness, not a simulated persistence layer. Workspace
retains its original queue, identity/access, exact approvals, business idempotency,
Attempt reconciliation and file validation. Pi's internal task runner serves
admitted conversation work; no second application scheduling system is added.
Only explicitly replay-safe tools may replay. JSONL storage uses fsync:true
and runs inside the original Store's exclusive writer lifetime; Pi storage
itself does not provide a cross-process lock. Cancellation of a wait is not an
abort, so user cancellation must explicitly abort the durable conversation.
Write submissions append records and do not start a model or wake Muse.

Muse remains the original Personal Agent, using existing reviewed Connector and
WorkerDesk protocol. Local fixtures are not live Muse, execution or wake evidence.
The intentionally powered-off production server is never probed or changed.
