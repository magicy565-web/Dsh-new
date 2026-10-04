# Native Harness offline recovery

This procedure covers the reviewed Harness 0.2.0-rc.2 JSONL runtime and its
application-owned local data. It is implemented separately from app-only backup.
It does not claim that remote workers, arbitrary plugin stores, a different native
profile or a production host have passed recovery acceptance.

## Declare the durable storage layout before running native work

Generate a new storage overlay, review it, then set DSH_RECOVERY_PATCH to it:

```
node scripts/generate-native-bridge.mjs --storage /absolute/data/harness zstd /absolute/new-storage.patch.yml
```

The patch pins session-persistence-jsonl to harness/sessions, attachment-local to
harness/attachments/v1, storage-json to harness/storages, and spill-local to
harness/spills. Compression is explicit: use zstd for the native default or none
for an already-plaintext installation. Never change compression in an existing
root. The adapter includes these exact patch bytes in its execution fingerprint.
This patch changes local storage locations only; the separate reviewed permission
and relay/bridge patches remain required. Review all profile plugins to ensure
none keeps authoritative state outside these roots. Historical temp-directory
spills must not be silently counted as complete backed-up data.

Supported snapshot content:

- App state, registered artifact versions and current access-audit segment
- All native immutable session generations, original IDs/lineage, JSONL events
  and semantic durable-log boundaries (not a separate fsync counter)
- Native attachments, content-addressed file aliases, contained spills and the
  native agent-workspace file tree
- Native durable KV stores, captured exactly and quarantined during restore

Credentials, .env, anonymous installation identity, cache and runtime diagnostic
logs are explicitly excluded from the native home and listed in the manifest.
Unknown files, unsupported profiles/state, out-of-root references, symbolic links,
non-regular files and incomplete mappings fail closed. Native content-addressed
attachment hardlinks are read with inode and digest checks; restored copies are
independent private files. No source link is followed into another directory.
Arbitrary workspace files may themselves contain private data: protect/encrypt
snapshots using your authorized backup system and never send production snapshots
to development or support chats. Earlier rotated audit archives have their own
retention location and must be retained separately.

Current native state refusals include image/offload projection records, team and
workflow events, native schedule changes and worker/schedule delivery histories.
These require their owning plugin recovery procedure; they are not silently
discarded or reported as a successful native backup.

## Create and verify a native snapshot

Stop ingress, stop Workspace, and confirm the owned native process exited. Do not
assume an app crash stopped every child. The backup tool takes the app writer lock
and actual native per-session kernel locks, then rechecks the inventory and every
source digest before publishing the snapshot. An existing native owner prevents
backup. Locks do not substitute for confirmed runtime shutdown or protect an
unrelated plugin's external store. This native lease path supports Linux/macOS;
Windows native recovery remains explicitly unsupported until a named-kernel-lock
backup implementation is reviewed and tested. App-only recovery is separate.

Use the built native base package's manifest as the explicit dependency resolver:

```
node scripts/recovery.mjs backup /absolute/data /absolute/new-backup --native-runtime /absolute/harness/packages/bundle/base/package.json --compression zstd
node scripts/recovery.mjs verify /absolute/new-backup --native-runtime /absolute/harness/packages/bundle/base/package.json
```

The loader accepts only matching reviewed public package versions. It does not
load the application profile, create an Agent or invoke any model/tool. Full log
reads use the native persistence API; metadata-only stat/list is insufficient.
Native backups have manifest format v2. App-only format v1 remains supported.
Retain the returned manifest SHA-256 in an independently protected record: local
checksums detect corruption, not malicious replacement of snapshot and manifest.

## Restore into a new, inactive directory

```
node scripts/recovery.mjs restore /absolute/new-backup /absolute/restored-stage --native-runtime /absolute/harness/packages/bundle/base/package.json
```

The destination must not exist. Restore creates an incomplete marker before any
app state is written; application startup refuses that marker. It removes the
marker only after all copies, native recovery and directory durability barriers
succeed. A failed operation preserves source and backup. A killed process leaves
an inspectable, unbootable staging directory; restore the verified backup into a
new destination rather than manually deleting its marker.

The native recovery adapter mounts only SessionStore and JSONL persistence. It
uses native interrupted-turn repair, cancels pending inbox entries, pauses native
goals and appends read-only sandbox / deny-all-approval policies. It does not
start agents, execute a tool, replay an in-flight call or retry an uncertain
external outcome. Old histories remain available, and the original session IDs
remain mapped to their app conversations. App schedules, skills and connectors
are disabled, outstanding approvals are denied, and queued/running app work is
interrupted. Native KV stores move to a digest-named recovery-quarantine subtree;
projection caches can be rebuilt, while queues and capability state require
explicit owner review rather than automatic replay.

Native migration uses the native write-open protocol on the disposable restored
tree. Older immutable generations and the original backup remain unchanged. A
failed migration never publishes a ready-to-start destination. Future versions,
unsupported migration paths and missing required history fail closed. A pre-
upgrade v1 app-store file alone is not a full native rollback; see
[STORE-MIGRATION.md](STORE-MIGRATION.md).

## Activate at the original absolute path

Native session cwd and historic tool/spill paths are immutable. This tool does
not rewrite or rebase them. The recovery report records the original absolute
WORKSPACE_DATA_DIR; native startup refuses a different path.

With ingress and every native process stopped, preserve the old data directory
under a different name, then move the fully restored stage into the exact original
absolute data path. Keep the original directory and snapshot until acceptance.
A crash between these two moves leaves the service stopped; do not allow a
supervisor to create a new empty directory in that interval. Use maintenance mode
and your host's reviewed activation procedure. For another host, provision the
same canonical absolute data path. Do not use a symlink to emulate it.

Start with provider credentials withheld. Check /api/health storage/recovery
facts, conversations, original native IDs, attachment/artifact bytes, audit and
quarantined stores. Health reports restore-time facts, not a production recovery
certification or proof of current permissions after subsequent operator edits.
Only explicitly requested new work may run. Restored native sessions initially
remain read-only and deny approval requests; review any required future permission
change separately. Reconnect and reapprove integrations/schedules individually.
Do not retry an external action until its destination establishes whether it ran.

## Evidence and remaining operating gates

The native-source fixture exercises real Harness persistence, checkpoints,
interrupted tool repair, permission reset, resume, generation migration and
kernel-lock contention with synthetic local model streams only. It is not a real
provider, production-profile, off-host or physical power-loss test. Before launch,
verify the chosen profile's complete storage inventory, backup encryption/readers,
retention/RPO/RTO, exact built runtime, OS/filesystem, controlled same-path
activation and a full off-host recovery drill. Remote workers and additional
plugins need their own authorized recovery owners and receipts.
