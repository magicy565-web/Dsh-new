# Workspace backend API v2

Node 24 ESM. The entrypoint serves frontend and API at loopback 127.0.0.1:8787. Explicit enterprise mode adds signed-ingress identity, browser sessions, roles and CSRF; it is one shared workspace, not a multi-tenant service. Read docs/DEPLOYMENT.md before any network deployment. Bodies are JSON objects; errors are `{error:{code,message}}`. No credential value, raw provider error, or arbitrary server path is included in safe errors.

## 云端专家团队 API

企业主入口 `/workers`，原增长任务入口 `/services`。后端新增 `GET /api/cloud-expert-catalog`、`GET|POST /api/cloud-experts`、`GET|PATCH /api/cloud-experts/:id`、`POST /api/cloud-experts/:id/delegate`、`GET|POST /api/cloud-teams`、`GET|PATCH /api/cloud-teams/:id` 与 `GET /api/cloud-teams/:id/plan`、`POST /api/cloud-teams/:id/stage`（把团队成员的工作写入真正的待审批 Worker 任务单，校验总预算与单项上限；不自动派发）。所有配置写入只允许管理员，复用 Workspace 认证、CSRF、审计及持久单写者存储。Team plan 仅预览，不允许虚构并行执行。已绑定专家可使用现有 WorkerDesk 创建待独立审批任务。详见 `docs/CLOUD-WORKER-EXPERT-TEAMS.md`。

## ChatGPT dot xy · scoped plugin pull Worker

Real host-only integration: `GET /api/dot-worker-connection` shows the audited worker's configured/pending/claimed/completed state without claiming that a dot is online. `GET /api/dot-worker-connection/tasks` returns lease and audit metadata for an enterprise administrator only.

**The actual ChatGPT plugin connection endpoint is authenticated `POST /mcp`**, with alias `POST /api/dot-worker/mcp`. This is a stateless MCP Streamable HTTP JSON-RPC server supporting 2026-07-28 `server/discover` / `tools/list` / `tools/call` and legacy 2025-11-25 initialization. It discovers 11 scoped tool definitions from the same OpenAPI schemas and dispatches into the existing, approved Dot Worker bridge. This is not a new execution engine or a means to start a personal dot session from the outside. See [actual MCP integration](../docs/DOT-MCP-CONNECTION.md).

Dedicated authenticated legacy REST gateway: `/api/dot-worker/v1/identity`, `/inbox`, `/tasks/:taskRef`, `/tasks/:taskRef/status`, and the `POST` operations `claim`, `heartbeat`, `upload-file`, `submit-result`, `report-blocked`, `confirm-stop`, `events/:eventId/ack`. All paths are relative to `/api/dot-worker/v1`, require the host-approved server-side Bearer header (not a ChatGPT account credential) and never use browser sessions. Request and response schemas, idempotency, lease fences and evidence requirements are documented in [Dot Worker API](../docs/dot-worker-openapi.json).

The Dot interface is *pull*, not inbound A2A. `dispatch` writes a durable `queued` task and does not assume dot actually started; real work requires a Dot plugin client to authenticate and claim it. Task claims are single-active, fenced and expire fail-closed. Reported evidence cannot bypass human review. Private RFQ delegation remains prohibited.

**The real xy plugin identity/inbox tool calls currently return internal errors**; no live dot execution has been confirmed. This module is disabled by default and must not be marked production-ready without successful remote handshake, reviewed scopes, and a provider-enforced hard spending limit. See [integration guide](../docs/DOT-XY-INTEGRATION.md).

## AI Worker service desk (business delegation)

The enterprise homepage `/workers` is an outcome/service-oriented layer. Existing conversation, goal, artifact and exact-action connector interfaces are retained. This new V1 does **not** add a live third-party executor by default.

