# Official Pi built-in Workspace business plugins

`npm run agent:dev` uses the same official Pi 1.1.0 `AgentSession`, `ModelRuntime`, extension registration and `InteractiveMode`. The built-in Workspace extension registers business tools with `pi.registerTool`; natural-language turns can select these tools and answer from their returned records. This is an executable integration, not a renamed directory or a separate plugin runtime. Original Workspace HTTP services, Store, task execution, ownership, idempotency, budgets and human controls remain authoritative. Trusted built-in lookup guidance is loaded into the same official session system prompt from `WORKSPACE_READ_GUIDANCE`; the guidance directs when to use each real tool and does not implement or grant a data read. Read-only questions use reads; the Agent must not submit a task to manufacture an answer or work around a blocked library capability.

The entry requires the existing service binding and an explicitly configured host model. Missing configuration stops startup; it does not switch to sample data. `--check` reports configuration and original health/presets without a model call. `--continue` reopens the official transcript for the original binding and revalidates referenced tasks before sending cached receipts to a model.

## First-round tool contract

| Tool | Use and validated input | Return and source |
| --- | --- | --- |
| `workspace_business_presets` | Discover supported business presets and their public input fields; empty object. | `presets` from the original authenticated `/api/agent/v1/presets` registry plus `sources` identifying that registry. A preset is a capability, not completed work. |
| `workspace_business_task` | Submit an original task using `type`, bounded public `title`, original preset `input`, stable `requestId`. | Original admission receipt with `task.taskId`, current state and original task `sources`. Admission alone is not completion. |
| `workspace_business_status` | Read a specified original `taskId`. | Original task, event history and bounded authenticated text artifacts, with task/artifact source references. |
| `workspace_business_tasks` | List current member's tasks; optional `limit` integer 1–20 and exact lifecycle `status`. | `status: available/empty`, metadata-only `tasks`, `sources`, `limit`, `hasMore`, `order: created_at_desc`. No task input or document bodies in the list. The client also selects only contracted metadata fields and validates returned types, avoiding implicit model disclosure on future schema drift. Each source cites the original record ID and relative API path. |
| `workspace_business_result` | Read an explicit optional `taskId`, or omit it to select the newest created task owned by the current member that has saved artifacts. | `status: available/partial/empty`, selection rule, original task/events/artifacts and source references. This means latest **creation time among tasks with saved artifacts**, not latest completion time. Partial/failed tasks and missing document reads return `partial`, retaining their actual task status and incomplete result. |
| `workspace_company_profile` | Read reviewed company textual fields; empty object. | Default `unconfigured`; with original Session + reviewed policy: `available/empty`, original company ID/revision and projection SHA. |
| `workspace_products` | Read explicitly approved products; optional `limit` integer 1–20. | Default `unconfigured`; authorized records contain selected textual fields and exact original ID/revision/hash. An approved subset does not claim full catalog coverage. |
| `workspace_product` | Read one approved original product UUID/revision. | Default `unconfigured`; the approved field projection carries original ID/revision/hash. A supplied UUID is not authority. |

The existing business submission input policy still excludes credentials, private file/skill/memory/model/tool/budget/host context. Invalid inputs produce tool errors before data reads. HTTP denials or unavailable services remain errors; unavailable artifacts remain unavailable and never count as readable results. Credential-like records are denied before delivery to the model, and redacted/decoded artifact text that no longer matches the exact original bytes is unavailable. Tool source references identify original service records; they do not grant authority or prove a business outcome. Answers should cite those references and distinguish `documents_ready` from actual procurement, publication or delivery.

## Controlled enterprise and product reads remain inactive by default

The three Library tools now use actual read-only adapters to the original Business Library Store through the original enterprise Session identity. The normal Agent Bearer binding is not a Session. An integrator must separately bind an existing Session transport and a reviewed, expiring policy naming the existing enterprise/member, exact record revisions, selected textual fields and actual model recipient. No CLI switch or default configuration activates disclosure. Private files, images, SKUs/prices, supply policies and contact details remain excluded; the existing task/UI private-library rules remain intact.

See [controlled Library contract and activation checklist](PI-LIBRARY-MODEL-READ.md) for the exact fields, receiver tuple and synthetic acceptance. Every model call rechecks any cached Library receipts against the current original Session/scope/revisions, including official session replacement. Revoked or changed authorization fails before model transmission.

## Verification and limits

The dedicated Node suite is `test/pi-workspace-plugins.test.mjs`. It starts the actual original HTTP service/Store and official AgentSession with explicitly injected, finite keyless faux frontend/backend providers. It verifies real tool dispatch for product questions (default unconfigured), task progress, original saved results and empty data; source IDs and document SHA; member and enterprise isolation; reopen access checks; truthful failure; bounded argument rejection; and absence of original Bearer values/unapproved private-library sentinel text from model context and answers. No live provider is contacted.

`test/pi-workspace-plugins.pty.test.mjs` launches the actual official `InteractiveMode` through a real PTY. Its test-only fixture injects a finite faux model and answers typical Chinese questions: “有哪些产品？”, product details, company information, task progress and “上次成果是什么？”. Task/result tools make real authenticated loopback HTTP reads. Empty task/result prompts are exercised in a separate empty Store. No `--sample` user-facing fallback, replacement runtime or real model account is used.

On 2026-10-14, all six dedicated Node tests and both official PTY tests passed. Enterprise isolation uses two actual isolated enterprise services, and requires both original procurement tasks to reach four succeeded stages and `done/documents_ready` before asserting denied foreign-result reads; it does not treat a failed fixture as completed evidence. The partial-artifact check deliberately returns HTTP 503 for one original document: the task remains `done/documents_ready`, the read result becomes `partial`, that document remains `unavailable`, and only the two readable documents receive artifact source references. The PTY fixture's short diagnostic lines are parsed from actual tool receipts to avoid losing assertions to terminal line wrapping and incremental redraw; they do not fabricate task or library data.

Run the dedicated checks with:

```sh
node --test test/pi-workspace-plugins.test.mjs test/pi-workspace-plugins.pty.test.mjs
```

These are engineering transport, data-authority and official Pi control-path checks. Faux responses deliberately request tools and quote their actual receipts; they do not prove live DeepSeek tool selection, answer quality, real provider connectivity, monetary cost control, real products, real business achievement or external worker delivery. No real model key is read by these fixtures. The safe new-key configuration is still unconfirmed, and the CNY 5 allowance remains reserved for a later approved, bounded live verification. Paid model calls in this round: zero.

Source/test/document changes belong to private PR65's development branch. No frontend PR66 changes, main modification, merge, deployment, new credentials, subscriptions, account permissions or real external side effects are part of this round.

The selected Linux workspace passed 115 unique targeted Node checks and 28 Python checks, plus TypeScript/Vite build (existing large-chunk warning). The dedicated plugin/API/PTY group contributes 11 checks. Compact source/check hashes and invariants are in [acceptance.json](validation/pi-builtin-plugins-20261014/acceptance.json); raw synthetic terminal/runtime data is excluded from Git. An initial legacy PTY visibility failure after adding source references was resolved by placing citation metadata before the original receipt payload, then the full group passed. These are local installed-SDK results, not GitHub CI or clean-install evidence.

The prior 2026-10-14 six-test/two-PTY checkpoint above covered default inactive Library bindings. The separate Library suite now verifies actual approved synthetic company/products via original Session/HTTP/Store; its evidence must not be described as a real enterprise/model connection.
