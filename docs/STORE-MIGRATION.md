# Workspace store upgrades and startup recovery

The app-store schema remains **version 2**. This application opens v2 and upgrades
validated v1 state to v2; other integer schema versions are rejected. The package
release number and the store schema number are separate compatibility contracts.
There is no automatic downgrade and no supported in-place rollback.

## Upgrade guarantees and boundaries

An upgrade holds the normal exclusive workspace writer lock throughout:

1. Read and validate the authoritative `workspace.json` as v1
2. Construct and validate the proposed v2 state in memory
3. Write the exact original UTF-8 bytes to a private, unique migration staging file
4. Sync and close that file, then atomically rename it to
   `workspace.v1.backup.json` and sync the containing directory
5. Write, sync and atomically replace `workspace.json` with v2, then sync the
   containing directory again

A preexisting backup is reused only if its bytes exactly equal the current v1
source. It is made private and synced before reuse. A differing, incomplete or
unreadable backup is preserved and blocks the upgrade; it is never silently
replaced. Do not modify this directory from another process while it is open.

If the process exits during a staging write, the authoritative v1 source remains
intact. If it exits after publishing the backup, restart can reuse that complete
backup. If it exits after publishing v2, restart opens and validates v2 without
rerunning the migration. Bounded, recognized abandoned staging names are removed
only after a valid authoritative workspace is available. Migration staging files
are retained when the final v1 backup cannot be verified, so potentially useful
pre-upgrade evidence is not discarded.

`workspace.v1.backup.json` contains **only the pre-upgrade app-store state**. It is
not a full backup of artifacts, native sessions, plugin stores, credentials or
external services, and does not include writes made after the upgrade. It must
not be substituted for the complete offline recovery workflow in
[RECOVERY.md](RECOVERY.md).

## Diagnostics

`store.diagnostics()` returns a detached, content-free diagnostic object:

- Current state (`open`, `writes-stopped`, `closed`), schema compatibility,
  current committed sequence and confirmed/uncertain store durability
- Startup action (`created`, `opened`, `migrated`), source version, whether the
  exact migration backup was created or reused, and staging cleanup counts
- Startup inspection of the migration backup (`absent`, `verified-v1`, `invalid`,
  `unreadable`), its restricted scope and separate-directory rollback requirement
- A SHA-256 for a structurally valid v1 backup, plus any startup warnings

`verified-v1` means the file was readable, strict UTF-8 JSON and structurally
valid v1 at startup. It does not prove provenance, correspondence to the current
v2 state, a protected external checksum, or completeness of a full recovery.
Backup inspection is a startup snapshot, not a live integrity monitor. No model
calls, sessions, credentials or application content appear in these diagnostics.

Startup data errors have stable `code` values and a `phase` when the store writer
lock has been acquired. The principal decisions are:

| Code | Meaning and safe next step |
| --- | --- |
| `WORKSPACE_VERSION_UNSUPPORTED` | The stored schema is outside v1/v2. Use a compatible application or a verified compatible full backup in a new directory. Do not edit the version field. |
| `WORKSPACE_DATA_INVALID` / `WORKSPACE_DATA_UNREADABLE` | Preserve the source. Correct the access/storage problem or restore verified data into a new directory. |
| `WORKSPACE_MIGRATION_BACKUP_CONFLICT` | The saved backup differs from the still-authoritative v1 source. Preserve both; follow the isolated v1 recovery procedure below. |
| `WORKSPACE_MIGRATION_BACKUP_FAILED` | Backup creation or durability confirmation failed. The authoritative v1 state was not replaced. Correct storage availability/permissions before retrying. |
| `WORKSPACE_COMMIT_UNCERTAIN` | Replacement happened but directory sync failed. The file may already be v2. Writes are stopped; inspect storage, preserve the directory and reopen only after the storage issue is resolved. |
| `WORKSPACE_STATE_MISSING` | The main state is missing but backup/staging evidence remains. Startup refuses to create an empty replacement. Recover into a new directory. |
| `RESTORE_INCOMPLETE` | `RECOVERY-INCOMPLETE.json` exists, including an unexpected file type. Startup refuses before acquiring the writer lock. Preserve the failed destination and restore into a new one. |

A valid current v2 store can open when its older v1 backup is invalid/unreadable;
the diagnostic warning explicitly disables use of that file for rollback.
Recognized migration staging candidates are preserved if the final backup cannot
be verified. Review any warnings before the next upgrade or recovery drill.

## Recovering a v1 source blocked by an older partial backup

Earlier releases wrote the v1 backup directly to its final filename. A process
exit during that write can leave a partial `workspace.v1.backup.json` alongside
an intact, authoritative v1 `workspace.json`. The updated application preserves
this evidence and will not replace the partial backup automatically.

1. Stop the application and confirm no writer or native runtime is still active
2. Preserve the entire original directory using the authorized offline storage
   process; do not delete, rename or patch its state/backup files in place
3. Confirm the authoritative `workspace.json` is the intended complete v1 source.
   If it cannot be validated, use an independently verified recovery source
4. Create a distinct, new private data directory with exclusive creation. Copy
   only the intended v1 source to its new `workspace.json`, preserving exact bytes
   and private permissions. Do not copy the partial backup or abandoned locks
5. Open the copy with `openStore(newDirectory)` in an isolated store-only process.
   It validates the source before upgrading, creates a complete exact v1 backup,
   and does not instantiate a provider, scheduler, connector or native runtime
6. Confirm `startup.action` is `migrated`, `migrationBackup.status` is
   `verified-v1`, and compare both the new backup and retained old source bytes
7. Review the recovered records and any separately managed files before changing
   the deployment's data-directory setting. Keep credentials withheld during
   application-level review; approve any subsequent execution explicitly

This is isolated recovery of a v1 app-store source, not an in-place downgrade or
a substitute for a complete v2/native restore. To roll back an application
release, prefer a verified full pre-upgrade snapshot plus a known-compatible
application in a new destination. Going back to the v1 snapshot loses later
writes and requires deliberate reconciliation; never rewrite v2's version field.

## Test evidence and remaining operational limits

`node --test test/store.test.mjs test/store-migration.test.mjs` includes real child
process exits during partial backup writing, after staging sync, after backup
publication, and before/after v2 publication. It also injects local write and
directory-sync failures, checks repeat startup, byte-for-byte preservation,
version diagnostics, missing-primary handling and incomplete-restore refusal.

These deterministic local tests are not a physical power-loss test, a production
restore drill, a proof of filesystem guarantees, or Windows/macOS host
acceptance. Directory sync and atomic replacement must be supported by the final
host filesystem. The single-writer assumption remains mandatory. An unreadable
or ambiguous writer/recovery lock still fails closed and needs offline review;
startup does not guess ownership or delete ambiguous locks. App-store recovery
does not undo external tool side effects or establish whether uncertain work ran.
