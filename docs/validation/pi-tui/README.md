# Official Pi TUI acceptance evidence

Validated source: `1418067c8de83b3de36c17d2ccfbeb4c487bb548`, Node 24.19.0. [manifest.json](manifest.json) pins each relevant source Git blob and SHA-256, checks, model transport and CI limitations. Every accepted source test started and finished at this commit with a clean worktree. Later commits only package documentation and evidence.

| Check | Result and receipt |
| --- | --- |
| Actual official TUI in a real POSIX PTY | 1/1 pass, no skips; [receipt](official-tui-pty.json), [raw output](official-tui-pty.log) |
| Eight focused native/Pi/Agent/member-policy/task/subagent/TUI files | 66/66 pass, no skips; [receipt](native-targeted.json), [raw output](native-targeted.log) |
| TypeScript/Vite build | exit 0; [receipt](build.json), [raw output](build.log) |
| Full backend after build | 814 tests, 807 pass, 0 fail, 7 original skips; [receipt](backend-all.json), [raw output](backend-all.log) |
| Fresh committed-lock install in an otherwise empty directory | `npm ci --ignore-scripts --no-audit --no-fund`, exit 0; [receipt](clean-npm-ci.json), [raw output](clean-npm-ci.log) |
| First PTY check, retained | Failed at old awaiting-approval state before asynchronous continuation processed; waiting for actual completion and actual restart request fixed in the test; [receipt](failed-pty-before-wait-fix.json), [raw output](failed-pty-before-wait-fix.log) |

The PTY uses the real official InteractiveMode/editor, terminal input and human commands. The Python bridge supplies terminal identity/cursor replies, not a replacement UI. Actual original HTTP/Store/native child/approval code runs. It verifies member-authorized task submission, persisted results, a bounded native owned child, rejection before approval, canceled confirmation, exact approval without execution, separate one-time local continuation, cancel and explicit recovery under the same run/native task/reply. No HTTP-only or SDK-only result substitutes for this interaction test. The full backend run independently includes the same PTY case.

The frontend SDK tool test invokes its actual Agent against a finite official faux provider and receives real original HTTP task receipts. Backend tests cover strict public-input validation, member/role/binding isolation, atomic conversation ownership before admission, absence of ambient private files/skills/memories, original approval barriers, durable child caps, shared budget, no child tools/background recursion, provider abort and real SIGKILL parent/child recovery. Model transport is explicitly keyless controlled faux. No real-model, account, business success or production connection is established.

The launcher sample backend is intentionally temporary and removed on exit. Persistent recovery is verified by reopening a separately explicit synthetic backend directory, without changing identity or creating a second task. Normal TUI mode uses the already configured original backend and its existing injected service credential; it creates no credential or new model account. It blocks frontend natural-language model execution and leaves the backend's existing setup status authoritative.

The fresh install used only the committed package/lock, empty user/global npmrc and validated credential-free infrastructure proxy/CA settings. Installation executed no lifecycle scripts. The tested worktree tree also resolves all nine Earendil packages to 1.1.0. Package integrities and reviewed upstream source are separate identities because official registry metadata provides no gitHead.

Reproduce in a development terminal with Node 24 and the fixed source:

```sh
npm ci --ignore-scripts
npm run build
node --test test/pi-workspace-tui.pty.test.mjs
node --test test/pi-native-agent.test.mjs test/pi-runtime.test.mjs test/agent-pi-runtime.test.mjs test/agent-pi-service.http.test.mjs test/agent-owner-policy.test.mjs test/pi-task.http.test.mjs test/pi-subagent.test.mjs test/pi-workspace-tui.test.mjs
npm test
npm run agent:tui -- --sample
```

Six skipped full-suite cases require the existing external DSH source/built exports absent in this standalone checkout; one requires Windows. New Pi/TUI cases were not skipped. GitHub CI [38453641934](https://github.com/magicy565-web/workspace-agent/actions/runs/38453641934) ended startup_failure with zero jobs and supplies no passing evidence.

Raw outputs are immutable. Receipt log filenames preserve their original runner names; the manifest maps renamed retained failures. No runtime Store/JSONL, personal sessions, credentials or business payloads are committed. Existing Runtime orchestration and legacy compatibility paths remain; this is a verified official TUI/core-backend development slice, not a completed architecture migration.
