# Pi business conversation adapter

Date: 2026-10-14. This document records the source audit, minimal integration contract and native synthetic acceptance below. The adapter's native suite passes; broader original regressions and independent integration review are separate gates. Configuration, admission, a model answer, and document completion are separate facts.

## Pinned sources and scope

| Source | Fixed commit | Role |
| --- | --- | --- |
| PR65 | `1fe5bbbff9d7c1f1ceb9cf13c1f9da790b86e37d` | Original Workspace Runtime, Pi Durable, official Pi coding-agent frontend and business plugins; implementation base. |
| PR66 | `0a31b327d4f074ea67347ba3b318dfc769aa537f` | Read-only frontend contract audit; no frontend changes included here. |
| PR67 | `a5f1f5985df13c7520ae2c250a4344663a39eec7` | Read-only ThreadHarness audit; no synchronization, merge or wholesale adoption. |

The work starts from PR65 on an isolated branch. This integration accepts explicitly supplied public text and uses already authorized host bindings. It does not configure a model account, mint credentials, activate private Library access, run a live model, dispatch an external Worker, execute a purchase/publication, or require a TaskGraph.

## Audit: one execution authority

PR67 reuses the original Store, original access Session checks and PR65's official `createWorkspaceAgentRuntime`. Its business tools still call the existing authenticated task APIs. It is therefore inaccurate to describe PR67 as replacing the procurement coordinator or introducing a second business-task engine.

It nevertheless adds a second conversation execution authority:

| PR67 source | Observed responsibility | Existing authority to retain |
| --- | --- | --- |
| `server/thread-harness/core.mjs:343–375` | Own `messages`, `turns`, command receipts, turn admission and asynchronous jobs with a host concurrency limit. | `server/runtime.mjs:700–743`: original messages, runs, request deduplication, admission and queue. |
| `core.mjs:377–432`, initialization and close | Own cancellation, transcript reopening, epoch fencing and interrupted turn state. | Original Runtime run cancellation/recovery; original business coordinator cancellation/resume for admitted tasks. |
| `server/thread-harness/http.mjs` | Blocks original message, cancel, reset and Goal mutations for managed records; filters those conversations out of bootstrap. | Original conversation lifecycle and original access boundary. |
| `core.mjs:300–341`, `455–477` | Graph registry and revisions participate in thread creation and projection. | Conversation context and read projections suffice for this single-business mode. |
| `server/thread-harness/pi-session.mjs` | Supported official SDK factory, exact transcript identity, guarded client and model calls. | Reuse the SDK and applicable isolation/fencing ideas without importing the turn registry. |

PR67 cancellation explicitly reports `backendTasksCancelled:false`; reopening reports `checkpointResumed:false`. Those are useful distinctions. They do not solve the extra Run/Message ownership boundary.

The adapter instead keeps these responsibilities:

- **Thread:** the original Conversation plus owner/context metadata and the official SDK session mapping. No separate turn, message, command, graph or job registry.
- **Run and Message:** the original Runtime alone admits, deduplicates, persists, queues, cancels and settles them.
- **Frontend model loop:** official Pi `AgentSession`, invoked through the existing provider `complete()` contract only for an explicitly admitted business conversation.
- **Business task and stages:** the original Agent coordinator; stages continue to invoke the original Runtime and original Pi Durable provider.
- **Tool receipts, checkpoint recovery and business budget:** existing original task/Runtime/Pi receipts, not a projection-owned state machine.
- **ExecutionRef:** derived references to original runs and their recorded SDK/Pi execution identities. No additional executable GraphRun is created to represent the same work.
- **Results/events:** owner-checked read projections of original task, stage, run and deliverable records. An event display is not execution authority.

## Existing business path

PR65 `scripts/pi-workspace-agent.mjs` creates the official coding-agent runtime with an explicit model runtime, explicit SessionManager and the original Workspace client. `pi/extensions/workspace.mjs` registers the business tools; `workspace-read.mjs` adds the existing read tools. The Agent profile has eight admitted tools: business presets/task/status, company profile, products/product, business tasks/result. Approval, continuation and lifecycle controls are not model-callable tools.

