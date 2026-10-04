# Offline backup and disaster recovery

The bundled recovery tool supports v2 workspace state, artifact bytes and the
enterprise access audit. It does not copy credentials, deployments, TLS material,
identity-provider settings or external worker state. App-only mode refuses native
homes rather than silently omitting them. The implemented native-aware snapshot,
checkpoint recovery, permission reset and same-path activation procedure is in
[NATIVE-RECOVERY.md](NATIVE-RECOVERY.md). Choose that mode for native deployments.

## Create a verified snapshot

1. Put ingress into maintenance mode and stop the application normally
2. Confirm the process exited successfully; uncertain native shutdown is a blocker
3. Choose a new private directory outside the live data directory
4. Run `node scripts/recovery.mjs backup /absolute/data /absolute/new-backup`
5. Run `node scripts/recovery.mjs verify /absolute/new-backup`
6. Record the returned manifest SHA-256 in a separate protected record
7. Transfer/encrypt/retain the snapshot only using your authorized backup system
8. Restart the application and check session, state and health

The tool acquires the application's single-writer lock, rejects symbolic/hard
links and unknown files, checks every artifact against persisted hashes, writes
private files and verifies the copied bytes. It never overwrites a snapshot.
Maximum supported snapshot size is 512 MiB. This is an integrity checksum, not an
attestation: an attacker who can replace backup and manifest can recompute hashes.
Keep an independently protected manifest digest and protect the backup destination.

## Restore without re-executing uncertain work

1. Stop admission at ingress and stop the application
2. Preserve the current data directory; do not restore over it
3. Verify the selected snapshot and compare its protected external digest
4. Run `node scripts/recovery.mjs restore /absolute/backup /absolute/new-data`
5. Point WORKSPACE_DATA_DIR to the new directory through your deployment process
6. Start with provider credentials withheld until local state has been reviewed
7. Check conversations, artifact downloads and the security audit
8. Reconnect the approved provider only after reviewing interrupted work
9. Review and explicitly reapprove any schedules and connector actions

Restore always interrupts queued/running work, pauses active goals, disables all
schedules, skills and connectors and invalidates outstanding approvals before the restored server runs.
Browser login sessions are ephemeral and cannot survive restart. Native session
identities and histories are preserved only by the native-aware procedure. It does not undo previous
external actions, restore remote-provider state or make uncertain outcomes known.
Do not retry a connector action until the external target confirms whether it ran.

Incomplete restores are fenced from startup. Store upgrade compatibility and
crash-safe migration diagnostics are described in [STORE-MIGRATION.md](STORE-MIGRATION.md).

## Recovery drills and operating targets

The automated recovery test is a local, synthetic-data drill including byte
integrity, missing blobs, tampering, live-lock rejection and safe restart. It does
not establish a production RPO/RTO. Before launch, choose the backup frequency,
retention, encryption/key custody, authorized readers, off-host destination and
incident owner; measure a full restore in that target environment. Run a restore
drill before upgrades and repeat on a documented cadence. Never upload production
backups into development or support chats.

## Offline access-audit rotation

When the enterprise audit approaches its 64 MiB cap, stop ingress admission and
the application, wait until every signed assertion has expired (at most 30 seconds
after the last admission), and choose a new private file outside WORKSPACE_DATA_DIR.
Run `node scripts/rotate-access-audit.mjs --data /absolute/stopped-data --archive /absolute/private-archive/new-segment.jsonl`.
The tool takes the same writer lock, validates the full chain, fsyncs an exact
archive, then atomically replaces the active file with an anchored successor.
The successor records the previous segment digest, final hash and sequence. No
archive is overwritten, and the archive stays available if replacement fails.
Keep returned digests in independently protected records and include all audit
segments in the approved retention/backup policy. The regular workspace snapshot
contains only the active segment; earlier archives need separate retention.
If maintenance reports uncertainty, preserve both files and inspect before retry.
