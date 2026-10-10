# Muse shared-host development checkpoint

Date: 2026-10-11 (Asia/Shanghai).

## Source provenance

The connected Workspace — xy identity and inbox calls succeeded. The inbox was
empty and its exposed tools offered no repository/file download operation.
The existing project record identified the authorized private repository
`magicy565-web/workspace-agent` and Draft PR #15.

All 177 source blobs from PR head
`8086dbb1f526f5c0724fb938133cfe21a24d250c` were fetched through the authorized
GitHub connector and individually verified against their Git blob SHA-1 values.
This is the Workspace application source, not a download from the xy server.
The separately distributed complete DeepSeek Harness native source is absent.
The production release directory names have not been established as Git SHAs.

The older native plugin branch at
`40e43453172a109f0227445f7c60e7eb58c12a8c` was read for architectural context.
Its `personalWorkers`/actor services differ from this PR's WorkerDesk/Muse task
collections; it cannot establish current production compatibility.

## Implemented increment

- Extract `createMuseWorkerHost` so a parent can pass existing store/artifact
  services and register its adapter before constructing the parent WorkerDesk.
- Mount only the Muse prefix and preserve unrelated host routes. Keep separate
  Bearer credentials, Worker IDs, task queues and explicit execution gates.
- Fence new HTTP/adapter work synchronously on disposal and drain accepted
  operations before parent services close. Preserve attempts, fencing and
  cancellation; closing does not cancel or restart external execution.
- Use this same mount in `createApp`, including startup rollback and shutdown.

## Executed validation

Node.js 24.21.0, Windows x64:

```sh
node --test test/muse-worker.host.test.mjs test/muse-worker.contract.test.mjs test/muse-worker.probe.test.mjs
```

18 passed, 0 failed, 0 skipped: seven new host tests, three contract checks and
eight existing probe checks. The host tests use actual local HTTP and genuine
bridge/WorkerDesk modules with explicitly in-memory parent store/artifact
fixtures. The fixture delivery is synthetic; no real research or tool receipt
is claimed. The tests cover authentication, existing-route preservation,
configuration collisions, execution gates, claim/upload/submit/manual acceptance,
retained cancellation on remount and draining both HTTP and adapter operations.

`node --check` passed for `server/index.mjs`, `server/muse-worker-host.mjs` and
`test/muse-worker.host.test.mjs`. Frontend files were unchanged; this checkpoint
does not claim a new frontend build or full backend regression.

An initial attempt to run contract, HTTP, recovery and probe files produced
11 passed and 11 failures. Disk-backed setup failed with `EPERM` from directory
`fsync` in `server/store.mjs`; it could not exercise the HTTP/recovery behavior.
No storage check was weakened to make these tests pass. Rerun the disk-backed
tests and the full backend suite on a supported Linux host before deployment.
The seven new host tests do not replace those disk-backed checks.

## Remaining live checks

Production Cordis mounting, native actor authority, single-writer integration,
dedicated Muse HTTPS ingress, Secure Vault authorization, real identity/inbox,
provider budget enforcement and live task/cancellation acceptance remain
unverified. No server service, credential, OAuth binding or paid task was changed
by this checkpoint. `createMuseWorkerHost` supplies a tested integration seam;
it does not supply an adapter for the uninspected production personalWorkers
service or declare Muse online.
