# Durable workspace storage

## Data layout and compatibility

The server stores the workspace under `WORKSPACE_DATA_DIR` (default `.data/`). This is a private, single-operator data directory, separate from `dist/` and never served as static content.

- `workspace.json`: authoritative schema version 2, JSON metadata and application state
- `workspace.v1.backup.json`: exact original bytes retained before the first successful v1 migration
- `workspace.lock`: exclusive process ownership; removed on clean shutdown
- `artifacts/`: private content blobs and its own `artifacts.lock`

Version 2 retains the original `conversations`, `messages`, `goals`, `activity`, `memories` and `settings` fields. It adds `runs`, `artifacts`, `meta: {sequence, createdAt, updatedAt}`, and the nested `capabilities: {version: 1, skills, connectors, approvals, schedules, scheduleRuns, connectorRuns}` domain. All collections are arrays. Existing saved text memories remain saved text memories; migration does not silently upload, convert, enable, execute, or transmit them.

Opening valid v1 data validates its structure, preserves its existing records, settings and extension fields, writes and syncs a byte-for-byte private backup without overwriting a conflicting backup, then atomically commits v2. Reopening v2 does not repeat migration. Invalid JSON, unsupported schema versions, duplicate/missing record IDs, malformed collections, prototype-unsafe keys, and non-JSON transaction values are rejected. An unreadable or invalid existing database is never replaced with an empty one.

## Transaction contract

`openStore(directory)` returns:

- `directory`: canonical private directory
- `read()`: detached snapshot, including the durable `meta.sequence` cursor
- `update(callback)`: serialized asynchronous transaction; the callback itself must be synchronous
- `subscribe(listener)`: observe successful durable commits; returns an unsubscribe function
- `close()`: stop accepting writes, drain accepted transactions and release the writer lock

Updates operate on isolated copies. Callback errors, invalid data and asynchronous callbacks cannot partially modify live or persisted state. A committed snapshot is detached from references retained by callbacks. Callers also receive detached return values.

A transaction writes a new exclusive temporary file, syncs it, renames it over `workspace.json`, then syncs the directory entry. Its sequence increases once per successful transaction, including a no-op transaction. Subscribers receive only `{sequence, updatedAt}` after commit; listener exceptions cannot roll back the commit or break other subscribers. This is a state-invalidation notification, not an event history or durable event replay log. Reconnect consumers should fetch a fresh bootstrap snapshot.

The current file's SHA-256 is compared with the last authoritative file before each write. Out-of-band edits, file removal, corruption, replaced locks, symlinks and hard links are refused. If replacement succeeds but directory-sync durability cannot be confirmed, the in-memory state follows the replacement and further writes are stopped until inspection/restart; the service never deletes blobs referenced by an uncertain commit.

## Process ownership and crash recovery

Live process owners prevent a second writer. A dead PID's lock can be recovered under an exclusive recovery guard, preventing concurrent stale-lock cleanup from admitting two writers. A reused live PID is conservatively treated as live. Malformed locks or an abandoned `.recovery` guard fail closed rather than guessing. Only generated atomic-write temporary names are eligible for startup cleanup.

Clean shutdown must close the artifact service before the store. Do not delete lock files while any workspace process is running. If ownership is ambiguous, stop all relevant servers, preserve a complete copy of the directory, inspect the lock's PID and the database, and resolve the abandoned lock manually. Recovery does not automatically retry model requests or external actions; those policies belong to the runtime and capability services.

Directories are created/restricted to mode `0700`, and new state, backups, locks and artifact blobs use `0600` on POSIX. Existing v2 state permissions are tightened after validation. POSIX file modes do not replace Windows ACLs. Directory fsync and permissions have been exercised on Linux; filesystem durability depends on the operating system and storage device. This implementation is intended for a local filesystem, not shared/NFS multi-host coordination, and does not defend against an administrator or malicious process with the same OS account controlling the entire directory.

## Artifact service interface

`await createArtifactService({store, directory?, maxBytes?, maxTotalBytes?, maxArtifacts?})` creates a private local service. The default artifact directory is `<store.directory>/artifacts` and must be separate from the database directory. It takes an exclusive writer lock. Methods:

| Method | Result |
| --- | --- |
| `list({q?, sourceGoalId?, sourceConversationId?, sourceRunId?} = {})` | Synchronous `{artifacts}` metadata list |
| `get(id)` | Synchronous `{artifact}` metadata |
| `create(body)` | Promise of `{artifact}`, or `{artifact, duplicate: true}` for an identical upload retry |
| `update(id, body)` | Promise of `{artifact}` |
| `delete(id)` | Promise of `{ok: true}`, with `cleanupPending: true` if physical cleanup needs a later restart |
| `read(id, {version?, encoding?} = {})` | Promise of `{artifact, version, encoding, content}`; `version` is a version metadata record |
| `download(id, {version?} = {})` / `export(...)` | Promise of `{artifact, version, bytes, filename, mimeType}`; bytes is a Node Buffer |
| `inspect(id)` | Promise of `{artifact, versions: [{version, available, verified, code?}]}` |
| `close()` | Drain accepted operations and release artifact ownership |

