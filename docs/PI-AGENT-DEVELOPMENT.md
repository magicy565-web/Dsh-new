# Workspace development Agent

`npm run agent:dev` is the natural-language development entry for the installed official Pi AgentSession and InteractiveMode. It reuses the existing SDK factory and Workspace extension. The original `/api/agent/v1` service owns business admission, stages, budgets, membership, role, scopes, approvals, event history and deliverables. This entry adds an official conversation session, not another business coordinator or task store.

## Host configuration and startup

An authorized host must supply the original `WS_AGENT_URL` / `WS_AGENT_TOKEN` binding and the existing provider environment: `PI_PROVIDER`, `PI_MODEL`, optional `PI_BASE_URL`, and the selected `FASTAITOKEN_API_KEY` or `DEEPSEEK_API_KEY`. These use the original `loadPiProviderConfig` / model profile contract. The CLI constructs an official `ModelRuntime` with in-memory credentials; the host API can inject an already configured official runtime and model. Backend model configuration alone does not configure the frontend Agent. The development entry does not automatically import a user model profile, read `.env`, create a credential, or switch to a sample when configuration is missing. No credential is accepted in a command-line argument or included in a receipt.

```sh
npm run agent:dev -- --check
npm run agent:dev
npm run agent:dev -- --continue
```

`--check` is configuration evidence: it authenticates original backend health and presets, checks the explicit frontend configuration, and makes no model request or business submission. It does not establish provider connectivity or paid-model readiness. `--continue` reopens the bound official chat; reopening alone does not resume a failed backend business task or approve an action.

The optional `WS_AGENT_SESSION_DIR` selects an absolute, owned private directory with mode `0700`; the default is `~/.local/state/workspace-pi-development`. Symlinks and unsafe directory entries are refused. `--check` writes no session files. Official transcript files are private and contain public conversation text and authenticated tool receipts, so choose a directory intended for those records.

The in-process API is `createWorkspaceAgentRuntime({ client, isolationDirectory, modelRuntime, model, sessionManager, continueSession, close })` from `scripts/pi-workspace-agent.mjs`. `client` is the existing `createWorkspaceClient`. `isolationDirectory` must be an explicit absolute private directory. `modelRuntime` and `model` are official SDK objects configured by the host, not model selectors supplied by business input. Tests can inject an explicit official `SessionManager`. Otherwise the entry stores official sessions under `isolationDirectory/sessions/<bindingFingerprint>`; the fingerprint binds the service origin and existing credential without writing the credential itself. `continueSession: true` opens the latest official session in that partition. The original backend configuration and binding are checked before reopening.

The frontend transport uses the existing official OpenAI-compatible provider profile, a fixed 1,600-token response cap, disabled reasoning and retry, and a 60-second transport deadline. It redacts the configured model key and Workspace token from streamed events and final messages. Backend stages retain the original budget and policy enforcement; this frontend cap is not a new business budget or a guarantee about account spending.

## Business conversation

The original three core execution tools are retained below. The [built-in business plugins](PI-BUILTIN-BUSINESS-PLUGINS.md) add task-list/result reads plus three deny-only enterprise/product capability tools, for eight active tools in total. The added library tools report the existing authorization gap without fetching private data.

| Tool | Existing operation |
| --- | --- |
| `workspace_business_presets` | Read the authenticated preset registry and public input requirements. |
| `workspace_business_task` | Submit explicitly supplied public preset input with a stable `requestId` to the existing task API. |
| `workspace_business_status` | Read an original `taskId`, stage events and authenticated bounded text documents. |

For example, supply a public product, specification, positive quantity and stable request identifier, ask the Agent to prepare procurement documents, then ask it to read the original task result. Admission identifies `taskId`; completion must come from the subsequent original status and document reads. Procurement retains its existing four Pi stages and three deliverables: `inquiry-pack.md`, `comparison.md` and `procurement-brief.md`.

The existing backend decides whether public input is admissible, whether the member can submit or read a task, and whether research capabilities are configured. Failed or interrupted tasks remain failed or interrupted. Missing search preserves the original failure reason and any available partial documents. `documents_ready` describes document production; `businessGoalAchieved` remains false. A model statement is not evidence of supplier verification, purchasing or sales.

