# Validation status: 0.5.0-rc.2

Checkpoint date: 2026-10-04. This repository is a development candidate, not a
production-ready service. This status records prior verification accurately;
publication to GitHub did not run new tests or claim a deployment.

## Established checkpoint results

- Latest backend implementation: 261/261 tests passed, zero skipped
- Native-focused fixtures: 36/36 passed, zero skipped
- Acceptance/billing runner fixtures: 13/13 passed, zero skipped
- Build and TypeScript checks passed after the recurrence UI changes
- An earlier built-React/real-HTTP DOM checkpoint passed 18/18 scenarios before
  the final recurrence UI addition

Focused counts overlap the aggregate and are not additive. Native/model responses
were local fixtures; they do not establish live provider or account compatibility.

## Incomplete final verification

- The final recurrence UI edit and added 19th scenario have not received a full
  final DOM regression pass. Subsequent build passed and some earlier scenarios
  ran, but further output polling was denied because of an external npm registry
  request. Do not report 19/19, rerun the denied action, or bypass that restriction
- Final clean offline installation failed with ENOTCACHED for xmlchars-2.2.0.tgz.
  Clean install/build and current source-bound offline evidence remain incomplete
- Historical source/build fingerprints are stale and cannot prove current code
- Final clean extracted startup/restart was not rerun for this source revision
- macOS and Windows have not been validated on physical target systems

Resolve the exact dependency/test authorization and environment issue before
attempting blocked tests again. Historical raw evidence files are deliberately
not committed. Diagnostics must report absent or stale evidence truthfully.

## Independent production gates

These remain incomplete:

1. Fresh secure credentials, verified selected-model prices and a cumulative hard
   spending cap covering retries and native internal calls
2. Live FastAIToken/gpt-6-sol compatibility for the selected protocol and tools
3. Long-lived host, TLS, employee authentication, signed request ingress, durable
   single-writer disk and process supervision
4. Reviewed native profile/tool scope and complete target-specific backup/restore
5. Real desktop/mobile browser and visual acceptance
6. Final independent security review of the current code and target configuration

An interrupted earlier independent review is not approval, and must not be
restarted to bypass its restriction. Local fixtures, DOM tests and a committed
systemd template cannot substitute for these production gates.

## Verification commands for an authorized environment

```sh
npm ci
npm run typecheck
npm test
npm run test:ui
npm run test:recovery
npm run test:offline-evidence
node scripts/check-launch-gates.mjs
```

The optional native source/build must exist on that machine for native fixtures;
set `DSH_TEST_SOURCE_ROOT` to its reviewed absolute path. Missing native source
causes skips; the strict offline evidence command correctly rejects incomplete
coverage. Launch checks correctly return nonzero without real external evidence.
Do not disable these gates.

`test:release` and the legacy release-packaging scripts also need the separately
provided native archive/full manifest, omitted from this GitHub source repository.
See [GitHub deployment](docs/GITHUB-DEPLOYMENT.md), [enterprise deployment](docs/DEPLOYMENT.md)
and [native integration](NATIVE-HARNESS.md).
