# V22 Muse receipts and central activity — 2026-10-11

This is an independent frontend candidate based on PR21 commit `321fd920a42523db8b1ae241f97748b0536c78d8`. PR15 remains the separate backend candidate at `2ac171e4da46e44e0095fe9907c2f8b1339a56cb`. Neither branch was merged. Production was not changed.

## Source provenance

- The selected Linux workspace started at `b9546e1d7e6d7ac1381f84327a4f15cbfc60598f`, branch `work`, with no uncommitted changes.
- GitHub metadata and authenticated `git ls-remote` independently confirmed both PR heads before fetching their actual Git objects. Work was then started on `codex/v22-muse-receipts-activity-20261011` directly from PR21, without merging PR15 or rebuilding features from main.
- There is no applicable local `AGENTS.md` or populated `.agents/skills` directory in this environment. The handoff Page's attached `AGENTS.md`, development context and state were read through its current authorized references. Their production ownership restrictions were retained.
- PR15's actual Git blob `deploy/muse-native-overlay/server/muse-worker-session.mjs` confirms that the persisted message contains summary text plus `museOrderId`, `museReceiptHash` and the complete `workspace.muse.session-receipt.v1` metadata. Its file reader binds the current owner, first version and exact SHA.

## Resulting behavior

Original conversation history now displays the persisted Muse receipt's files through the existing `/api/muse-worker-files/:id?version=1&sha256=:sha256` route. It preserves summary-only historical messages. A historical receipt must have the correct schema, original Session/order/Worker/request/task/attempt/fence, valid hash fields and a bounded file array. The browser hashes the original serialized receipt before showing attachments, matches it to the owner-authorized returned task view, and matches each file ID/version/SHA/name to that view. Invalid metadata and unconfirmed ownership produce explanatory text.

Task details and history share the same Muse file component. Normal clicks use authenticated same-origin GETs without redirects, verify the downloaded bytes against the original SHA (and the response SHA header when present), then download those exact bytes. 401/403/404/server/network/hash errors remain visible and can be retried through the same link. There are no new Muse mutations, acceptance calls, OAuth flows or task claims. Receipt delivery, original order acceptance and independent verification remain distinct.

The central control selects valid active work before queued/draft work, independently of the order of the Muse and Dot arrays. Dot execution requires its original delegation ID, attempt ID, safe positive fence, unexpired lease/deadline and no reconciliation flag. It accepts ISO/numeric `leaseUntil`, or a numeric legacy `leaseExpiresAt`; conflicting lease fields fail closed. Muse requires its frozen task/attempt/fence and future lease/deadline. Missing or expired execution evidence shows a state requiring verification and stops the working animation. Return-pending work is not animated as active execution.

Blocking, cancellation, uncertain and unreviewed results retain their labels and a visible count/entry while another task runs. Pending native cancelled/expired outcomes still require their existing close operation. The original conversation scope, single spirit and write guards remain. Reconnect and other-attention controls occupy the existing dock hint position so the phone input dock does not intercept their clicks.

An unchanged receipt stays mounted across routine bootstrap polling. This is covered by a slow download lasting longer than the poll interval.

## Local verification

Environment: Node `24.19.0`, TypeScript `6.0.3`, Vite `8.0.16`, Playwright `1.61.1`, system Chromium `151.0.7922.173`. Dependencies were installed with the existing lockfile, using a workspace-local npm cache. No dependency versions were changed.

| Check | Result | Evidence boundary |
| --- | --- | --- |
| `npm run typecheck` / `npm run build` | Passed | TypeScript and default production bundle |
| `VITE_WORKSPACE_LOGIN_PATH=/auth/login` Vite build | Passed | Existing gateway login build, separate output directory |
| `node --test test/cloud-activity.test.mjs` | 7 passed, 0 failed, 0 skipped | State selection, stale/malformed evidence, strict references and historical metadata |
| `node --test test/ui.dom.test.mjs` | 19 passed, 0 failed, 0 skipped | Production React bundle and local HTTP/persistence; jsdom rendering |
| `test/muse-control.browser.mjs` | 12 checks passed | Built UI with explicit Muse/Dot API fixtures |
| `test/muse-receipts.browser.mjs` | 14 checks passed, 5 exact downloads, no business writes or page errors | Built UI, persisted local application and real loopback HTTP file responses; synthetic API/authorization/results |
| `test/cloud-control.browser.mjs`, standard mode | 10 checks passed | Existing standard API fixtures |
| Same browser test, native mode | 10 checks passed | Native-shaped API fixtures; no original Harness host |
| Same browser test, native + gateway mode | 12 checks passed | Native-shaped API fixtures and simulated gateway login |