Official SessionManager JSONL persists the conversation and tool receipts. The backend remains the authority for tasks and business results. Before saved business receipts enter the reopened model context, the factory rechecks their original task IDs through authenticated `businessStatus` reads. Another member or a revoked binding is denied before any frontend model call. Subsequent `workspace_business_status` also performs a fresh authenticated HTTP read, so saved conversation text cannot bypass revoked access or replace current task state. The binding is not an owner credential and cannot upgrade member role or `agent:read` into `agent:submit`.

The development Agent exposes no generic task/delegation tool, shell, filesystem, browser, arbitrary HTTP, owner approval, Muse transaction or Dot capability. Original human approval and recovery boundaries remain in their existing surfaces. Canceling a frontend model turn before tool dispatch admits no backend task. If admission already happened, its original backend status remains authoritative; a canceled conversation is not a canceled business task.

## Compatibility and evidence

Human lifecycle controls are documented in [PI-TASK-LIFECYCLE.md](PI-TASK-LIFECYCLE.md): exact approval followed by separate stable continuation, confirmed original task cancellation, and stable original-checkpoint recovery. The active model tools remain unchanged. Business document presets do not gain an external action approval state. The external Personal Worker audit and next minimal reuse plan are in [PI-PERSONAL-WORKER-NEXT.md](PI-PERSONAL-WORKER-NEXT.md).

`npm run agent:tui` remains the original command profile: natural-language frontend model execution is blocked there. Its existing normal and sample behavior is covered by the original suites. The separate owner Host/Session and owner UI remain compatibility surfaces with their original authority; they are not merged into this development Agent or granted to a Workspace bearer token.

Tests deliberately inject the official keyless faux provider into both the frontend SDK and original backend. The PTY test runs real official InteractiveMode through the existing POSIX PTY bridge; its fixture launcher is test-only and is not a `--sample` user entry. Finite scripted tool selections demonstrate dispatch, authenticated HTTP, original stages, document bytes and session reopen. They do not demonstrate real-model reasoning or live provider access.

```sh
node --test test/pi-workspace-agent.test.mjs test/pi-workspace-agent.pty.test.mjs test/pi-workspace-agent-startup.test.mjs
node --test test/pi-workspace-business.test.mjs test/pi-workspace-normal.test.mjs
```

The new checks cover natural input through the official Agent, the original three core execution tools (now accompanied by the five read/capability tools documented in the built-in plugin guide), four original procurement stages, original document hashes, official SessionManager reopen followed by fresh HTTP, denied cached receipt replay into another member's model context, missing-search failure, another member's task denial, read-only submit denial, unavailable owner tool authority and frontend cancellation without new admission. Startup checks cover absent configuration, zero-call original readiness, and mocked official provider wire options and error redaction. Set an explicit absolute `PI_AGENT_TEST_EVIDENCE_DIR` to save public synthetic PTY output and result metadata.

On 2026-10-14, the three development Agent test files above passed 11/11 checks with zero failures or skips in the selected Linux workspace. Default binding-partition `continueRecent` and credential-shaped input rejection were also verified. The related targeted regressions passed 35/35 and the TypeScript/Vite build passed with its existing large-chunk warning. Compact evidence is in [acceptance.json](validation/pi-agent-development-20261014/acceptance.json). Both frontend and backend model responses were explicit synthetic faux, and the provider-wire check used a mocked official transport. These results do not imply GitHub CI or live-model acceptance.

No live or paid model call is part of this evidence. A real-model acceptance run remains blocked until an authorized host supplies safe explicit frontend and backend configuration. Do not read, copy or create real keys or user profiles to make these tests pass. The requested RMB 5 total live-test ceiling is not enforced by token caps alone; paid acceptance also requires a controllable budget. A stated paid-test ceiling does not itself configure or validate a usable credential. Existing cached pinned SDK packages were used; this checkpoint does not claim a fresh clean network install or GitHub CI success.