The path is:

```text
Original Conversation and original frontend Run
  -> official Pi AgentSession
  -> existing workspace_business_task plugin
  -> original authenticated Agent task API / procurement preset
  -> original Agent coordinator
  -> original Runtime stage Run
  -> original Pi Durable Agent / ToolTask receipts
  -> original task deliverables
  -> owner-checked conversation result projection / human review
```

The coordinator in `server/agent/engine.mjs:213–217` submits stages through `runtime.sendMessage`; its explicit recovery path invokes `runtime.recoverPiRun` on the same interrupted original run. A frontend answer that acknowledges admission does not certify that stages or business goals completed. Existing task results retain `businessGoalAchieved:false`.

## Canonical HTTP contract

All routes use the original server and original access Session, role, Origin, CSRF and signed-ingress checks. `/api` is shown explicitly below; the frontend's existing `api()` helper supplies that prefix.

| Route | Contract |
| --- | --- |
| `POST /api/conversations` | Original conversation creation. Host opt-in associates `businessAgentOwner` metadata with the original actor; the browser cannot supply a credential or select another owner. |
| `POST /api/conversations/:id/messages` | Original Runtime admission using `content`, stable `requestId`, `workspaceExecution`, and only an empty public `inputContext`. No selected artifacts, skills, memories or connector grants. |
| `GET /api/conversations/:id` and its original message read | Existing conversation/message reads; keep original Run/Message IDs and recorded statuses. |
| `POST /api/conversations/:id/cancel` | Existing stop-answer control. Stops the original frontend run only; already admitted business tasks retain their own lifecycle. |
| `GET /api/conversations/:id/business-results` | New read projection of associated original task IDs, stage/run receipts, events and authenticated task deliverable references. A model summary does not replace these records. |
| `POST /api/conversations/:id/business-tasks/:taskId/resume` | Human-only continuation: `{ "requestId": "stable-human-resume-id", "confirmed": true }`. Verify original actor, conversation/task association and current resume eligibility, then invoke the original business resume authority. |
| `GET /api/conversations/:id/task-graph` | Optional compatibility read. Single-business mode may return `{ "taskGraph": null }`; graph creation is not an admission requirement. |

The empty context uses the existing shape: `{ "artifacts": [], "skills": [], "memoryIds": [], "connectorActions": [] }`. Omission may use the same empty default. Nonempty selections must fail before model/tool dispatch for this public mode.

Result projection does not grant access to unrelated tasks. Task association must come from an authenticated original receipt and the current original task ownership; a user/model-supplied task ID alone is insufficient. Missing, unavailable, interrupted and partial results remain explicit. Reads and page refreshes do not start or recover execution.

## Host wiring and provider boundary

The original app's optional `businessAgentOptions` supplies an exact reviewed `recipient` and trusted `resolveBinding`; its default is `null`. It adds no implicit service token, model account or client fallback. The resolver receives the original Session actor, and the existing client's authenticated identity read must match that actor's member/workspace and the current original application's already existing instance ID. Revalidate the original Session and member/client/model destination before model calls, tool operations and transcript reopening. Never persist raw credentials in Conversation, Run, transcript metadata or API results.

The saved `businessAgentSession` associates the SDK session ID/file with both the original service `bindingFingerprint` and exact `recipientFingerprint`. A restarted Host may not reinterpret that transcript under a new provider/model/destination, even if the member and service token remain the same and the new Host recipient matches its newly supplied model. Reject the changed recipient before SDK creation or exposing cached context to a new model; a new receiver requires a new conversation.

Persist `businessAgentContext` on the original admitted Run. The opt-in provider adapter dispatches `complete()` to the official frontend only for that explicit context; ordinary chat/Goals and original business, supplier and Muse stages retain the original Pi Durable path. Preserve original provider initialization, authorization bindings, recipient and execution fingerprints. Delegate using the original provider object as `this`, because its `complete()` checks `this.configured`.

