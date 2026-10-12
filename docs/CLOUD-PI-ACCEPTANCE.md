# Cloud Pi acceptance, 2026-10-12

Recovery baseline: PR33 e37d4b98c0a9a981c3e1ce37c9afca73c1fb1c89;
PR32 7b891844821803ec61aaf564fe5dfcb903d83a8f and PR28
1a669dc81e6e3dab6fa11d3fbf0afbced08f8c39 are verified ancestors. Original cloud
worktree remains untouched. Independent branch: codex/cloud-pi-runtime-20261012;
Draft PR: https://github.com/magicy565-web/workspace-agent/pull/34 (base PR33
development branch). No main merge/change, force push, deployment or production
operation occurred. Remote checkpoints: 2a7ba4f20d8f1c29a6c41036e8bbbc0055f0131a,
37f54819271109cf5bd763af98512d8a10737811 and
1e5626070140e67b9efe62c2341b238dbf4a4f53. Subsequent candidate/package commits
are recorded by the raw-byte manifests and remote branch, not guessed here.

Official release source: abe508e1b89912adde45528136c3221eb69acdd7 (v1.1.0).
Actual dependency tree: pi-agent-core, pi-ai, pi-durable, chord, pi-telemetry
1.1.0. npm package-lock integrity pins the actual registry distributions;
the registry did not supply gitHead. WeChat official API typings: 5.2.3.
Node 24.19.0; Chromium 151.0.7922.173; Python 3.12.14.

Changed boundaries:
- Official durable Harness executes admitted Pi conversations and the two
  replay-safe tools. Original Workspace queue, permissions, snapshots, exact
  approvals, token reservations, connector receipts and files remain in charge.
- JSONL fsync:true runs within the original exclusive writer lock. Reopen does
  not resume automatically. Explicit recovery reattaches the same run/reply/
  durable submission. User cancellation aborts work, shutdown preserves it.
- Original Muse binding can attach through its existing factories with an exact
  restored owner/conversation. No model impersonation, new Connector protocol,
  synthetic sender or claimed wake. Raw receipt files cannot escape through
  generic artifact endpoints.
- Existing UI retains its companion and layout. Pi-generated files have saved
  ID/version/SHA provenance and use original safe preview/download. The original
  body's 360px minimum was reduced to 320px after actual browser overflow.
- One-page WeChat conversation client compiles with official definitions and
  shares existing schemas/API. It handles attachments, explicit approval,
  server progress, result files and on-demand business references. It uses
  native session headers under unchanged signed ingress/role/CSRF/expiry rules.
  POST reference alias addresses the officially typed lack of PATCH support.

Test evidence (overlapping suites are not added as independent tests):

| Command / evidence | Result | Scope |
|---|---|---|
| npm run test:all | exit 0 | Backend, original UI, conversation suites and mini build |
| Backend within test:all | 533 total, 526 pass, 0 fail, 7 skip | 6 existing DSH/source-bound tests and 1 Windows-only test skipped |
| Original UI suite | 19/19, no skip | Complete existing original DOM suite |
| Conversation suites | 14/14, no skip | Conversation, Muse receipt/file and procurement UI |
| New Pi/Muse/durable/crash/mini targeted suites | 20/20, no skip | Real installed Pi packages and actual loopback Store/file APIs; platform/model tools are explicitly fixtures |
| Actual process SIGKILL fixture | 1 top-level test, 2 scenarios pass | Pending request and durable answer before business acknowledgment; cached answer recovery makes zero new model calls |
| TypeScript/Vite | pass | JS501.58kB/gzip141.99kB; existing size warning remains |
| Mini program official-types build | pass | Developer import folder, no account upload/review |
| Real Chromium | 6 checks pass; console errors 0 | Desktop, 390/320px, actual UI→Pi fixture→Store→SHA preview/reload, reduced motion |
| Extra extended DOM sweep | 40 total, 33 pass, 7 fail, no skip | Includes old Supply Commerce screen tests outside the current conversation UI |
| Full PR33 baseline Supply DOM suite | 0/7, same seven failures | Detached fixed PR33 reproduces each obsolete /commerce screen timeout |
| Current Pi launch evidence inventory | blocked | Correctly remains unready without live/target/reference/security evidence |

