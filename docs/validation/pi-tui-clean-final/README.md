# Final source, clean installation and documented TUI reproduction

The fixed acceptance source is `3214c4a3e4031fe60f93b4e750daf11562bb0fa3`, including the reviewed business receipt hint fix and SDK assertions. A new detached worktree was created inside the **same execution environment**. It had no node_modules, runtime data or uncommitted source; dependencies were installed anew into this directory using a separate empty cache and isolated HOME. Evidence from an earlier version was not substituted. [manifest.json](manifest.json) records source identity, checks and limitations.

| Check | Result |
| --- | --- |
| Documented `npm ci --ignore-scripts` at final source | exit 0, no existing dependencies/data; [receipt](clean-final-install.json), [output](clean-final-install.log) |
| Existing eleven-file focused suite in this new checkout | 74/74, 0 skips; [receipt](clean-final-targeted.json), [output](clean-final-targeted.log) |
| Build using only new dependencies | exit 0; [receipt](clean-final-build.json), [output](clean-final-build.log) |
| Full backend after build in this new checkout | 821 total, 814 pass, 0 fail, 7 original skips; [receipt](clean-final-backend.json), [output](clean-final-backend.log) |
| Actual documented `npm run agent:tui -- --sample` in official POSIX PTY | exit 0; original procurement completion/synthetic brief, stable replay, actual completed owned child; [receipt](documented-sample-cli.json), [compact diagnostics](documented-sample-cli.log) |
| Non-sample configuration contract | Missing URL/token messages and synthetic --check metadata verified, six tools / zero model calls / no session file; [receipt](normal-profile-contract.json), [output](normal-profile-contract.log) |
| Post-exit audit | No owned Node/npm/Python subprocesses or TUI isolation directories remain; [receipt](isolated-final-cleanup.json), [output](isolated-final-cleanup.log) |

The manual sample invocation used the already committed `test/fixtures/pi-tui-pty-driver.py` to send real keystrokes to the actual npm launcher and official InteractiveMode, without an alternate renderer/entrypoint. Owned build output was moved aside before this invocation, so `dist` and runtime data were absent; sample startup requires only the documented install. `/ws-presets`, `/ws-business`, `/ws-business-status`, same-key submission, `/ws-delegate`, `/ws-status` and `/ws-quit` were exercised. The visible completed compact business receipt, actual synthetic procurement brief and native parent answer with an owned completed child were observed. The entire sample process group disappeared after normal quit, and its temporary directory was deleted.

Three earlier manual inspection assumptions are retained in [manual-viewport-checks.json](manual-viewport-checks.json) with original receipt/log hashes. They expected headers outside the official 42-line visible tail of large JSON messages. No product source or tests were relaxed for these assumptions. The accepted observation uses actual visible document/child content and compact **same-request** business replay for completion. All three original document bytes, four actual Pi stages, parent completion, stable IDs, recovery, cross-member/read-only/expired authorization refusal, partial failure and cancellation are independently checked by the existing tests in the same clean checkout. The normal/generic and business PTY tests were reused; no second test suite was added.

Full terminal transcripts contain generated synthetic task/document content and remain local only; they are not committed as runtime data. Committed manual records contain compact validation facts and transcript SHA-256 only. Raw automatic-suite outputs are immutable synthetic test diagnostics. No Store, JSONL, SQLite, real credential, personal session or generated business artifact is included.

To reproduce at the fixed commit on Node 24 with an interactive terminal:

```sh
npm ci --ignore-scripts
npm run agent:tui -- --sample
```

In the official editor:

```text
/ws-presets
/ws-business {"type":"procurement","title":"公开合成采购文书","input":{"product":"公开合成杯子","spec":"公开规格","quantity":10},"requestId":"public-procurement-1"}
/ws-business-status TASK_ID
/ws-business {"type":"procurement","title":"公开合成采购文书","input":{"product":"公开合成杯子","spec":"公开规格","quantity":10},"requestId":"public-procurement-1"}
/ws-delegate {"title":"Public child task","content":"Explicit public child text.","requestId":"public-child-1"}
/ws-status RUN_ID
/ws-quit
```

Reuse the exact business JSON/key for the compact completion/replay receipt; it never creates another task. A default-height terminal shows the end of long status JSON. The tests verify complete event/document content, while the manual observation records only fields actually visible. There is no claim that every JSON field fits simultaneously in the current viewport.

For reproducible recovery/revocation/deduplication checks, use the existing committed suites rather than a custom second harness:

```sh
npm run build
node --test test/pi-native-agent.test.mjs test/pi-runtime.test.mjs test/agent-pi-runtime.test.mjs test/agent-pi-service.http.test.mjs test/agent-owner-policy.test.mjs test/pi-task.http.test.mjs test/pi-subagent.test.mjs test/pi-workspace-tui.test.mjs test/pi-workspace-tui.pty.test.mjs test/pi-workspace-business.test.mjs test/pi-workspace-business.pty.test.mjs
npm test
```

Business PTY restart holds the actual comparison-stage request, reopens the same explicit synthetic Store/JSONL directory, cancels recovery confirmation with zero calls, confirms recovery with identical task/run/request/reply and unchanged inquiry SHA, then rejects completed recovery and expired binding. Generic PTY and actual SIGKILL tests cover owned-child checkpoints, parent cancellation and replay/budget continuity. Sample CLI storage itself is intentionally ephemeral, not a persistent production service.

Normal mode requires the original service URL and **existing** member-bound Agent token injected into memory as `WS_AGENT_URL` and `WS_AGENT_TOKEN`. `npm run agent:tui -- --check` inspects local metadata only, does not contact the service or prove credentials/connection. Source inspection confirms original backend configuration names `WS_AGENT_PRINCIPALS`, `WS_AGENT_ENABLED`, `FASTAITOKEN_API_KEY`, `PI_MODEL`, optional `PI_BASE_URL`, and optional research `WS_AGENT_RESEARCH_ENABLED` / `BRAVE_SEARCH_API_KEY`. These names are documented, not populated or read from actual configuration. Frontend natural model execution remains blocked in normal mode. Existing backend setup and auth remain authoritative.

Six full-suite skips require existing external DSH source/built exports; one requires Windows. New Pi/TUI/business cases have no skips. GitHub CI [38457918911](https://github.com/magicy565-web/workspace-agent/actions/runs/38457918911) ended startup_failure with zero jobs and provides no passing evidence. Models here are finite keyless official faux; no real host/account/model connection, paid call, publication, notification, deployment or main change was attempted. Existing business/research/transaction permission and architecture limits remain unchanged.
