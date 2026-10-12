# Pi runtime

Install on an authorized development host with Node 24: `npm ci`, `npm run build`,
`npm start`. Default runtime is `pi`; `WORKSPACE_RUNTIME=pi` is the only supported
standalone startup mode. No DSH CLI, source archive, Host or native patch is read.
Historical DSH modules remain solely for original regression/reference coverage.
Existing host-managed FASTAITOKEN_API_KEY and PI_MODEL select the already used
relay. No key is requested in chat, browser, mini program or business API. Without
credentials the server still starts and saves blocked requests with setup status.

Official pi-agent-core, pi-ai, pi-durable and chord 1.1.0 are pinned in package-lock.
Agent's real state API canonicalizes the admitted context; durable Harness runs
generation and tools via pi-ai. There is no additional Agent loop, cron, worker
queue or application scheduler. Workspace remains the admission queue and source
of business authorization. Durable internal tasks are scoped to each admitted
conversation and cannot discover other conversations or ambient files.

Each Workspace conversation owns a hashed private Pi JSONL directory. It opens
only inside the original Store writer lifetime. JSONL fsync:true is enabled; a
second process must acquire the original Store lock and is rejected. Pi itself
has no cross-process lock. Reopen does not call resume. An interrupted chat's
existing retry operation reattaches the same run/reply/submission under unchanged
execution and input/grant checks. Completed submissions can return their saved
answer instead of repeating the model request. Active business action attempts
must be reconciled rather than replayed. Goal recovery preserves the reserved
reply and token allowance. Shutdown closes Harness while preserving pending
durable work. User cancellation explicitly calls conversation.abort and fences
late results; cancelling a waiter alone would leave execution running.

Tools: workspace_input reads only original ID/version/SHA-verified selected
snapshots. workspace_propose_action stores one proposal and terminates the Pi
turn; it does not execute it. Both are replay:safe because neither performs an
external effect. Original Workspace connector grants, approval payload hash,
separate approve/resume and original receipt handling govern actual execution.
No shell, generic file, browser, HTTP, Muse wake or arbitrary connector tool is
installed. Retry and automatic compaction are disabled; model rounds and output
are bounded by the original run reservation.

Muse/Dot protocol modules and Secure Vault client remain original. Ordinary model
messages requesting provider:muse reject rather than falling back to a model.
The reviewed original Muse binding, account and production ingress remain a
separate requirement; neither Pi nor a saved write receipt proves Muse started.
Local faux-provider tests execute the real Pi packages, not a live model/account.
Production is intentionally off and no live request is authorized.

The source ZIP is a development deliverable, not deployment approval. Source
hashes must be calculated from git cat-file/blob bytes, never converted working
tree text. Real Muse, host authentication, WeChat account/device/review and
production acceptance are reported separately from fixtures and builds.
