# Original business presets in the official Pi TUI

The official Pi extension can now select the original authenticated business presets. This is a thin client for the existing `/api/agent/v1` service. It adds no business coordinator, executor, persistent task registry, preset stage or private-file reader. The original engine submits its stages through the original Runtime and Pi tools.

## Start and use

```sh
npm ci --ignore-scripts
npm run agent:tui -- --sample
```

The sample uses finite, keyless official faux responses. Its procurement responses call the real `workspace_complete_preset_stage` tool, cite only explicitly submitted input evidence, and pass the original source/output validators. Every sample stage marks its analysis as **合成模型替身**. It proves the installed Pi/HTTP/stage/artifact path; it does not prove real model access, supplier verification, purchases or sales.

In the original official editor:

```text
/ws-presets
/ws-business {"type":"procurement","title":"公开合成采购文书","input":{"product":"公开合成杯子","spec":"公开规格","quantity":10},"requestId":"public-procurement-1"}
/ws-business-status TASK_ID
/ws-business-resume TASK_ID
```

`/ws-presets` reads the original preset registry, required/optional input fields and document deliverables. These capability definitions do not establish configured research or completed tasks. The original presets currently include procurement, supplier-sourcing and opportunity-discovery.

`/ws-business` requires a stable explicit requestId, sends it as the original `Idempotency-Key`, and submits **only** `{type,title,input}`. Reuse the same key after an uncertain transport result to retrieve the original admission; changed content under that key is rejected by the original service. Admission returns `taskId`; it is not completion evidence. The client permits only the original registry's listed public input fields and bounded public JSON/text, rejects obvious credential material and nested file/skill/memory/model/tool/budget/host-context selectors. The original service remains authoritative for preset schemas, membership, role, scopes, budget and source validation.

`/ws-business-status` reads the original member-owned task, persisted JSON event history and authenticated text documents. It uses task metadata to select allowlisted original artifact names, ignores metadata URLs, never downloads to a local file, and never fetches an arbitrary input URL/path or artifact ID. One unavailable artifact is reported unavailable while available documents remain readable; no receipt is invented. Text reads and displayed totals are bounded. Stage progress is visible through original stage/progress/thinking events, summary and result metadata. `documents_ready` means document stages finished, while `businessGoalAchieved` remains false.

`/ws-business-resume` is a human-only command. It reads the original task and presents an official confirmation dialog for eligible failed/interrupted recovery. Canceling sends no POST; confirmation sends the existing `POST /tasks/TASK_ID/resume {}`. No input, model, permission, prior result or budget can be changed. Original authorization and checkpoint eligibility are checked again by the backend; a completed or revoked task cannot be silently restarted. This continues authorized document stages and does not approve external business actions.

Normal mode uses the existing injected `WS_AGENT_URL` / `WS_AGENT_TOKEN` and the actual configured original backend; it does not enable a frontend model account or install search. No token is accepted in CLI arguments or written to a session. The sample directory is temporary. Persistent recovery tests reopen an explicit synthetic directory under the same original binding; normal operation uses the existing persistent backend.

## Two profiles, two identities

| Surface | Identity and authority | Tools and limits |
| --- | --- | --- |
| Generic `/ws-task`, `/ws-delegate`, `/ws-status` | `runId`, original member-owned Runtime invocation at `/api/agent/v1/pi/tasks` | Existing generic input/action-proposal tools and explicitly selected foreground delegation. Exact approval and continuation remain separate human commands. |
| Business `/ws-business`, `/ws-business-status` | `taskId`, existing coordinator task at `/api/agent/v1/tasks`, linked to its original stage run IDs | Original preset stage completion/research tools. **No default subagent capability**, no arbitrary context/tool/model/budget choices, no supplier publication/Muse transaction authority. |

The frontend registers six supported extension tools: the original `workspace_task`, `workspace_status`, `workspace_delegate`, plus `workspace_business_presets`, `workspace_business_task`, `workspace_business_status`. Model tools cannot approve, continue, cancel or recover. The normal frontend command profile blocks natural-language model execution. An explicit `PUBLIC_BUSINESS_FIXTURE {JSON}` sample prompt can exercise actual frontend Agent dispatch of the registered business submission tool; it is visibly synthetic.

Procurement produces the existing inquiry pack, comparison and procurement brief from user-supplied materials. Supplier research and opportunity research still require the original configured search capability. With no search adapter, the sample preserves its original failure reason and partial documents; it does not fabricate providers, citations, suppliers or research completion. No general URL/network tool is added to the frontend. Existing Muse/supplier transaction flows are not exposed as newly authorized business actions by this adapter.

## Verification

Independent fixed-source acceptance at `4e455e6a0a066bd10dd434615e9aa22c4ef2d593` passed 74/74 focused checks, including both real official TUI PTY profiles, TypeScript/Vite build, and the complete backend suite: 821 total / 814 pass / 0 fail / 7 original environment skips. [Raw output, receipts and source identities](validation/pi-tui-business/README.md) are committed. GitHub CI failed before any job started and is not passing evidence. The PTY covers original procurement stages/documents, stable replay, public input and identity refusal, missing-search partial failure, original checkpoint restart, canceled/confirmed recovery and expired-binding denial. Enterprise HTTP checks independently cover cross-member ownership and read-only scope rejection. Tests use controlled faux transport, never a live or paid model.

Source/model provenance, original generic TUI acceptance and remaining architecture limits are documented in [PI-TUI-DEVELOPMENT.md](PI-TUI-DEVELOPMENT.md). The existing Runtime queue and business coordinator remain; this extension does not claim a full Pi-host-only migration or completion of every enterprise transaction workflow.
