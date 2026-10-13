# Pi native Agent execution

Backend branch base: PR60 `06e5c51daa66a76c0f736126dab26ee1a551dae0`. Existing backend fixes are selectively retained from PR62 backend source `c99dd31d0715077cc4f93c38d723f45718116f29`; no PR62 UI, screenshots or dependencies are included. Main is unchanged.

Pinned official packages: pi-agent-core / pi-ai / pi-durable / chord 1.1.0, upstream source `abe508e1b89912adde45528136c3221eb69acdd7`. The installed Agent supports prompt, native tool loop, awaited event subscribers, beforeToolCall/afterToolCall, prepareRequest, finishTurn, abort and waitForIdle. The Durable Harness supports registered custom tasks, persisted memos, original ToolTask intent and replay safety, JSONL fsync, explicit scheduling and abort ownership.

Previously, `Agent` only canonicalized context and Workspace scheduled model continuation through JSON `done`/`nextStep`. The provider now awaits the actual official `Agent.prompt` loop inside the existing Harness task registry. Workspace retains admission, budget reservations, identity, exact approvals, audit and business task authority. No engine, scheduler, database or cross-platform connector protocol is added.

## Execution and recovery contract

- `workspace.pi-agent-prompt` is one original conversation-owned Durable task. Actual `Agent.prompt` executes the native model/tool loop. Progress and output identify `piNativeTaskId` / `runtime.execution: agent-prompt`; they do not relabel it as a submission.
- The task memoizes confirmed complete model responses before exposing native tool intents. Each tool intent is persisted as an `AssistantEntry`; the existing `ToolTask`, schema checks, replay policy, hooks, owned cancellation and `ToolResultEntry` remain authoritative. Recovery reuses completed tool receipts and only dispatches an unconfirmed model round within its remaining reservation.
- The original `ProviderDoc.sessionId` supplies model affinity across rounds, later turns and restart. JSONL uses `fsync: true` under the original exclusive Store writer lifetime. Reopening does not auto-resume; the existing explicit recovery operation reattaches the same run, reply, request and task.
- Native result accounting binds `reply.providerResultAccounted` to the original completed task in the same Store commit as usage, output budget and business step count. Recovery with that marker must obtain the same cached terminal task; it cannot issue a model request, acquire new quota or count the stage again. The original saved reservation remains valid even after the budget is exhausted.
- Pre-upgrade records containing a real `submissionId` keep the original `Harness.submit` recovery path, execution descriptor and identity. No task is disguised as a legacy submission.
- Native completion ends one Workspace invocation. Text or JSON cannot execute an action or schedule another model call. The original proposal tool pauses for exact approval and explicit continuation; native Goal text enters `review_required` and does not certify business success.
- The existing maximum four model requests share one invocation's output allowance. Business `maxSteps` continues to count admitted document stages, not individual native tool/model rounds. Unknown usage consumes its full issued ceiling. Host timeout and cancellation abort the actual provider signal; shutdown preserves checkpoints.

No generic shell, filesystem, HTTP, browser or arbitrary connector tool is installed. Selected inputs retain their original ID/version/SHA verification. Existing member, endpoint, source, role and recipient guards apply on dispatch, recovery and tool execution.

Cross-platform Muse/Dot claim, lease, acknowledgment and ingress protocols are preserved. Private Library access/exfiltration limits remain. Real Pi package execution, controllable faux model transport and real-model E2E will be reported separately. No credentials, runtime stores, live/paid calls, deployment, main merge or force push are authorized.

## Evidence boundaries

Real package execution means the installed pinned `Agent`, `Harness`, owned tasks, JSONL storage and Store were actually invoked. The local model transport is the official controllable, keyless faux provider; its counters and deterministic replies are synthetic evidence. Test child processes are actually killed with `SIGKILL`, then reopened through the original application and explicit recovery path.

Actual-model end-to-end execution has not been attempted. This round prohibits live/paid calls, and no separately authorized usable model configuration was provided. No real key or `.env` was read, injected, requested or created; this is not evidence that a production credential is missing or a model account is connected.

Validation results and inspectable command receipts will be recorded after the frozen source passes the independent suite. The first targeted run on `42673468c2d25f9723f324951fe4597ade99fb62` had 63 passes and one failed recovery assertion; it is retained as failed evidence, not acceptance.
