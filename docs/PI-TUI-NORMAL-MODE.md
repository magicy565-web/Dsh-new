# Official Pi TUI: normal command mode

The backend development main entry is now [`npm run agent:dev`](PI-AGENT-DEVELOPMENT.md), where one official AgentSession loads the existing business tools. This document describes the retained `agent:tui` compatibility command profile.

`npm run agent:tui` opens the installed official Pi `InteractiveMode` and the
original Workspace extension. Normal mode is an authenticated command client.
It has no configured frontend model; natural-language input displays an explicit
refusal and starts no model call or task. The original backend runs Pi models and
business tools after a `/ws-*` submission. The separate `tui/AGENT-MODE.md`
describes the separate existing owner profile and does not change this command entry.

## Connection and read-only readiness

Use the existing host mechanism to inject `WS_AGENT_URL` and `WS_AGENT_TOKEN` into
memory. Normal launch does not create an identity, read `.env` or user `.pi`
auth/session files, load model keys into the frontend, or enable a fallback sample.
Keep the backend's original persistent data directory and member binding.

First run the read-only check. Only after it exits successfully, open the normal
TUI in an interactive terminal:

```sh
npm run agent:tui -- --check
# Continue only if the check above succeeded.
npm run agent:tui
```

Plain `npm run agent:tui` does not run the readiness check. Opening its editor
does not establish backend connectivity, model configuration or live model
availability. Original request errors remain visible when commands are used.

`--check` sends only `GET /api/agent/v1/health` and authenticated
`GET /api/agent/v1/presets`. It verifies the original service reports `mode=model`,
`runtime=pi-durable`, a model name, `readiness=configured_unverified`, a configured
binding and a ready task projection, and that procurement is present in the
authenticated registry. It also loads the official runtime and lists the six
original extension tools. It submits no task, purchases nothing and calls no
model. A successful check explicitly returns `onlineVerified=false`; it verifies
configuration and authorized reads, not a live provider connection or permission
to complete every business action.

During `--check`, missing URL/token, unreachable service, denied identity, a
degraded projection, demo mode or unconfigured backend model exits with failure.
This exit behavior describes `--check`, not an automatic readiness check during
plain TUI startup. No automatic `--sample` switch occurs. Model/provider configuration belongs to the backend's
existing configuration path; this frontend does not configure it. In this work
environment, real credentials and a live provider are not configured or tested.

For natural-language Agent interaction, the separate existing command is
`npm --prefix tui run agent`. That owner profile needs its own configured Pi
model/profile and original owner Host/Session service binding; see
[AGENT-MODE.md](../tui/AGENT-MODE.md) and
[OWNER-CONNECTION.md](../tui/OWNER-CONNECTION.md). Configuring backend DeepSeek
alone does not make this natural-language entry usable, and the root `--check`
does not verify that separate profile or its foreground Host attachment.

## Public procurement in three official inputs

In the original Pi editor, use a stable identifier of up to 96 letters, numbers,
underscores or dashes:

```text
/ws-presets
/ws-procurement public-procurement-1
```

The original `ctx.ui.input` dialogs collect **Public product**, **Public
specification**, and **Public quantity (positive integer)**. Only supply text you
intend to disclose to the existing backend/model. Do not paste credentials,
private files or unsupported supplier claims. Escape cancels without admitting
a business task. The command validates bounded public text and a positive safe
integer, derives a title from the public product, then submits the original
`procurement` preset through the unchanged business adapter and original
`Idempotency-Key`.

The TUI displays the submitted fields and stable requestId before admission.
For an uncertain transport result, first check the original task if its taskId is
known. Retry with **the identical requestId and identical fields** to retrieve
the original admission. Changing the payload under that key produces the original
HTTP 409 refusal. The command stores no local task registry or retry state.

The full existing JSON command remains available for optional quotes,
requirements and other fields from `/ws-presets`:

```text
/ws-business {"type":"procurement","title":"Public procurement","input":{"product":"Public cup","spec":"Public specification","quantity":10},"requestId":"public-procurement-json-1"}
/ws-business-status TASK_ID
/ws-business-resume TASK_ID
```

Admission is not completion. Status reads persisted original stage events and
authenticated text documents: `inquiry-pack.md`, `comparison.md` and
`procurement-brief.md`. `documents_ready` means document stages completed;
`businessGoalAchieved` remains false and user-supplied supplier facts remain
unverified. Research presets still report their original missing-search error and
available partial documents. Recovery asks for official human confirmation and
continues only an eligible unchanged original checkpoint. Revoked identity or
missing permissions stay visible as original HTTP refusal messages. Generic
`/ws-task` and `/ws-status RUN_ID` use the original Pi task API, a distinct identity
from business `TASK_ID`.

## Reproduce the controlled acceptance

The following tests use an explicitly synthetic backend and finite official faux
responses. Both real POSIX PTYs start `scripts/pi-workspace-tui.mjs` **without
`--sample`**, pass the original synthetic WS binding in memory and type into the
actual official editor. They exercise the original Store, Runtime, Pi task/tools,
business stages, artifact persistence and authorization checks. They do not prove
a live model connection, verified suppliers, procurement execution or spend.

```sh
PI_TUI_TEST_EVIDENCE_DIR=/tmp/pi-normal-tui-evidence node --test \
  test/pi-workspace-normal.test.mjs \
  test/pi-workspace-tui.test.mjs \
  test/pi-workspace-business.test.mjs \
  test/pi-workspace-tui.pty.test.mjs \
  test/pi-workspace-business.pty.test.mjs
```

The evidence directory contains `normal-check.json`,
`normal-check-failures.json`, generic and business raw PTY transcripts, and
`normal-generic-results.json` / `normal-profile-results.json`. These explicitly
mark their synthetic provenance. The business transcript covers public input
cancel, natural-language refusal, identical-key retry, four original Pi stages,
persisted documents, invalid input, missing research, restart, canceled and
confirmed recovery, and expired identity refusal. Generic PTY evidence covers
original task/owned child/status, exact human approval, separate continuation,
cancellation and same-checkpoint recovery.

The 2026-10-14 Work-environment run of this five-file command passed **19/19**
tests with zero failures or skips, including both real official PTYs. The source
diff whitespace check also passed. These are controlled local results with the
synthetic provenance above.

Live acceptance remains blocked on secure backend credentials and the original
authorized service/member binding. Passing controlled acceptance does not
authorize a model call or satisfy a provider budget cap.
