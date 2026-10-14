# Official Pi TUI development backend

The backend development main entry is now [`npm run agent:dev`](PI-AGENT-DEVELOPMENT.md): one official AgentSession loads the existing business tools and preserves its transcript for reopen. `agent:tui` below remains the compatible command profile; the owner Host/Session entry keeps its separate original authority.

The launcher uses the actual `@earendil-works/pi-coding-agent` 1.1.0 SDK `InteractiveMode`, editor, rendering and extension lifecycle. The Workspace extension is a thin authenticated client: task execution, identity, budget, approvals, audit, persistent output and recovery stay in the original backend. There is no replacement TUI renderer, subagent process framework, executor or task store.

## Start in a development terminal

Use Node 24 and the exact committed lockfile. The new official packages have no install/postinstall script; the reviewed installation used `--ignore-scripts` and pinned every Earendil package to 1.1.0.

```sh
npm ci --ignore-scripts
npm run agent:tui -- --sample
```

`--sample` starts an isolated loopback development backend with **public synthetic input and keyless official faux transport**. The real original Store, Pi Agent, child conversation, HTTP API and approval bridge execute; model responses are deterministic fixtures. No model account, external business result, sale or supplier fact is verified. The fixture token is explicitly synthetic, bound only to the original local development operator and cannot authorize another server. The launcher does not read user `.pi` configuration/auth/session files or `.env` and removes its temporary sample directory after exit.

In the official Pi editor:

```text
/ws-task {"title":"Public task","content":"Explicit public text","requestId":"public-task-1"}
/ws-delegate {"title":"Public child task","content":"Explicit public child text","requestId":"public-child-1"}
/ws-status RUN_ID
/ws-cancel RUN_ID
/ws-resume RUN_ID
/ws-approve RUN_ID PROPOSAL_ID
/ws-continue RUN_ID PROPOSAL_ID
/ws-quit
```

Task submission returns the original run ID. Status reads persisted results and original events; initial admission is not a completion receipt. Delegation is explicitly selected for that run. A child cannot use tools, files, further delegation or external actions; it shares the parent's existing maximum four model requests and 1600-token invocation reservation. The original foreground ownership tree cancels it with its parent. No background child is started.

Approval displays the exact original proposal in the official confirmation dialog. Canceling the dialog sends no approval. Approval alone performs no action; `/ws-continue` is a separate explicit operation. `/ws-resume` only reattaches an interrupted original checkpoint under unchanged original permissions; it never changes the input or silently retries an uncertain external action.

For an already configured original backend, inject its **existing** service URL/token into memory using the established host credential mechanism, then run `npm run agent:tui`. Do not put credentials in command arguments, docs or source. No new principal or credential is created by the normal launcher. This command profile handles `/ws-*` without a frontend model account; natural-language model execution is explicitly blocked. The backend's existing model configuration determines whether tasks execute or remain setup-blocked. Real model E2E was not authorized in this development round.

The sample frontend also has a finite official faux model for exercising native tool dispatch from explicit public text; its tool receipts are actual backend responses. This is separate from the backend's actual Agent and the child model transport. Neither faux model is a real service connection.

The later [business-preset adapter](PI-TUI-BUSINESS.md) adds `/ws-presets`, `/ws-business`, `/ws-business-status` and human-confirmed `/ws-business-resume` over the original business task API. Business `taskId` and generic `runId` remain separate. It reads original stage events and authenticated text documents, preserves original input/identity/approval boundaries, and grants no default business subagent or supplier/Muse transaction authority. Procurement can execute its existing stages with source-checked synthetic sample responses; missing search still blocks research. Its new [fixed-source verification](validation/pi-tui-business/README.md) is separate from the historical generic acceptance below; focused 74/74, full backend 814 pass / 0 fail / 7 original skips, and build passed.

## Tool and policy boundary

- Official TUI extension tools: generic `workspace_task`, `workspace_status`, `workspace_delegate`, and business `workspace_business_presets`, `workspace_business_task`, `workspace_business_status`. Models cannot approve, continue, cancel or recover through these tools; those are explicit human commands.
- Backend API: `/api/agent/v1/pi/tasks`, original Agent credential/member scope, original Runtime runs. The public-text surface accepts no file, skill or memory IDs. Connector actions require explicit selection and the original exact approval pipeline.
- `piTaskContext` is set only by trusted host code, included in the original execution fingerprint and checked against current original member/binding/role before model and tool execution. Other members cannot read the linked runs, conversations, artifacts or approval records through generic Workspace APIs, including the conversation/run admission gap.
- Backend `workspace-subagent` is a native Pi extension with an original owned ToolTask/child conversation, stable submission ID, fresh persisted provider session and bounded text receipt. The original durable ownership index and submission dedupe do the scheduling and replay.
- The supported official terminal input hook blocks builtin export/import/share/login/model/resource commands, external editor, clipboard attachments and file completion in this explicit-text profile. Input hooks reject images. This is an application profile, **not an OS filesystem sandbox**. The original official startup help still lists Pi's generic shortcuts; this profile restricts their entry points.

## Source reuse

See [open-source selection](PI-OPEN-SOURCE-SELECTION.md). Official source was downloaded and reviewed at `abe508e1b89912adde45528136c3221eb69acdd7`; registry binaries are independently pinned by exact 1.1.0 version and integrity. Registry metadata omits `gitHead`, so the reviewed source commit is not presented as proof of exact npm binary provenance. The adapted foreground ownership pattern preserves [the upstream MIT license](../third_party/pi/LICENSE).

## Acceptance status

The final reviewed hint fix is independently accepted at `3214c4a3e4031fe60f93b4e750daf11562bb0fa3` in a new same-environment checkout: fresh exact install, actual documented sample npm CLI, both existing PTY profiles, 74/74 focused tests, build, 821 total / 814 pass / 0 fail / 7 original skips, non-sample missing-configuration messages, and no remaining owned subprocesses. [Clean final evidence](validation/pi-tui-clean-final/README.md) retains the earlier acceptance below as historical evidence. Real service/model connectivity remains unverified.

Independent root acceptance at fixed source `1418067c8de83b3de36c17d2ccfbeb4c487bb548` passed: actual official TUI POSIX PTY 1/1, focused native/Pi/task/permission/subagent/TUI tests 66/66 without skips, TypeScript/Vite build exit 0, and full backend 814 tests / 807 pass / 0 fail / 7 original environment skips. An isolated exact-lock `npm ci --ignore-scripts` also succeeded. The PTY sends actual keystrokes to the official editor and verifies original persisted task/child receipts, exact confirmation cancellation/approval, separate continuation, provider cancellation and explicit backend restart recovery. The SDK test independently exercises actual frontend Agent tool dispatch. Actual SIGKILL cases preserve original parent/child submission/task identity and budgets. [Raw evidence, source identities and the retained initial PTY timing failure](validation/pi-tui/README.md) are committed. GitHub CI for this source failed before starting any job; it is not passing evidence.

The previous native Agent acceptance remains recorded separately in [PI-NATIVE-AGENT.md](PI-NATIVE-AGENT.md). The later user priority selected the official TUI/core backend; the incomplete native-versus-compatibility Runtime refactor was reverted. Existing Runtime queue/business-stage orchestration and legacy JSON continuation remain; this checkpoint does not claim a complete Pi-host-only architecture migration.