The reusable PR65 TUI factory currently mutates process-global `PI_CODING_AGENT_DIR` and `PI_OFFLINE`. PR67 removes those two mutations while retaining explicit resource paths/settings/model runtime. Reuse that narrow fix for concurrent web sessions; do not copy its registry or HTTP interception.

Frontend limits are four model requests with at most 400 output tokens each. Their 1,600-token total fits the original Runtime's pre-dispatch 1,600-token reservation. Disable retry, compaction and cache warming using the existing official settings. Bound before each request, retain conservative original accounting on uncertainty, and report observed usage honestly. Missing usage is unknown, not zero.

The frontend result returns a final `done:true` content envelope through the original provider contract. Its runtime metadata identifies `agent-session` and the recorded SDK session identity. It must not invent a Pi Durable `nativeTaskId`, emit a false `pi.agent.task` receipt, or return `agentLoopComplete:true`: original `server/runtime.mjs:204–215` binds that flag's result accounting to an actual completed Durable task identity.

An interrupted frontend turn is not an original Pi Durable checkpoint. Reject automatic uncertain frontend recovery and ordinary retry paths that would replay its prompt or resubmit a business task. Preserve the original transcript and admitted task references for inspection. Human confirmation can resume an eligible **original business task**, under that task's unchanged original authority and budgets. Stopping a frontend answer does not cancel such a task.

## Original Artifact and task deliverable semantics

There are two existing storage contracts:

1. Generic generated outputs use `server/run-output.mjs` and the original Artifact service. They have actual `artifactId`, version/hash and `sourceRunId`/`sourceConversationId` provenance. Publication checks the active original run.
2. Procurement documents are generated by `server/agent/engine.mjs:35–50` into the original task's immutable `deliverables`. The original AgentStore projection publishes them through `/api/agent/v1/tasks/:taskId/artifacts/:name`; its `readArtifact` verifies bytes and SHA-256. The original business plugin retrieves those exact authenticated text documents and records task/name/hash sources.

A procurement filename or task ID is not a global Artifact ID. The new result projection references the existing task deliverable directly; it does not copy it into the global Artifact service to satisfy a card type. A frontend receipt answer is also not the authoritative procurement document. A subsequent frontend implementation must support task deliverable references separately from genuine global Artifact references.

The owner-checked business-results JSON includes verified original document text. Render that content as text, or with the UI's safe Markdown renderer; treat it as document data and do not execute raw HTML. For a browser download, create a UTF-8 text/Markdown Blob from the verified receipt content and its original filename. Keep the original task/name/hash citation alongside it. The receipt's `/api/agent/v1/tasks/:taskId/artifacts/:name` source URLs describe the authenticated service API; they require the original Bearer client and are not ordinary browser download links. Do not expose a Bearer token in browser state, URLs or download handlers, and do not create a replacement global Artifact to work around authentication. The existing UI read module remains opt-in/default-off.

## Differences from the fixed PR66 frontend

These findings come from PR66 **`0a31b327d4f074ea67347ba3b318dfc769aa537f`**, not the earlier frontend reference `6b3860ec…` recorded in PR67's acceptance document.

