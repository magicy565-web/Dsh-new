# Native Pi verification evidence

The fixed source is `d1e1c5af456568bdd62a368c0173c8f8f9f8b755`. [manifest.json](manifest.json) records exact Git blob and byte SHA-256 identities of changed runtime/test files and pinned dependencies. The receipts include command, source before/after, clean-worktree checks, UTC start/end, exit status, counts and raw-output SHA-256. These are local tests with real installed Pi packages and explicit keyless faux transport; they do not verify a real model, account, paid service or production deployment.

| Evidence | Result |
| --- | --- |
| [native-targeted.json](native-targeted.json), [raw output](native-targeted.log) | 64/64 pass, no skip, exit 0 |
| [build.json](build.json), [raw output](build.log) | TypeScript/Vite exit 0 |
| [backend-all-after-build.json](backend-all-after-build.json), [raw output](backend-all-after-build.log) | 783 pass, 0 fail, 7 skip, exit 0 |
| [failed-targeted-before-fixture-fix.json](failed-targeted-before-fixture-fix.json), [raw output](failed-targeted-before-fixture-fix.log) | Retained 63/64 first run; exact faux API corrected and measured/unknown assertions strengthened |
| [failed-backend-before-build-ready.json](failed-backend-before-build-ready.json), [raw output](failed-backend-before-build-ready.log) | Retained 774 pass / 9 fail / 7 skip run before required dist output existed; no source change needed |

The `log` field inside each receipt preserves its original runner filename; the manifest maps it to the uniquely named retained log. No file was overwritten to replace a failure with a success. Raw test output contains synthetic test diagnostics, not runtime Store/JSONL records or business payloads.

Reproduce on an authorized development host with Node 24.19.0 from the fixed commit. The original environment used an exact `npm ci` install and a minimal environment without model keys or `.env` loading. Build must precede the full backend suite because existing acceptance/static-access checks consume `dist`:

```sh
npm ci
npm run build
node --test test/pi-native-agent.test.mjs test/pi-runtime.test.mjs test/pi-process-crash.test.mjs test/agent-pi-runtime.test.mjs test/agent-pi-service.http.test.mjs test/agent-owner-policy.test.mjs test/agent-coordinator-explicit-recovery.test.mjs test/agent-projection-linkage.test.mjs test/agent-research.test.mjs test/agent-ui.http.test.mjs
npm test
```

The targeted suite actually invokes official `Agent.prompt`; its tools execute as the original Durable owned ToolTasks. Real process-kill fixtures cover native response/tool checkpoints, original legacy `Harness.submit`, and the accounting/acknowledgment crash window in measured and unknown chat/Goal modes. It verifies preserved session/task/run/reply/source identities and budgets, cached completed tool receipts, explicit restart recovery, original approval barriers and real abort signals.

Six skipped cases require the original external DSH source/built exports absent from this standalone checkout; one requires Windows. No new native Pi case was skipped. GitHub CI for the fixed source failed at startup (run [38443446596](https://github.com/magicy565-web/workspace-agent/actions/runs/38443446596), zero jobs), so it supplies no passing evidence. No actual-model E2E was attempted under this round's live/paid-call prohibition.
