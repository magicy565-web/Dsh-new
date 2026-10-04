# Workspace backend API v2

Node 24 ESM. The entrypoint serves frontend and API at loopback 127.0.0.1:8787. Explicit enterprise mode adds signed-ingress identity, browser sessions, roles and CSRF; it is one shared workspace, not a multi-tenant service. Read docs/DEPLOYMENT.md before any network deployment. Bodies are JSON objects; errors are `{error:{code,message}}`. No credential value, raw provider error, or arbitrary server path is included in safe errors.

## Startup and security

- `WORKSPACE_RUNTIME=fastaitoken` (CLI default): fixed documented relay Chat Completions endpoint, server-only FASTAITOKEN_API_KEY + explicit FASTAITOKEN_MODEL (user-selected gpt-6-sol), no tools or fallback
- `WORKSPACE_RUNTIME=deepseek-api`: optional fixed official DeepSeek endpoint, no tools
- `WORKSPACE_RUNTIME=harness`: genuine official SDK, explicit `DSH_BIN`, `DSH_REVIEWED_PATCH` and key
- `DSH_WORKSPACE_BRIDGE=1` with reviewed `DSH_WORKSPACE_BRIDGE_PATCH`: optional native persistence extension, described in NATIVE-HARNESS.md
- `WORKSPACE_DATA_DIR`, `PORT`: data path and loopback port
- `WORKSPACE_DEV_ORIGIN`: optional exact loopback origin for development; normally unset

Cross-site requests, external Host headers, other localhost origins and static symlink escapes are rejected. Mutations except DELETE require application/json. Default body limit is 100 KB; artifact upload/update alone allows 7.1 MB encoded JSON. Credential inputs in settings, capability configuration and ordinary memory are refused. Credential references never perform OAuth or create credentials.

`createApp()` permits explicit host injection of reviewed connector adapters and a test environment mapping. HTTP cannot install adapters, choose executable paths, supply raw keys, or weaken native profile permissions. Automatic recovery and scheduler dispatch begin only after the HTTP bind succeeds. Shutdown stops admission, aborts model and connector domains concurrently, drains writes and closes HTTP connections. Uncertain native shutdown retains ownership and reports failure.

## Read and event routes

| Route | Response |
|---|---|
| GET /api/bootstrap | Durable v2 state, runtime metadata, capability views and diagnostics |
| GET /api/status | Provider prerequisites, limits, queue, limitations and process-scoped observations |
| GET /api/diagnostics | Read-only operational snapshot: process/freshness, local fixture evidence, provider/configuration, scheduler/storage/connector health and actionable blockers |
| GET /api/conversations | `{conversations}` |
| GET /api/conversations/:id[/messages] | `{conversation,messages}` |
| GET /api/goals or /api/goals/:id | `{goals}` or `{goal}` |
| GET /api/activity | `{activity}` |
| GET /api/settings | `{settings}` |
| GET /api/memories or /api/memories/:id | `{memories}` or `{memory}` |
| GET /api/runs or /api/runs/:id | `{runs}` or `{run}` |
| GET /api/search?q=... | Up to 100 real matching conversation/message/goal/memory/artifact references |
| GET /api/events | SSE `change` events containing sequence, updatedAt and bootstrap endpoint |

SSE supports Last-Event-ID or `?after=sequence`. It is a durable state-invalidation cursor, not historical native-event replay or token streaming. On every connection the client receives the current cursor and must fetch bootstrap; it never receives raw native event payloads. Slow clients are disconnected to bound memory. State `meta.sequence` advances only on committed writes; idle scheduling does not rewrite state.

Arrays are stored in creation order. The activity timeline retains 2,000 events. Full message history remains available, while each model request uses bounded context.

## Conversations and runs

- POST /api/conversations `{title?,inputContext?}` → `201 {conversation}`
- PATCH /api/conversations/:id `{title}`
- DELETE /api/conversations/:id: stop its active run and remove its messages/goals
- POST /api/conversations/:id/messages `{content,requestId?,queued?,inputContext?,workspaceExecution?}` → `202 {message,run:{id,status,requestId},assistantId?}`
- POST /api/conversations/:id/cancel `{}`: retain history and stop the active request
- POST /api/conversations/:id/reset-session `{}`: explicitly start a fresh native session on the next request, retaining visible local history; requires the conversation to be stopped
- POST /api/runs/:id/cancel `{}`: cancel a chat or pause a goal
- POST /api/runs/:id/retry `{requestId?,queued?}`: create a new explicit attempt from a failed/blocked/interrupted/paused run