| Method | Route | Action |
| --- | --- | --- |
| GET | `/api/worker-services` | Curated offers, verified host-registered adapter availability |
| GET | `/api/worker-orders` | Single-workspace durable order list |
| GET | `/api/worker-orders/:id` | Inspect exact order |
| GET | `/api/worker-opportunities` | Durable enterprise leads imported only after accepted research |
| GET | `/api/worker-opportunities/:id` | Inspect one attributed source record |
| POST | `/api/worker-orders/:id/promote` | Admin: explicitly import indexed sourced prospects into enterprise pipeline |
| POST | `/api/worker-opportunities/:id/review` | Admin: mark qualified/rejected and record human notes without outreach |
| POST | `/api/worker-orders` | Authorized operator creates consent-bound draft |
| POST | `/api/worker-orders/:id/approve` | Admin reviews scope, partner and budget |
| POST | `/api/worker-orders/:id/dispatch` | Admin sends exact approved task to reviewed adapter |
| POST | `/api/worker-orders/:id/refresh` | Admin requests status and evidence from remote worker |
| POST | `/api/worker-orders/:id/accept` | Admin accepts evidentiary deliverables |
| POST | `/api/worker-orders/:id/cancel` | Admin requests cancellation and awaits real worker confirmation |

Server registration `createApp({ workerAdapters: { reviewedPartner: adapter } })` only; remote installation from UI is not allowed. Adapter-provided `budgetEnforced` must be supported by independently verified hard caps before any production task. `rfq-recovery` requires separately reviewed private-data gateway; not eligible for external delegation. API responses never label remote evidence as independently verified. See [full contract](../docs/AI-WORKER-V1.md).

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

## AI-work 产品库与开发计划委托（首个通用 AI-work：客户线索挖掘）

平台首个通用 AI-work：`lead-discovery`（客户线索挖掘）。它作为**产品**发布在平台 AI-work 产品库中；实例化时必须绑定**企业产品库中的精确产品版本**（`productId` + `revision` + SHA-256），计划中的品类、SKU、MOQ、交期与供货条件只来自产品库，缺项标记不编造。委托生成开发计划与不可变计划书工件，从不调用模型。审批后可导入**客户授权线索**（CSV/JSON，逐行证据校验 + 去重 + 规则评分），或在配置 `SERPER_API_KEY` / `COMPANIES_HOUSE_API_KEY` 后按计划 query **自动搜索公开网页/英国公司登记**（结果只作为带来源与摘要的候选，进入人工审核）；随后生成**未发送开发信草稿**并审批。配置 `OUTREACH_PROVIDER` 后，管理员可逐封发送已批准草稿（受占位符、退订/抑制、同意记录约束）；默认未配置，草稿保持未发送。

