# Official Pi / Workspace normal-mode continuation

This development branch starts from PR63's tested `f9b95f631f2c6ef22545b7556cc3b37c53663bc4`. It reuses only the independent server provider configuration and CLI smoke from paused PR64 (`e3cb089de3fc70131f1f0038d5bee7e35af85e2c`); no owner web UI, browser API adapter, SessionGate change or second Runtime is imported.

The CLI smoke previously queried `/healthz` while the original server exposes `/api/health`. The test now starts the actual CLI with an isolated empty-key DeepSeek configuration, reads its real health/bootstrap, checks setup-required state and closes cleanly. The six SDK wire checks plus eleven original Pi regressions also pass. All wire responses in these automatic checks are explicitly synthetic; there is no paid or live-provider evidence.

## Existing normal entries

The root entry is `npm run agent:tui`, with **no `--sample`**. Existing `WS_AGENT_URL` / `WS_AGENT_TOKEN` must be injected by the authorized host. This official Pi InteractiveMode profile submits commands through the original member-bound API; its frontend has no model account and natural-language model execution is disabled. The original backend Pi executes the existing business stages and tools and retains task/result authority.

Recommended sequence: first run `npm run agent:tui -- --check`; after a successful exit, run `npm run agent:tui`. Plain startup does not execute readiness checks and an open editor does not prove connectivity or model availability. The unavailable-service/demo/unconfigured-model failure exits described in the normal-mode guide apply specifically to `--check`.

The separate existing owner Agent profile is `npm --prefix tui run agent`. It uses the official Pi CLI, its existing `/login`, `/model` and profile, and five native owner business proposal tools. It also requires the original owner Host/Session transport. Backend configuration does not automatically configure this frontend profile. See `tui/AGENT-MODE.md` and `tui/OWNER-CONNECTION.md`; the host's foreground terminal attachment remains an unverified integration prerequisite. Neither entry is a webpage or a new executor. Do not claim command-mode natural-language Agent execution, owner transport, frontend model login or actual model success without their own evidence.

## Explicit server DeepSeek configuration

Non-secret settings are `WORKSPACE_RUNTIME=pi`, `PI_PROVIDER=deepseek` and explicit `PI_MODEL=deepseek-flash` (or `deepseek-v4-pro`). The user's new `DEEPSEEK_API_KEY` is accepted only from the authorized server process environment. The reviewed HTTPS origin is pinned to `https://api.deepseek.com`. No other provider's key is used as fallback. The loader does not probe the network; configuration presence is unverified until an actual request succeeds. The existing Pi SDK dispatch explicitly disables thinking and retains original scopes, approval fingerprints, durable recovery, token reservations and zero retries.

No key is accepted in a CLI argument or copied from chat. The Workspace browser does not collect provider keys. This environment has no exposed, verified DeepSeek secret-entry interface; the user must configure a new key through their original secure host/environment settings. This task does not retrieve prior chat secrets, read private Pi auth/session files, create credentials or expand principal permissions.

Safe presence-only audit in the selected environment found `DEEPSEEK_API_KEY`, `PI_PROVIDER`, `PI_MODEL`, `WS_AGENT_URL`, `WS_AGENT_TOKEN` and `WS_AGENT_PRINCIPALS` all absent. No values were printed. Therefore a real end-to-end execution cannot currently be verified.

## Live-test boundary

The user authorized a **total RMB 5** for this round of DeepSeek model tests only. It does not authorize top-up, subscription, other paid services or unlimited calls. Before any real dispatch, verify safe new-key injection, current official prices and a minimal fixed physical-request/input/output ceiling with conservative cumulative reservation. Unknown/timed-out requests still consume the reservation. Existing token caps and SDK zero-cost placeholders alone are not a monetary guarantee. Use only short, non-sensitive, explicitly public test input; no enterprise private file or automatic sample fallback.

No new billing/permission framework, PostgreSQL/pg-boss migration, Shopify refactor, production deployment, main change, merge or force push is part of this work. Missing safe configuration or an unverified aggregate bound pauses paid requests while keyless engineering continues.

## Final controlled acceptance

The combined CLI/Pi/DeepSeek-wire/original Agent UI/normal TUI suite passes 52/52 with zero skips; existing native owner Agent tool contracts pass 2/2, and the actual native Agent PTY passes eight checkpoints. The latter uses 15 deterministic loopback model requests and zero external/model-account requests. Build passes with the existing large-bundle warning. See [compact acceptance](validation/pi-normal-20261014/acceptance.json). Raw generated business documents, task IDs and terminal transcripts remain local, excluded from Git.

A fresh optional `tui/` install failed because npm registry DNS returned EAI_AGAIN. The native Agent PTY was subsequently run using the existing installed official 1.1.0 SDK: its exact TUI lockfile and every required installed dependency version matched. This is reuse of the same dependencies and official CLI, not a replacement entry or a successful fresh-install claim. No production profile was opened.

Normal commands and exact limits are in [PI-TUI-NORMAL-MODE.md](PI-TUI-NORMAL-MODE.md). `npm run agent:tui -- --check` currently fails honestly with missing WS_AGENT_URL; it does not switch to a fixture. Help leads with normal mode. No live call, credential creation, frontend development or deployment occurred.