`service.limits` exposes the configured bounds. `service.recovery` reports startup orphan cleanup counts and missing/corrupt/unsafe version IDs without discarding their metadata. Get/list return historical snapshots even after service close; new I/O/mutations are refused.

### Create and update inputs

Create requires `filename` and exactly one of:

- `content`: a UTF-8 text string, including an empty string for an empty text file
- `base64`: canonical padded base64 with no data-URL prefix or whitespace

Optional fields: `mimeType` (must match extension), `title` (200 characters), `description` (4000 characters), `metadata` (safe plain JSON object, at most 16 KiB), `sourceGoalId`, `sourceConversationId`, `sourceRunId`, and `requestId` (128 characters). The request ID deduplicates identical creates and rejects reuse with different content or metadata. JSON object key ordering does not affect the fingerprint. Each source must exist when associated; supplied goal, conversation and run associations must be consistent. Later deletion of a source does not erase or invalidate a saved historical artifact.

Update accepts the same fields except `requestId`, with content optional and `expectedRevision` available for optimistic concurrency. Metadata-only changes increment `revision` without duplicating bytes. Replacing content appends a new version. Changing the file type requires new content. Source fields can be set to null to detach them. Current-version downloads use the latest display filename; older versions preserve the filename used when created.

Metadata includes the generated ID, current filename/MIME/byte count/SHA-256, title, description, source IDs, timestamps, revision, current version number, user metadata and all content-version records. No absolute filesystem path is returned. Raw content is not in bootstrap metadata, memory context or search indexing.

### Bounds and file safety

Default limits are 5 MiB decoded per version, 100 MiB across all retained versions, 1,000 artifacts, and 100 content versions per artifact. `maxBytes` may lower but not exceed the 5 MiB ceiling. HTTP artifact endpoints have their own bounded JSON envelope for base64 overhead; ordinary JSON routes retain the smaller default limit.

Accepted extensions/MIME pairs:

- `.txt`: `text/plain`
- `.md`: `text/markdown`
- `.csv`: `text/csv`
- `.json`: `application/json`
- `.pdf`: `application/pdf`
- `.png`: `image/png`
- `.jpg` / `.jpeg`: `image/jpeg`
- `.webp`: `image/webp`

HTML, SVG, JavaScript, executables and archives are not accepted. Text must be valid UTF-8 without NUL bytes; JSON files must parse. Binary types require their expected leading signatures. Signature checks are not a full-format validator, antivirus scan or guarantee that a document is safe to open in another application.

Display filenames are normalized and sanitized, with traversal paths, separators, control characters, hidden-file prefixes and reserved device names rejected. The submitted filename is never used as a disk path. Physical flat blob names contain only a server-generated UUID, version number and SHA-256. Regular-file checks, link-count checks, no-follow opens and pinned directory identity prevent ordinary symlink/hard-link escapes. Reads are size-bounded and verify length and SHA-256 every time. Content is never executed, previewed as active HTML, fetched from a remote URL, or uploaded to an external service.

HTTP downloads must be served as attachments with `X-Content-Type-Options: nosniff`, a restrictive sandbox CSP, an encoded filename and no-store caching. Do not expose `artifacts/` under a static web root. Downloading here means delivering saved bytes to the local authorized browser; it is not an external upload or background fetch.

### Crash-consistent blob lifecycle

A new version is fully written, synced and published before its metadata transaction commits. If the metadata commit fails, unreferenced newly written bytes are removed when safe. A crash before metadata commit leaves an orphan eligible for next-start cleanup; a crash after metadata commit leaves referenced durable bytes. Deletion commits removal of metadata before unlinking its versions, so interrupted deletion leaves harmless orphans rather than resurrecting records.

Startup validates all artifact metadata before cleanup, removes only recognized unreferenced blob and temporary-upload names, and preserves unrelated files. Missing, tampered or unsafe referenced bytes remain represented in metadata and are reported by recovery/inspection; reads fail explicitly instead of serving unverified data. Artifacts are not silently rebuilt from model text.

## Backup and restore

Normally stop the server, then back up the entire data directory, including `workspace.json`, the v1 backup if present, and all artifact blobs. Copying only `workspace.json` cannot recover artifact bytes. Restore a matched metadata-plus-blob snapshot while the server is stopped; never merge two live JSON snapshots or copy a running writer's locks into a second active workspace. The migration backup is a rollback source for the original v1 data, not a continuously updated backup.

## Verification

Run `node --test test/store.test.mjs test/artifacts.test.mjs` for focused storage coverage. Tests cover durable reload, one-time migration and exact backups, corrupt/unsupported inputs, isolated rollback and concurrent transactions, durable cursors and observer failures, writer lock recovery, private permissions, symlink/hard-link and path defenses, external corruption refusal, bounded upload formats, versions and revision conflicts, source associations, quotas, idempotent retry, binary round-trip, missing/tampered bytes, commit failure cleanup, deletion and orphan recovery. Existing HTTP/runtime tests remain part of the aggregate suite.
