# Read-only operational diagnostics

The existing Settings and Runtime Capabilities panels show one backend snapshot.
`GET /api/diagnostics` returns it directly; `GET /api/bootstrap` includes it as
`diagnostics`. Both require the same local or enterprise access boundary as other
workspace reads. Enterprise request admission can append required security audit
records; the diagnostic itself does not mutate workspace data, start a provider,
probe a connector, trigger a schedule, or perform a disk write test.

## Three different claims

- Configuration: server-side prerequisites are present or missing. No key,
  credential reference, arbitrary path, raw model result, or raw exception is
  returned in this snapshot. Configuration remains a prerequisite check.
- Local verification: `evidence/local-verification.json` describes completed
  backend and production React/HTTP/DOM fixtures for the source/build fingerprint.
  `npm run test:offline-evidence` writes this report only after every test passes,
  with zero skips. Startup checks its bounded structure and fingerprint. Missing,
  invalid, or mismatched evidence is explicitly labeled. A passing report applies
  to packaged code at startup, not installed credentials, live services, pixels,
  a production host, or an independent security assessment. Report consistency
  is not a trusted third-party certification. Replace/restart the process after
  changing deployed code; live code editing is outside the supported operation.
- Current-deployment live validation: `not_validated`, always separate from
  configuration and local tests. A successful observed provider return does not
  change this field. Run the separately authorized acceptance procedures only
  after their credential, scope, and spending prerequisites are met.

Diagnostics do not accept uploaded verification claims or writable provider
settings. They do not load or trust a pasted key. They never run the paid
acceptance scripts. Full release launch evidence still uses `npm run check:launch`.

## Endpoint contract (schemaVersion 1)

- `instanceId`: new random UUID for each application construction; never a saved
  session identifier. `startedAt` and `observedAt` are ISO timestamps.
- `staleAfterMs`: 15000; `readOnly:true`, `externalCalls:false`.
- `overall`: `setup_required`, `configured_unverified`, or `degraded`. This is an
  operational summary, not an authorization or a release-launch gate.
- `provider`: provider/kind/model, configured/configuration, localVerification,
  liveValidation, `onlineVerified:false`, and `lastObservation`.
- `lastObservation`: `not_observed|succeeded|failed|cancelled`, time, allowlisted
  error code or generic `PROVIDER_FAILURE`; scope is
  `current-process-provider-return`. It is reset after restart. An older
  concurrent completion cannot replace a newer admitted request's observation.
  No automatic request occurs on a read or refresh.
- `storage`: existing store diagnostics, `exclusiveWriter:true`, and
  `liveWriteProbe:false`. A confirmed durable previous write does not promise a
  future write will succeed or certify free space/full backup integrity.
- `scheduler`: actual application timer lifecycle, dispatcher configuration,
  interval, last tick start/completion, generic safe last error, and enabled/
  blocked counts. `starting|healthy|degraded|stale|stopped`; stale means no finished
  tick within the larger of 15 seconds or three configured intervals. Overlapping
  timer ticks are not launched. A failed tick is visible rather than swallowed.
  HTTP capability snapshots now accurately report `automaticTimer`.
- `connectors`: configuration counts, no credential refs, and each current
  connector revision's latest saved adapter result. A failed or interrupted
  current-revision result gets a review blocker; an adapter return is never proof
  of remote success or connection health. Old-revision outcomes remain in Runs.
- `recovery` and `access`: existing non-secret status facts.
- `blockers`: safe `{code,component,message,action}` records explaining a next
  step, with no execution controls in the refresh action.

`GET /api/status` preserves legacy `status:ready` as a configuration-only field
for API compatibility, and adds explicit `readiness`, `onlineVerified:false`, and
current-process `lastObservation`. New clients must not interpret `ready` as
live validation. `/api/health` retains its existing process/storage-oriented
liveness contract; use `/api/diagnostics` for operational detail.

## Outages, reconnection and restart

The UI timestamps the snapshot and receipt, marks old or failed reads visibly,
and does not silently retain a green readiness claim during a disconnect. A
refresh is one guarded GET. Later successful reads distinguish a reconnection
from a changed backend instance. Responses from a retired instance cannot replace
the newer instance. A new instance can have a lower store sequence after an
explicit restore without freezing the UI on the previous store snapshot.

After an ordinary restart, in-flight requests are interrupted and not replayed.
Previously approved queued work can still be admitted by the existing durable
queue rules, and enabled schedules can run while the server is running. A
read-only refresh does not authorize, resume, or retry either kind of work.
Restored data has the existing quarantine/review gates in the recovery runbook.

## Verification and remaining limits

The diagnostics tests use real local HTTP and explicitly labeled providers and
adapters. They cover missing and present configuration, no fees/external calls,
no workspace write on GET, safe failure details, observation ordering, restart,
scheduler failure/recovery/staleness, storage warnings, restored-data blockers,
connector failure/revision scoping, and invalid/stale local evidence. Production
React DOM tests additionally exercise UI refresh/outage/reconnect/restart flows.
DOM tests do not render pixels. Actual browser/visual, paid live provider, actual
host, target profile and independent security acceptance remain separate gates.
