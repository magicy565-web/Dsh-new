# Official Pi TUI business-preset acceptance

Validated source: `4e455e6a0a066bd10dd434615e9aa22c4ef2d593`, Node 24.19.0. [manifest.json](manifest.json) records 19 source Git blob/SHA-256 identities, original-file continuity, exact-lock installation continuity, command receipts and limitations. All formal source checks began/ended on this commit with a clean worktree. Later changes only package documentation and evidence.

| Fixed-source check | Result |
| --- | --- |
| Eleven focused native/Pi/Agent/business/TUI files, including two actual official POSIX PTY flows | 74/74 pass, 0 skip; [receipt](business-native-targeted.json), [raw output](business-native-targeted.log) |
| TypeScript/Vite build | exit 0; [receipt](build.json), [raw output](build.log) |
| Full backend after build, including the actual business PTY | 821 total, 814 pass, 0 fail, 7 original skips; [receipt](backend-all.json), [raw output](backend-all.log) |

The business PTY sends keystrokes to the unchanged official editor/InteractiveMode. It reads original preset definitions, rejects caller-supplied host context and invalid public quantities, submits/replays one stable original procurement task, and displays its real four-stage events and three authenticated document contents. It also verifies wrong identity refusal, missing-search partial failure, backend restart during the actual comparison-stage model request, canceled official recovery confirmation with zero calls, confirmed recovery under the same business task/stage run/request/reply, unchanged previous inquiry artifact SHA, completed-task recovery refusal and expired original binding denial. Source transport is finite explicitly labeled synthetic faux, not a live model.

The companion SDK case actually calls `workspace_business_task` through the official frontend Agent and reads its real HTTP receipt. Original enterprise HTTP cases test cross-member business task/continuation refusal and read-only submit denial. Artifact cases retain two readable documents when a third fails, refuse unsafe metadata paths/URLs and stop a stream exceeding its original receipt bytes. Procurement stage output cites only submitted input evidence and passes the existing completion tool/source validator. It reports documents_ready and businessGoalAchieved=false, never purchase or sale completion.

Business tasks use taskId at the existing /tasks API. Generic tasks use runId at /pi/tasks; their separately selected foreground child and exact action approval are still covered by the other real PTY. Business presets have no default delegation, arbitrary file/skill/memory/model/budget or supplier/Muse action authority. Missing search still blocks opportunity/supplier research, preserving original failure and partial artifacts. Original service/auth/presets/coordinator/stage validator/Store/Runtime/provider/server entrypoint and package/lock are byte-identical to the previous delivery.

The [previous fresh exact-lock install](../pi-tui/clean-npm-ci.json) remains applicable: package/lock Git blob and SHA identities did not change. It used an otherwise empty directory, blank npmrc, credential-free infrastructure proxy/CA and `npm ci --ignore-scripts`; no lifecycle scripts ran. Current dependency versions remain pinned to official 1.1.0. Earlier generic evidence is immutable at [pi-tui](../pi-tui/README.md).

Reproduce from the fixed commit with Node 24:

```sh
npm ci --ignore-scripts
npm run build
node --test test/pi-native-agent.test.mjs test/pi-runtime.test.mjs test/agent-pi-runtime.test.mjs test/agent-pi-service.http.test.mjs test/agent-owner-policy.test.mjs test/pi-task.http.test.mjs test/pi-subagent.test.mjs test/pi-workspace-tui.test.mjs test/pi-workspace-tui.pty.test.mjs test/pi-workspace-business.test.mjs test/pi-workspace-business.pty.test.mjs
npm test
npm run agent:tui -- --sample
```

Six full-suite skips require existing external DSH source/built exports absent in this checkout; one requires Windows. No new Pi/TUI/business case was skipped. GitHub CI [38456638821](https://github.com/magicy565-web/workspace-agent/actions/runs/38456638821) ended startup_failure with zero jobs and supplies no passing evidence.

Raw outputs are immutable synthetic test diagnostics, not runtime Store/JSONL/SQLite, business data, account configuration or credentials. No live/paid/production model, external publication, notification, deployment or main change occurred. Normal mode uses existing backend configuration and its original injected service credential; real model/account connectivity remains unverified. The sample is ephemeral; explicit synthetic-directory reopening proves original backend persistence. This is a verified minimal business-preset path, not the whole enterprise transaction backend or a full Pi-host-only architecture migration.