Conversation statuses include `idle|running|awaiting_approval|blocked|failed`. Awaiting approval is a durable stopped-at-action state, not an active model request. Queued conversations display running while their run record says queued. Message statuses remain `pending|complete|blocked|failed|cancelled`.

A Run records identity, kind, conversation/goal, request ID, timestamps, status, error, selected execution scope, optional budget and usage, bounded type-only event metadata and native session mapping. Run statuses: `queued|running|awaiting_approval|succeeded|blocked|failed|paused|cancelled|interrupted`.

Without `queued:true`, capacity exhaustion returns BUSY/RUNTIME_BUSY. With it, requests enter a durable FIFO queue, up to 100 waiting by default. Default concurrency is three direct requests or one native process. Repeated request IDs with identical input do not execute twice; changed input returns IDEMPOTENCY_CONFLICT.

Queued, never-dispatched work survives restart. Before dispatch, runtime kind, model and reviewed profile fingerprint must still match its admission. Changes yield EXECUTION_SCOPE_CHANGED and require explicit retry. Interrupted requests are not automatically repeated. Native history is resumed only through the reviewed bridge; stock SDK post-restart continuation fails closed. Cancelling and deleting fence late results by run identity and goal revision.

## Goals and budgets

- POST /api/goals `{title,description?,conversationId?,maxSteps?,maxOutputTokens?,requestId?}` creates a draft
- PATCH /api/goals/:id `{action?,title?,description?,maxSteps?,maxOutputTokens?,requestId?,queued?}`
- DELETE /api/goals/:id stops the goal while retaining its conversation

Actions: start, pause, resume, cancel, complete. Editing requires a stopped goal. `complete` requires review_required and records human review; it does not prove a real-world objective was achieved.

Default maxSteps is the local setting (3); total bound is 1–8. Default maxOutputTokens is maxSteps × 1600; explicit bound is 1600–128000. Each outer request is at most 1600 output tokens. Direct provider timeout is 60 seconds, whole goal timeout 180 seconds. A timeout persists failure even if an injected provider ignores abort; process ownership is retained until cleanup.

Every goal request reserves its output allowance durably before dispatch. Positive, integer observed completion usage may reconcile that reservation. Missing/zero usage, invalid structured output, cancellation and uncertain failure retain a conservative debit; retries cannot bypass the lifetime allowance. `outputTokens` therefore represents accounted allowance, not necessarily billed usage. `run.usage` contains null for unknown counters, or sums of counters actually observed; `usageStatus` is unknown/partial/complete, and partial totals must not be treated as complete usage. Native internal tool/model loops remain subject to the separately reviewed profile, so the outer allowance is not a native bill guarantee.

The outer goal response is structured JSON `{done:boolean,content:string,nextStep?:string}`. Visible content only is retained. done leads to review_required. Reaching a step/output limit pauses; raising the relevant bound permits explicit continuation. Invalid output stops rather than masquerading as success.

## Memory and settings

- PATCH /api/settings `{name?,language?,model?,maxGoalSteps?}`
- POST /api/memories `{content,category?,enabled?,conversationId?}`
- PATCH /api/memories/:id `{content?,category?,enabled?,conversationId?}`
- DELETE /api/memories/:id

Settings allow only the listed fields. Language is zh/en. Available models come from runtime.models. Official direct models are deepseek-flash/deepseek-v4-pro; relay and native model come from explicit reviewed server configuration. No API request can change provider endpoints, credentials or native profile.

Memory defaults enabled with global scope (`conversationId:null`); an existing conversation ID scopes it. Falsey invalid scopes are rejected rather than becoming global. `category:'saved'` denotes a saved library text output and is excluded from automatic context. Disabled memories are excluded. Latest 20 applicable memories contribute at most 8,000 characters, enabled skills at most 12,000, and recent 32 complete messages at most 48,000. Active configured credentials and obvious credential formats cannot be saved as ordinary memory; use server-side references.

## Real file artifacts

- GET /api/artifacts → `{artifacts}`
- POST /api/artifacts `{filename,content|base64,mimeType?,title?,description?,metadata?,sourceGoalId?,sourceConversationId?,sourceRunId?,requestId?}`
- GET /api/artifacts/:id → `{artifact}`
- PATCH /api/artifacts/:id: metadata and/or replacement content; optional expectedRevision guards concurrent edits
- DELETE /api/artifacts/:id: remove metadata and private blobs
- GET /api/artifacts/:id/content[?version=N] → bounded JSON content and version metadata
- GET /api/artifacts/:id/download[?version=N] → actual bytes with attachment disposition, nosniff and sandbox CSP