The seven extra Supply DOM failures were not skipped, weakened or presented as
passes. All wait for `.supply-network` at `/commerce`; the existing PR33 route
maps `/commerce` to the library. All seven exact cases were rebuilt and rerun in
the detached fixed PR33 worktree, reproducing the same initial render timeout.
The downstream CRUD/permission/publication assertions were not reached in either
run and are therefore unverified by this obsolete UI suite. Restoring a
discarded resource page would change the authorized UI scope, so it was not done.
Logs remain in docs/validation/cloud-pi, including the failed sweep and full
pr33-all-supply-failures.txt reproduction. Historical TT041 counts and failures from earlier implementation
iterations are not reused as current acceptance.


Each obsolete Supply UI case was run on both candidate and fixed PR33:

| Case | Candidate | PR33 | First failing boundary |
|---|---|---|---|
| Saves supplier/product and restarts | fail | fail | .supply-network at /commerce absent |
| Revision conflict and explicit new revision | fail | fail | Same initial render timeout |
| Unknown committed command retry | fail | fail | Same initial render timeout |
| Dirty navigation/refresh protection | fail | fail | Same initial render timeout |
| Read failures/invalid writes/reload | fail | fail | Same initial render timeout |
| Other-role pending command/viewer guard | fail | fail | Same initial render timeout |
| Exact supplier/listing publication approval | fail | fail | Same initial render timeout |

These observations establish a pre-existing route/test mismatch only. Deeper
business assertions in this suite were not executed; original backend coverage
is reported separately.

Actual screenshots: docs/validation/cloud-pi/browser/desktop-conversation.png,
verified-file-preview.png, mobile-390.png and mobile-320.png. These are real local
Chromium screenshots with a clearly labeled faux model; they are not live Muse,
WeChat device screenshots or comparison against unavailable reference pixels.
The mini program's PNG companion is rendered from the existing web component.

Remaining external acceptance:
- Production is deliberately powered off. Real original Muse identity, account,
  Connector, sender/wake, lease/execution and returned files await its recovery.
  No production probe, wake or restart occurred. Fixtures cannot establish these.
- Pi relay/model online/account authorization and enforceable production budget
  have not been tested; no paid inference or key collection occurred.
- Actual WeChat AppID/account/code exchange→existing enterprise membership,
  trusted ingress, allowed HTTPS domains, devices, privacy/review, subscription
  notifications and publication remain unconfigured and unverified.
- Official WeChat docs site was unreachable; API shapes were checked against
  installed official 5.2.3 definitions, not claimed as platform acceptance.
- Original private library policy remains: business references are associations,
  not model/Connector export consent. Current input parser handles selected UTF-8
  text; uploaded images/PDF are saved but not parsed by the text-only model.
- GitHub Actions runs 38204591752 and 38204588636 at 1e56260 both return
  startup_failure, path BuildFailed, zero jobs. No root cause or job test output
  was available. gh api was Forbidden; connector run/job reads succeeded. No
  workflow or permission change/rerun occurred; local tests are separate evidence.
- Independent final security review and source-reference visual acceptance remain
  open. This is a Draft development deliverable, launchReady:false.

Source packaging: scripts/package-pi-source.py reads committed git cat-file blob
bytes and records source commit/tree, per-file SHA256 and original blob IDs.
scripts/check-pi-package.py checks both SHA256 and Git IDs on every source file,
then can install/build/boot a clean extraction without DSH or credentials.
Generated archive/manifest/clean-extraction evidence belongs in deliverables;
the archive records its exact source checkpoint, excluding deliverables and all
live runtime/dependency directories. No CRLF conversion or repaired hash is used.

Delivery transport: the required prepared Library helper failed before preparing
uploads: hosted apps tools/list request failed: network. No Library file ID or
upload session was returned. Deliverables are therefore retained on the authorized
private development branch with exact commit/file URLs. Local cloud paths are not
presented as user-downloadable links. No permission/credential change was made.