| Fixed PR66 behavior / source | This integration and frontend handoff |
| --- | --- |
| `taskGraphClient.ts:38–60` reads `task-graph`; null becomes `empty`, unsupported source becomes unavailable. `App.tsx:493–499` clears the displayed graph when it is not ready. | Returning null works as an ordinary-conversation empty state. Add business-results reading independently; do not require a workspace graph to start or show results. |
| `taskGraphClient.ts:77–97` prefers `/threads/:id/messages` when thread/harness IDs exist; only HTTP 404 falls back to that thread's own Conversation. | The canonical send is the original Conversation route. Single-business mode supplies no invented graph thread/harness IDs. Keep the active Conversation ID. |
| `App.tsx:730–745` sends `inputContext` and `workspaceExecution`; retains a stable request ID for the same pending input. | Reuse stable send IDs, but constrain this mode to empty public context. Existing general selection UI does not itself authorize this adapter's private-input access. |
| `taskGraphClient.ts:75` documents original conversation cancellation as stop-answer; PR66 docs distinguish business-thread cancellation. | Stop-answer is compatible. New confirmed business resume uses the original task route; do not call `/threads/:id/resume` or generic graph controls. |
| `taskGraphContract.ts:169–221` specifies a separate Thread/HarnessSession/GraphRun, and ExecutionRef IDs distinct from GraphRun IDs. | No second GraphRun is implemented here. Thread is original Conversation context; ExecutionRef is a read reference to the sole original run's recorded execution. Future graph support must not duplicate execution ownership. |
| `taskSessions.ts:17` exposes four display states; its richer contract separately describes cancelled/failed/interrupted lifecycles. | Results should retain original task/run lifecycle and partial/error information instead of presenting every terminal state as completed or blocked. |
| `taskSessions.ts:60–64` and `ProcessTimeline.tsx:136–145` attach workspace cards using genuine global `artifactIds` and lookup in `Artifact[]`. | Task deliverables need a distinct read-only result/card reference. Do not fabricate an `artifactId` from taskId/name. |
| `taskGraphClient.ts:18–26,52–57` allows demo graphs only in DEV with an explicit showcase flag. `ensureInquiryRecoveryArtifacts` has no product-shell caller at this fixed commit. | Preserve the existing absence of production demo seeding. Do not claim the fixed PR66 still auto-creates demo artifacts on a production 404. |
| PR66 describes `process.event`/graph revisions and graph controls in its contract. | This adapter projects original run/task events. It adds no graph SSE protocol, graph revision counter, node scheduling or graph control executor. |

No frontend or PR67 source is edited by this document. A frontend owner can wire ordinary Conversation messages, a separate business-results read, direct original deliverable opening, and a visible confirmation before the task resume POST. An API error remains an error/empty state rather than an example result.

## Verification evidence and pending gates

PR67 `docs/PI-THREAD-HARNESS-ACCEPTANCE.json` records Node 22.16.0, `piSdkInstalled:false`, `completeRepositoryCheckout:false`, and `ERR_MODULE_NOT_FOUND: @earendil-works/pi-ai`; zero native assertions ran. Its M0 document also records unsuccessful npm/GitHub DNS access. That is evidence of missing prerequisites in the earlier incomplete host, not a proven SDK incompatibility.

On the current host, a read-only import probe using the existing cached dependencies succeeded on Node **24.19.0**. It loaded `@earendil-works/pi-coding-agent`, `@earendil-works/pi-ai/providers/faux` and `@earendil-works/pi-durable`; SessionManager, ModelRuntime, createAgentSession, createAgentSessionRuntime, fauxAssistantMessage and Harness exports were present. Installed public declarations support the exact SessionManager and AgentSession APIs audited above. This probe is not a passing integration gate or a fresh-install claim.

After resolving those prerequisites, the root ran the actual fixed PR67 gate on a detached checkout at `/tmp/workspace-thread67-native-audit` with Node 24 and the cached full SDK:

```sh
node --test test/thread-harness.pi-integration.mjs
```

Result: **one passed, one failed**. The official-session test fails at line 42 because the recorded turn is `failed`, not `succeeded`; the unconfigured app test passes. A disposable synthetic reproduction that wrapped the session factory to expose its original error diagnosed the failure before any faux model call: `pi-session.mjs:57–61` creates a Proxy over `binding.client` and returns new function wrappers, but PR65 `createWorkspaceClient` returns `Object.freeze(...)` at `pi/extensions/workspace.mjs:155`. Returning a different value for the frozen target's non-configurable, non-writable `check` property violates the JavaScript Proxy `get` invariant. `createWorkspaceAgentRuntime:52` then throws `TypeError`; the host sanitizes it to `TURN_FAILED`. No PR67 source was edited. The new adapter must guard an explicit facade or bound-method object rather than proxy the frozen client target.

PR67's provided native gate covers isolated transcripts/reopen, an unconfigured `workspace_products` read, and an unconfigured app. It explicitly asserts no original business tasks. Even a repaired passing gate would not establish procurement execution or document linkage.

Adapter acceptance expectations, using explicit public synthetic fixtures and official pinned SDK packages:

- Natural public input goes through the actual official plugin to one original procurement task; stage IDs identify original Runtime runs and documents match authenticated original deliverable bytes/hashes.
- One authoritative frontend Run/Message set; no `workspaceThreadHarness` turns/messages/commands/graphs/jobs truth. Identical send IDs do not duplicate admission; conflicting input is rejected.
- Original Session/client member mismatch, expired permission, nonempty context and changed recipient fail before dispatch. Library remains unconfigured without an existing reviewed binding.
- Four 400-token frontend calls respect original reservation; request five is blocked, and abort/uncertainty cannot claim a completed response or reset budget.
- Frontend stop cannot finish late or cancel/recover an admitted business task; frontend restart/uncertain retry does not replay. Original task resume requires explicit human confirmation and preserves original recovery receipts.
- Optional task-graph null does not block ordinary messaging/results. Missing or partial documents never become demo cards or synthetic global Artifact IDs.

### Executed adapter native gate

On 2026-10-14, Node 24.19.0 with the existing pinned official SDK dependencies:

```sh
node --test test/pi-business-conversation.native.test.mjs
```

Result: **10 passed, 0 failed, 0 skipped**. The test file invokes the actual official AgentSession and original plugin HTTP routes with finite keyless faux frontend/backend model transports. Its primary evidence is the public composer dispatching `workspace_business_task` into one original procurement task, four original Pi Durable stage runs and three authenticated documents whose SHA-256 values match the original task deliverables. A subsequent actual `workspace_business_result` tool call reopens the same SDK session and reads that task. The original Store has one frontend run plus four stage runs, no duplicate ThreadHarness registry, and no global Artifact copies.

Additional native cases verify two concurrent conversations with isolated official transcripts and exact reopening; read-only intent refusing native business submission; nonempty public input selections, other-member reads and mismatched authenticated clients failing; original signed-body alteration and browser Session revocation preventing admission/tool dispatch; four 400-token requests and a blocked fifth with conservative original reservation; and frontend stop retaining an already running original business stage while rejecting frontend checkpoint recovery/retry.

The recipient-change case first persists a real official SDK transcript, closes the app, and reopens the same original Store with the same loopback origin/token but a different exact Host recipient/model tuple. Both message admission and business-results access return `403 BUSINESS_AGENT_RECIPIENT_CHANGED`. It verifies zero SDK model lookups, zero frontend/backend model calls, unchanged original Run/Message counts and unchanged transcript bytes/mapping. An unbound existing client credential is also rejected with `403 BUSINESS_AGENT_BINDING_UNAVAILABLE` before admission.

The restart case closes the actual original application with the third business stage running, reopens the same original Store and loopback service binding, and observes an interrupted original task with zero automatic model calls. Two concurrent confirmed resume requests reuse the same interrupted stage run/request ID, original budget and earlier document hash; only the two remaining backend stages call the faux provider. The frontend makes zero model calls during these result/resume operations. Reads and repeated stable resume IDs add no replacement task or run.

This is native SDK/original enterprise access validation with signed loopback synthetic fixtures, not deployed ingress, live model connection, private-data access, external action or business-achievement proof. Broader original regression coverage and independent review remain separate; do not generalize this scoped native pass into production acceptance.

The adapter refuses to activate against a nonempty old alpha `workspaceThreadHarness` registry. Those records remain unchanged; no automatic adoption, second execution-state synchronization or destructive migration is performed. This is an explicit compatibility boundary for existing alpha data, not a TaskGraph prerequisite for fresh original Workspace conversations.

The shared official session factory no longer changes global discovery settings. Dedicated terminal entry processes and PTY fixtures supply their own isolated `PI_CODING_AGENT_DIR` and `PI_OFFLINE`; actual terminal regressions were rerun after this relocation. Official plugin progress metadata is projected into the original Run events (tool name and hashed call ID only), never a second event registry or raw tool arguments/results.

The public Web composer accepts plain text, not terminal slash commands. Explicit Web continuation uses the confirmed task-resume route; the existing terminal retains its human commands. A handled command or cached old answer cannot be recorded as a newly completed SDK answer.