Allowed filename extensions: txt, md, csv, json, pdf, png, jpg, jpeg, webp. Text uses content; binary uses canonical base64. MIME must match filename, binary signatures are checked, and HTML/SVG/executables/path traversal are refused. Defaults: 5 MiB per file, 100 MiB total, 1000 artifacts, 100 versions. SHA-256 is verified on read. See docs/STORAGE.md for recovery and storage guarantees.

## Skills, connectors and exact approvals

- GET/POST /api/skills; GET/PATCH/DELETE /api/skills/:id
- GET/POST /api/connectors; GET/PATCH/DELETE /api/connectors/:id
- GET /api/capabilities, /api/connector-runs
- POST /api/connectors/:id/approval `{action,resource,payload?}` derives the exact reviewable approval scope
- POST /api/connectors/:id/execute `{action,resource,payload?,approvalId}` consumes the matching approval and calls the configured adapter once
- GET/POST /api/approvals
- POST /api/approvals/:id/decision `{decision:'approved'|'denied',confirmed:true}`

Skill/connector/schedule POST creation also accepts an optional requestId. Identical IDs/bodies return the existing record durably; changed content returns IDEMPOTENCY_CONFLICT. These are draft creation IDs, not permission to execute. PATCH does not accept requestId.

Skills accept name, description, instructions, enabled; they are instruction data, not executable plugins. Connectors accept name, description, adapter, capabilities, credentialRefs and enabled. New connectors must be disabled. Enabling configuration does not approve execution. Adapters and each env reference must have been explicitly supplied/declared by the host; absent adapters/credentials stay blocked and connectionVerified remains false until independently checked.

Approval binds canonical SHA-256 payload, exact action/resource, connector configuration revision, expiry and a single consumption. Default expiry 300 seconds; allowed 1–3600. Payload/configuration changes, denial, missing consent, expiry, reuse and concurrent double consumption fail before execution. Raw credentials are not accepted as payload fields, resource strings or registry data; known credential echoes/encodings in adapter responses are redacted. Exceptions return safe errors. Default connector timeout is 60 seconds; unknown outcomes never auto-retry.

The reusable worker adapter plugs into this same connector gate. It wraps inspected native MultiWorkerEngine/gateway exports and reviewed catalog tasks; it does not create a remote worker identity, deploy an executor, start a listener or accept arbitrary HTTP-supplied prompts. See NATIVE-HARNESS.md.

## Safe local scheduling

- GET/POST /api/schedules; GET/PATCH/DELETE /api/schedules/:id
- POST /api/schedules/:id/approval `{}` derives the exact schedule approval
- POST /api/schedules/:id/enable `{approvalId}`
- POST /api/schedules/:id/disable `{}`
- GET /api/schedule-runs

Create with `{title,goalId,kind:'at'|'every',scheduledAt:ISO,everySeconds?}`. Every schedule starts disabled. Minimum interval is 60 seconds. Consent binds goal definition, maxSteps, total output allowance, selected model and immutable runtime/profile scope. Updates clear consent. At due time the scheduler persists an occurrence claim before invoking the goal dispatcher, passes its expected definition hash, and runtime checks that hash in the same transaction that admits execution. Concurrent edits cannot inherit the prior approval.

Only the most recent missed recurring occurrence is considered after downtime; there is no catch-up burst. Interrupted/unknown admissions, changed scope and failed dispatch disable the schedule for review. One-shot occurrences cannot silently replay. A completed/review-required/cancelled goal is never reset automatically; the schedule blocks. No system cron, external messages or background process is installed. Scheduling works only while this application is running and listening.

Recurring schedules additionally accept the explicit opt-in `{goalMode:'template',maxOccurrences:1..1000}`. This is only valid with `kind:'every'`; omitting goalMode preserves the original resume behavior and never grants fresh budgets. The total occurrence cap is lifetime for this schedule, including claimed work, and editing does not reset it. The `schedule.enable` approval displays and binds mode, total/remaining count, source definition, selected input versions/revisions/content hashes, model, execution profile and per-occurrence budget. Consuming that approval authorizes the bounded repeated model admissions, which can incur separate charges; output-token budgets are not currency limits.

