# Workspace Agent: repository handoff

This is the `0.5.0-rc.2` development candidate. It is not production-ready.
Preserve the Muse goal-first home, existing chat and expert flows, guarded
execution runtime and source tree.

## Latest Muse / commerce checkpoint

The current development branch integrates the Muse home and focused goal session,
versioned enterprise product/company libraries and durable product hosting scopes.
Shopify Admin GraphQL verifies actual store identity and scopes, and reads tagged
order evidence; it does not publish, fulfill, spend or bill.
Read [Muse / commerce implementation and limits](docs/MUSE-COMMERCE-WORKSPACE.md)
before continuing this work. The default home is `/`; experts remain at `/workers`.

Verified locally: official build; 343 backend tests passed, 6 native-build tests
skipped, no failures; 19 DOM/HTTP regressions passed; 9 real Chromium business-flow
checks passed. The six skipped tests and real native/cloud/Shopify deployment
remain separate acceptance work. GitHub CI currently reports `startup_failure`
with no jobs started; local passing results do not imply CI passed.

## Run from source

Requires Node.js 24+. In an authorized dependency environment:

```sh
npm ci
npm run build
npm start
```

Open `http://127.0.0.1:8787`. Never expose default no-login local mode to the internet.
Read [GitHub deployment](docs/GITHUB-DEPLOYMENT.md) and the exact
[enterprise deployment contract](docs/DEPLOYMENT.md).

The repository contains app source, tests, lockfile, config examples and the MIT
native SDK client. It excludes credentials, runtime data, private reference media,
historical test logs, private delivery metadata and the optional complete native
source archive/index. Native integration requires a separately obtained, reviewed
runtime. See [NATIVE-HARNESS.md](NATIVE-HARNESS.md).

## Product and execution boundaries

One enterprise, one shared workspace and one backend writer. A conversation can
select bounded file versions, skill revisions and memory, show an execution plan,
request exact approval for a connector action, consume its real receipt, continue
and save a durable file. The included local library adapter is disabled until an
administrator configures it. All members share workspace data.

- `server/task-context.mjs`: bounded pinned input snapshots
- `server/workspace-bridge.mjs`: run-bound proposals, approvals and receipts
- `server/runtime.mjs`: durable bounded lifecycle and continuation
- `server/workspace-library.mjs`: reviewed local text-file connector
- `server/run-output.mjs`: idempotent generated output publication
- `server/harness-provider.mjs`: optional genuine native SDK integration

File content, connector results and memory are data, never instructions or
approval. Model text must not approve itself, enlarge capabilities, configure
credentials or execute arbitrary code. Preserve cancel, retry, stale-response,
permission and recovery fences. The application is not an official Muse product.

## Historical checkpoint verification

Checkpoint: 2026-10-04, before GitHub source publication.

- Latest backend implementation: 261/261 tests passed, zero skipped
- Native-focused fixtures: 36/36 passed; acceptance/billing fixtures: 13/13 passed
- Build and typecheck passed after recurrence UI changes
- Earlier UI checkpoint: 18/18 passed before the final recurrence UI edit
- Final 19-scenario UI suite: incomplete, not a passing final regression report
- Final offline clean install: failed with ENOTCACHED for xmlchars-2.2.0.tgz
- Final clean install/build, source-bound offline evidence generation and clean
  extracted startup/restart remain incomplete
- Real provider/native-profile, deployed host/TLS/SSO, visual browser acceptance
  and final independent security review remain separate unpassed gates

Counts overlap and must not be added. Historical logs are not included. No tests,
package installation, model call or server deployment were run by this repository
publication. See [VALIDATION.md](VALIDATION.md) for precise limitations.

## Continue safely

First resolve the previously denied dependency/test environment before rerunning
its blocked action. Do not route around network or reviewer restrictions. In an
authorized environment, complete final UI regression and clean install/build,
regenerate source-bound evidence, and check a clean extracted startup/restart.
A strict launch checker rejecting missing external evidence is expected; do not
weaken it or fill production evidence with local fixture results.

Live calls require fresh securely configured credentials, verified current prices,
a specifically authorized total budget and an enforceable provider-side hard cap.
GitHub publication alone grants none of those, and does not authorize deployment,
paid hosting, persistent access grants or external worker connections.