Counts are reported separately because scenarios overlap. This is not a cumulative count of independent end-to-end coverage. No full backend suite, production execution or new PR15 Linux gate is claimed.

The DOM suite's old `matchMedia` fixture was updated to provide the event API used by V22. Its old back-navigation expectation was corrected to assert the existing return to `/home` central control, then explicitly navigate to the saved goal list. Product navigation was not changed.

Screenshots and per-scenario JSON are in `docs/screenshots/muse-receipts/`. They show actual Chromium rendering at 320×568, 390×844 and 1440×900, with synthetic fixture content clearly identified. `mixed-running-phone-fixture.png` shows one live central spirit and two actionable attention tasks; `receipt-390-fixture.png` and `receipt-320-fixture.png` show the original-history attachment and invalid-record handling. Download bytes have SHA256 `b9ec14818af5d8d189cfe827df79cd565161afc950c900ae0caf3e5e2681b8f1`.

Reproduce focused checks with Node 24+ and an installed Playwright browser:

```sh
npm ci --cache /tmp/workspace-agent-npm-cache
CHROMIUM_PATH=/usr/bin/chromium npm run test:control:muse
npm run test:ui
CHROMIUM_PATH=/usr/bin/chromium npm run test:control:cloud
VITE_WORKSPACE_LOGIN_PATH=/auth/login npx vite build --outDir /tmp/workspace-v22-gateway
NATIVE_CLOUD=1 TEST_GATEWAY_LOGIN=1 CONTROL_STATIC_DIRECTORY=/tmp/workspace-v22-gateway CONTROL_QA_OUTPUT=/tmp/workspace-v22-gateway-qa CHROMIUM_PATH=/usr/bin/chromium node test/cloud-control.browser.mjs
```

## Remaining acceptance and concrete blockers

1. The complete archive is referenced by the current [source/context Page](https://chatgpt.com/space/page_8b436c6e5f5481918fe5eeddba95428a). Page reads confirm its eight binary references and advisory sizes. In this selected environment, `prepare_materialize` for those exact references failed with `INVALID_ARGUMENT`, reason `schema_validation`, stage `argument_binding`; a single bounded retry for part001 with its observed filename returned the same error. No binary part was materialized, no signed URL was invented, and no complete archive byte count or SHA was independently verified. The previously declared 74,303,280-byte archive hash is not a result of this run.
2. Consequently, built PR21 UI plus the actual original isolated Native Harness Host could not run here. The new browser test restarts the real local `createApp` application and confirms one already-persisted fixture message and exact file bytes. Its Worker views and file permissions are explicit fixtures; it does **not** prove original Harness reconciliation, native receipt idempotency or genuine Muse cloud execution. The actual deployed Dot lease fields also still require the original host contract readback; missing fields will conservatively show execution evidence requiring verification.
3. The new 22-file PR15 Linux 66 checks and three original Harness scenarios remain unperformed by this task. Old Windows or prior Linux results are not counted as this run. Production backend publication remains with the original sole maintainer.
4. After the user reported server recovery, a credential-free public check at `2026-10-11T06:30:45Z` failed here before reaching production: direct DNS returned `Temporary failure in name resolution`; proxy-based HTTPS GETs to `/` and the known `/api/session` endpoint returned CONNECT 403 and origin HTTP code 000. No origin TLS/HTTP response was obtained. This says nothing definitive about whether the server is running. The parent's earlier MCP `-32603` result is not attributed to a guessed cause. At `06:36 UTC` the parent reported a successful genuine original Worker identity call with the original binding preserved and `nativeExecutorAttested=false`; this task did not independently repeat that call or claim a task. Network investigation then stopped. The older automation binding still requires separate handling by its authorized owner.
5. Real original-session delivery, genuine Muse research/file acceptance and independent OAuth refresh/rotation verification remain pending. This task made no production changes, payments, new credentials, permission expansion, plugin/OAuth/MCP subscription changes, main changes, force pushes or deployments.

The development commit includes `[skip ci]` so this handoff relies on the recorded local validation and does not request a new hosted CI run. The new PR is Draft and targets the existing PR21 candidate branch.
