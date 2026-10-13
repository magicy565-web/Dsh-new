# Pi native Agent execution

Backend branch base: PR60 `06e5c51daa66a76c0f736126dab26ee1a551dae0`. Existing backend fixes are selectively retained from PR62 backend source `c99dd31d0715077cc4f93c38d723f45718116f29`; no PR62 UI, screenshots or dependencies are included. Main is unchanged.

Pinned official packages: pi-agent-core / pi-ai / pi-durable / chord 1.1.0, upstream source `abe508e1b89912adde45528136c3221eb69acdd7`. The installed Agent supports prompt, native tool loop, awaited event subscribers, beforeToolCall/afterToolCall, prepareRequest, finishTurn, abort and waitForIdle. The Durable Harness supports registered custom tasks, persisted memos, original ToolTask intent and replay safety, JSONL fsync, explicit scheduling and abort ownership.

Previously, `Agent` only canonicalized context and Workspace scheduled model continuation through JSON `done`/`nextStep`. The provider now awaits the actual official `Agent.prompt` loop inside the existing Harness task registry. Workspace retains admission, budget reservations, identity, exact approvals, audit and business task authority. No engine, scheduler, database or cross-platform connector protocol is added.

## Architecture assessment

This is **Workspace orchestration with a real Pi Agent execution kernel**. It is not yet a complete Pi-host architecture in which Workspace exists only as tools/plugins and policy extensions. `server/runtime.mjs:109` still calls `provider.complete`, and the business coordinator still submits stages through the original Runtime. Calling `Agent.prompt` proves that model/tool continuation is native; it does not prove that all application orchestration was removed. This branch meets the native-execution requirement while leaving the broader simplification goal partially open.

| Retained application loop | What it does now | Necessity and simplification boundary |
| --- | --- | --- |
| Runtime queue pump (`server/runtime.mjs:230`) | Admits original persisted runs within concurrency limits after scope checks | Existing enterprise authority required for this scope; no second Pi admission queue was added. It can become a thinner host policy boundary in a separately scoped migration, not be dropped with its controls. |
| Runtime chat/Goal `while` branches (`server/runtime.mjs:350`, `:428`) | Native results end one invocation or pause at original approval. Legacy/direct-provider results still use JSON continuation. | The old continuation branches are no longer needed for fresh native Pi runs. They remain for compatibility and real saved submissions; a later migration can split or remove them after preserved legacy state is accounted for. |
| Business stage reconciliation (`server/agent/engine.mjs:110`, `:222`, `:237`) | Responds to Store changes, advances deterministic preset stages, projects deliverables and permits only explicit interrupted-run recovery | It remains an application workflow controller, not just an Agent tool. Original business authority is necessary, but the implementation is a candidate to express as a thinner Pi extension/workflow with the same stable stage IDs, approvals and budgets. No such migration was performed here. |
| Governed model stream iteration (`server/pi-provider.mjs:156`) | Reads provider events, verifies usage and enforces transport timeout | This is transport/policy enforcement, not a second reasoning/tool scheduler. The policy must remain; duplicate adapters could be reduced in a Pi-host refactor. |
| Registered `workspace.pi-agent-prompt` task and response memos (`server/pi-provider.mjs:296`) | Hosts actual Agent.prompt and reuses original durable tools/checkpoints on restart | Required by this adapter's crash-recovery contract. It uses the same Harness and JSONL, but is still custom integration code and must not be marketed as an unmodified Pi turnkey session system. |

Optional JSON text/artifact envelopes and the `provider.complete` façade are further simplification candidates. Removing them would require a clear Pi-host/tool contract and preserved artifact/approval/recovery behavior. These candidates were audited and reported, not implemented as additional scope. Identity, private Library restrictions, exact external-action approvals, budgets, audit and Muse/Dot protocols must remain regardless of where the host boundary is placed.

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

## Acceptance, 2026-10-13

Validated source: `d1e1c5af456568bdd62a368c0173c8f8f9f8b755`, Node 24.19.0, exact backend package/lock installed with `npm ci`. Every accepted check began and ended with a clean worktree at that source. Subsequent acceptance commits change documentation and test-output evidence only.

| Check | Actual result | Boundary |
| --- | --- | --- |
| Native Pi / Agent / governance targeted, ten files | 64 passed, 0 failed, 0 skipped; exit 0 | Actual installed Pi packages, original HTTP/Store/JSONL, controllable faux model |
| `npm run build` | TypeScript and Vite passed; exit 0 | Original unchanged frontend compiles; no new UI or browser/screenshot acceptance |
| `npm test`, after build | 790 total, 783 passed, 0 failed, 7 skipped; exit 0 | Includes original Muse/Dot, approval, access, supplier and business regressions |
| GitHub CI on validated source | `startup_failure`, zero jobs, run 38443446596 | CI did not execute tests; local passing checks do not imply CI success |
| Actual model E2E | Not attempted | Real endpoint, account access, billing and production behavior remain unverified |

The seven skips are six existing external DSH source/built-export fixtures and one Windows-only storage test on Linux. The new native Pi suite has no skip. The build emits the existing large-chunk warning; no frontend dependency or source change is included.

Actual `SIGKILL` coverage includes pending response, response before business acknowledgment, missing business metadata, completed owned tool before the next response, real pre-upgrade Harness submission, and four post-accounting cases (chat/Goal, each with measured and unknown usage). Recovery assertions verify original identities, no extra admission, no completed tool replay, no automatic reopening/resume, no duplicate step/usage accounting and a review-required Goal. Source/endpoint/role/recipient changes and cancellation refuse further execution through the original guards.

The first targeted run on `42673468c2d25f9723f324951fe4597ade99fb62` had 63 passes and one failed recovery assertion. Official `fauxProvider()` defaults to a dynamically generated API ID; the test had incorrectly assumed explicitly measured counters. New measured fixtures now select the supported exact `api: 'faux'`; separate unknown-API fixtures retain null usage and their full reservation. Production wire governance and existing tests were not relaxed. The first full run also failed nine build-dependent cases because it began before `dist` existed; rerunning after the completed build passed without a source change. Both failures remain in the evidence inventory.

See [raw verification output, receipts and Git blob identities](validation/pi-native-agent/README.md). No runtime Store, JSONL checkpoint, generated business artifact, production data or credential is included.
