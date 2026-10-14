> 原Pi1.1.0显式回退指南及历史验收。当前默认OMP入口见 [Workspace OMP](WORKSPACE-OMP.md)；这里的私库／旧采购能力不自动进入OMP。

# Development Agent: original task lifecycle

`npm run agent:pi` uses the same official Pi AgentSession, Workspace extension, original authenticated task APIs, Runtime and Store as before. This slice connects human lifecycle controls. It adds no business engine, model loop, queue, account or permission. The original business presets, submission and status tools remain; the later [built-in read plugins](PI-BUILTIN-BUSINESS-PLUGINS.md) add bounded task/result reads and controlled Library read tools that remain unconfigured by default. Models have no approval, continuation, cancellation or recovery tool.

## Two original task identities

Business presets are document stages under `/api/agent/v1/tasks/{taskId}`. They have no external connector grants or approval state. A source-checked stage tool produces documents, and `documents_ready` still leaves `businessGoalAchieved: false`. Do not invent an approval/transaction step for these tasks.

Generic Pi tasks use `/api/agent/v1/pi/tasks/{runId}`. Their explicitly selected original connector grants can produce a proposal. The same member must inspect the exact proposal, approve it through the original approval bridge, and separately request continuation under the original remaining budget. An Agent service binding does not confer external Muse owner Session authority. External Personal Worker reuse is audited separately in [PI-PERSONAL-WORKER-NEXT.md](PI-PERSONAL-WORKER-NEXT.md).

## Human commands in agent:dev

| Command | Actual original operation |
| --- | --- |
| `/ws-approve RUN_ID PROPOSAL_ID` | Read and display the exact proposal; only visible confirmation sends the original decision. Approval alone executes nothing. |
| `/ws-continue RUN_ID PROPOSAL_ID STABLE_REQUEST_ID` | Display the exact proposal, budget and request ID; only confirmation calls the original continuation API. The backend rechecks approval/grants, deduplicates the same key and reserves its original budget. |
| `/ws-cancel RUN_ID` | Read the original run and ask for confirmation before its original Runtime cancellation. |
| `/ws-resume RUN_ID STABLE_REQUEST_ID` | Confirm reattachment of an interrupted original Pi checkpoint. It preserves the original input/submission; completed, failed or uncertain-action runs do not become new tasks. |
| `/ws-business-cancel TASK_ID` | Read and confirm cancellation of the original business task and active stage. Preserve published documents and consumed budget; no replacement task or implicit recovery. |
| `/ws-business-resume TASK_ID STABLE_REQUEST_ID` | Read eligibility, then confirm the unchanged original task recovery. The request ID is persisted on that original task; repeated requests cannot create another attempt, submission or settlement. |

Keep the same request ID when a response is uncertain. Generic runId and business taskId cannot be substituted. Canceling any confirmation sends no control POST. A frontend Esc aborts its current model turn; it is not a backend business cancellation. The retained `agent:tui` compatibility profile keeps its prior syntax and behavior; explicit request IDs and the extra generic confirmation controls above apply to `agent:dev`.

## Business API and cancellation fence

`POST /api/agent/v1/tasks/{taskId}/cancel {}` is member-owned and requires the original `agent:submit` scope/role. It commits terminal `status: cancelled`, `result.state: cancelled`, `completion: incomplete`, `resumable: false` and the original cancellation event. It waits for already pending admission to settle behind the task fence, invokes the original Runtime cancellation for active stage runs, then projects the result. Repeated cancellation reads the same original terminal record. Done/legacy or non-resumable stopped tasks reject cancellation; no completion is rewritten.

The cancelled task fence prevents stale coordination from marking it running and prevents new stage admission. Existing published documents stay immutable. The SSE stream and original Python client now recognize cancelled as terminal. A cancellation does not undo an external action already admitted in a generic connector task; original receipts, uncertain outcomes and reconciliation boundaries remain authoritative.

`POST /api/agent/v1/tasks/{taskId}/resume {"requestId":"stable-id"}` adds only optional idempotency metadata to the existing recovery path. The compatible empty body remains accepted. Original ownership, input/model/permission checks, one-time UI approval route, budget and interrupted run/submission are retained. A repeated key returns the task's current receipt, even after completion/restart, without implying another recovery. A new key cannot recover a non-resumable cancelled/completed task. No failed stage is silently rerun as a replacement.

When an interrupted Pi run exists, recovery reattaches that same run/submission. When setup or required capabilities stopped a stage before any run was admitted, compatible recovery may admit that original pending stage after the missing condition is resolved; this is not proof that a Pi checkpoint existed. A failed native run without a recoverable checkpoint remains blocked.

## Acceptance and limits

Tests use the installed official Pi 1.1.0 SDK, real loopback HTTP, original Store/JSONL and actual official POSIX PTY confirmations. Frontend models are explicitly injected unused/faux; backend responses are finite, source-checked synthetic faux. These checks prove protocol, control and persistence, not real-model reasoning, external connectivity or business success.

```sh
node --test test/agent-business-lifecycle.test.mjs test/pi-workspace-lifecycle.pty.test.mjs
python3 test/agent-client.test.py
```

The new checks cover cancelled dialogs with zero POST, approval without execution, stable continuation with one exact local test artifact, running-stage cancellation, pending-admission cancellation race, member/read-only denial, actual restart and original checkpoint/document hashes, concurrent stable recovery, replay after completion/restart without additional native reservations or settlement, and cancelled stream termination. The main Agent configuration still fails explicitly when missing, with no sample fallback. Safe model/service presence flags remain false in this selected environment; no real key was read or copied. Paid model calls remain zero, and the later CNY5 test ceiling still requires safe configuration and an enforceable budget.

Compact result counts, checksums and retained test-fixture failures are recorded with the final source in `docs/validation/pi-lifecycle-20261014/acceptance.json`. Raw terminal transcripts, generated documents, runtime stores and credential profiles are excluded from Git. PR66 frontend and main remain unchanged; this is a private development Draft PR checkpoint.