A template claim atomically creates a fresh goal and isolated conversation, with zero consumed steps/tokens and only the source goal's effective explicit input selection. Conversation history, prior output, native session IDs and connector execution approvals are never copied. Legacy implicit context becomes empty selected context. Conversation-scoped memories cannot be used as a fresh-conversation template input; choose workspace-scoped memories explicitly. Source definition or selected scope changes block later dispatch and require review again.

Template occurrences retain `scheduleOccurrence` provenance on their goal/conversation, and schedule run records include sourceGoalId, goalId, conversationId, dueAt, occurrenceOrdinal and the acknowledged modelRunId. Only the latest missed slot is considered. Overlapping running/queued work produces a durable skipped occurrence without a new budget; waiting approval, failed, paused, cancelled, missing or uncertain preceding work blocks the schedule. Results in review_required/completed permit the next approved independent occurrence. The lifetime cap ends the schedule; edits and manual reapproval can explicitly increase it. A transactional schedule-claim fence rejects admissions after disable/edit/interruption. No automatic retry or old-occurrence replay occurs, and every connector action still needs its own exact action approval.


## Enterprise access and operations

- GET /api/session: mode, authenticated, user{id,role}, csrfToken, expiresAt, idleExpiresAt
- POST /api/session/login {} with X-Workspace-Login:1: rotate/create session from signed ingress identity
- POST /api/session/logout {}: revoke current session
- GET /api/access/sessions; POST /api/access/sessions/:id/revoke {}: admin only
- GET /api/access/audit?after=0&limit=100: admin, bounded cursor with truncation metadata
- GET /api/health: authenticated configuration/access/storage health, never a paid provider test

Every enterprise request needs a fresh request/body-bound ingress signature;
private API calls also need the current session. Mutations require exact Origin
and X-CSRF-Token. Session expiry/revocation is rechecked after reading the body.
Local mode remains loopback-only with a local privileged operator. The systemd
example refuses local mode; production target validation is not yet established.
Audit/recovery procedures: docs/DEPLOYMENT.md and docs/RECOVERY.md.

## Operational diagnostic contract

See [docs/OPERATIONS-DIAGNOSTICS.md](../docs/OPERATIONS-DIAGNOSTICS.md) for schema 1 and freshness/restart handling. Diagnostics never call a provider or connector. A configured provider, a passing local fixture report, a provider return, and live deployment acceptance are separate facts. The legacy status `ready` remains configuration-only; use explicit readiness/verification fields.


## Scoped conversation execution

- PATCH /api/conversations/:id/input-context `{inputContext}` updates an idle conversation's explicit selections
- Input shape: `{artifacts:[{id,version}],skills:[{id,revision}],memoryIds:[],connectorActions:[{connectorId,action}]}`
- New conversations select no optional context. File inputs are exact TXT/MD/CSV/JSON versions, read and hash-verified, limited to 32,000 aggregate characters. PDFs/images are storage-only
- `workspaceExecution:true` enables the bounded structured chat task loop (four calls/6,400 output tokens). Selected connector actions also enable this loop; goals always use a bounded structured response
- POST /api/runs/:id/action-decision `{proposalId,decision:'approved'|'denied',confirmed:true}` records a human decision; admin role only. Approval does not execute
- POST /api/runs/:id/resume `{proposalId?,requestId?}` performs the approved bound action and continues the same run. Operator/admin may resume; unsupported/stale/expired/reused scopes fail closed
- Bound approvals cannot be decided or executed through generic capability routes. They bind run/conversation/proposal/execution fingerprint in addition to exact adapter configuration and payload
- Run fields include inputContextSnapshot, connectorGrants, plan, proposals and outputArtifactId. Connector receipts persist through cancellation; late model output is fenced
- Text output artifacts are real inert files with run/goal/conversation provenance and idempotent step identity. Unsupported binaries and executable extensions are rejected

The shipped `workspace-library` adapter accepts `read_file` with resource
`artifact:<id>` and payload `{version}`, `create_file` with resource `library:new`
and payload `{filename,content}`, or `update_file` with resource `artifact:<id>`
and payload `{expectedRevision,content,filename?}`. A connector instance must be
saved disabled, explicitly enabled and selected for a task; every invocation still
needs its exact approval. It cannot read arbitrary server paths or use the network.
This does not add native SDK approval support or change native profile permissions.