| Method | Route | Role | Action |
|---|---|---|---|
| GET | `/api/ai-works` | member | 已发布 AI-work 产品目录 + 注册表状态 |
| GET | `/api/ai-works/status` | member | 产品/委托/候选计数、数据源可用性、产品库是否接入 |
| GET | `/api/ai-works/:id` | member | 单个产品定义（含 inputSchema/workflow/交付物/验收） |
| POST | `/api/ai-works` | admin | 发布产品（首次创建或 `expectedRevision` 版本升级；`requestId` 幂等） |
| POST | `/api/ai-works/:id/delegations` | operator/admin | 建立开发计划委托（校验输入、读取产品库精确版本、生成计划、保存计划书工件） |
| GET | `/api/ai-work-delegations` | member | 委托列表 |
| GET | `/api/ai-work-delegations/:id` | member | 委托详情（含计划、产品版本钉住信息、执行状态、计划书工件） |
| GET | `/api/ai-work-sources` | member | 数据源可用性（`authorized_import` 始终可用；`serper`/`companies_house` 配置 API key 后为 available） |
| POST | `/api/ai-work-delegations/:id/candidates` | operator/admin | 导入客户授权线索（CSV/JSON；逐行校验、域名/公司去重、规则评分；64 KiB / 100 行上限） |
| GET | `/api/ai-work-delegations/:id/candidates` | member | 候选线索列表（证据、fitScore、审核状态） |
| POST | `/api/ai-work-delegations/:id/execute` | operator/admin | 执行：已配置自动源时按计划 query 搜索（每 query ≤10 条，最多 3 query/源）；否则使用已导入线索；无输入返回 `awaitingSource:true`；全部查询失败 → `failed` + `lastError`，不伪造候选 |
| POST | `/api/ai-work-candidates/:id/review` | operator/admin | 人工审核 `qualified`/`rejected` + 理由（≥2 字，幂等） |
| POST | `/api/ai-work-candidates/:id/drafts` | operator/admin | 合格线索生成**未发送**开发信草稿（语言 en/de，默认目标市场语言；证据引用；签名/退订占位） |
| GET | `/api/ai-work-delegations/:id/drafts` | member | 委托下的草稿列表 |
| GET | `/api/ai-work-drafts/:id` | member | 草稿详情（subject/body/证据/合规/警告/状态/发送回执） |
| PATCH | `/api/ai-work-drafts/:id` | operator/admin | 编辑待审批草稿（替换占位符；revision+1，需重新审批；已发送不可编辑） |
| POST | `/api/ai-work-drafts/:id/approve` | admin | 审批草稿（`confirmed:true`；审批本身不发送） |
| POST | `/api/ai-work-drafts/:id/reject` | operator/admin | 拒绝草稿（理由 ≥2 字；可重新生成 revision+1） |
| GET | `/api/ai-work-outreach` | member | 外发通道 readiness（provider/from；未配置时发送 503）+ 发送统计（sent/attempts/failedAttempts/suppressions/lastError）+ 失败草稿列表（最多 20） |
| POST | `/api/ai-work-drafts/:id/send` | admin | 发送已批准草稿：需 provider 已配置、占位符已替换、HTTPS 退订链接、未抑制；德国等需 `consentConfirmed:true`+`consentBasis`；provider 接受后才 `sent:true` |
| GET | `/api/ai-work-delegations/:id/export/candidates` | member | 候选 CSV（UTF-8；含来源 URL/摘录/评分/状态，行数受上限保护） |
| GET | `/api/ai-work-delegations/:id/export/drafts` | member | 草稿 CSV（含语言/revision/状态/sent/回执/provider messageId/主题） |
| GET | `/api/ai-work-delegations/:id/events` | member | 该委托审计事件（最近 100 条，倒序；JSON） |
| GET | `/api/ai-work-delegations/:id/export/events` | member | 该委托审计事件 CSV（eventId/type/at/actor/detail） |
| GET | `/api/ai-work-suppressions` | member | 退订/抑制名单 |
| POST | `/api/ai-work-suppressions` | admin | 新增抑制（`email` 或 `domain` + `reason`） |
| POST | `/api/ai-work-suppressions/:id/remove` | admin | 撤销抑制 |

外发环境变量（服务端，不写入前端）：`OUTREACH_PROVIDER=resend|postmark`、`RESEND_API_KEY` 或 `POSTMARK_SERVER_TOKEN`、`OUTREACH_FROM_EMAIL`（必填）、`OUTREACH_FROM_NAME`/`OUTREACH_REPLY_TO`（可选）；`AI_WORK_DUAL_APPROVAL=true` 时审批人与发送人必须是不同 admin。未配置时草稿保持未发送，`send` 返回 503 `OUTREACH_NOT_CONFIGURED`。
| POST | `/api/ai-work-delegations/:id/approve` | admin | 审批开发计划（`confirmed:true` + `requestId`，一次审批可安全重试） |
| POST | `/api/ai-work-delegations/:id/cancel` | operator/admin | 取消 draft 委托 |

创建委托示例：

```json
POST /api/ai-works/lead-discovery/delegations
{
  "requestId": "stable-request-id",
  "productId": "企业产品库产品 UUID",
  "targetCountry": "美国",
  "buyerType": "进口商",
  "targetCount": 50,
  "deadlineDays": 30,
  "notes": "首批优先有进口记录的经销商"
}
```

响应包含 `delegation.plan`（市场/买家画像/搜索 query/数据源/工作流/交付物/验收/风险/合规提示）、`delegation.productRefs`（field/productId/revision/sha256）、`planHash` 与 `artifactId`。产品库为空时先通过 `/api/library/products` 建立产品；产品被归档或不存在时分别返回 `PRODUCT_ARCHIVED` / `PRODUCT_NOT_FOUND`。
