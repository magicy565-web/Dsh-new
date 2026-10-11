# Windows durability compatibility

This is a compatibility change to the existing Store, Artifact service and offline recovery helper. It adds no database, queue, writer, scheduler or alternate persistence path. Local TT041 validation uses Node v24.21.0 on a fixed NTFS C volume; Linux was not rerun in this task.

## Cause and platform boundary

The original `syncDirectory()` opened the directory read-only. Identical read-only probes produced `EPERM/-4048/fsync` both inside and outside the execution sandbox. A separately created regular file synced successfully. A read/write directory handle also synced successfully. This distinguishes the directory handle access bug from the separate sandbox restriction on child processes.

Node v24.21.0's [bundled libuv Windows implementation](https://github.com/nodejs/node/blob/v24.21.0/deps/uv/src/win/fs.c) maps read-only and read/write flags to different Windows access rights and implements fsync with `FlushFileBuffers`. The [Windows API](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-flushfilebuffers) requires write access for that operation. Changing access rights preserves the flush operation; no error is suppressed.

The [MS-FSA flush algorithm](https://learn.microsoft.com/en-us/openspecs/windows_protocols/ms-fsa/0de7dc40-9627-437e-a4df-c4696cdc3d02) specifies persistent file attributes, directory metadata, and underlying storage flushing. Its [product behavior footnote 80](https://learn.microsoft.com/en-us/openspecs/windows_protocols/ms-fsa/4e3695bd-7574-4f24-a223-b4679c065b63) restricts directory-structure persistence to NTFS; other filesystems may report success without doing that work. A successful fsync alone therefore cannot establish this contract on every Windows filesystem.

## Existing adapter behavior

- Windows uses a read/write directory handle; POSIX retains read-only. The directory is checked before opening and against the opened handle and current pathname. Symlinks, replacement identities, hard-linked files and stolen writer locks remain rejected.
- A bounded, fixed read-only Windows command queries the actual directory volume with `GetVolumeInformationByHandleW`, its mount point with `GetVolumePathNameW`, and drive type with `GetDriveTypeW`. Only a writable fixed local NTFS volume with persistent ACL support passes. The target path is an environment value, never executable text. The command has no execution-policy switch, elevation, profile loading, network operation or ACL mutation. Compilation uses the existing platform runtime; nothing is installed. Restricted language, a blocked child process, a missing command, malformed output, unknown volume or unsupported filesystem fails closed.
- Successful volume checks are cached by canonical directory path/dev/ino, bounded to 64 identities. Identity is checked on each flush. This does not defend against an administrator or a malicious process with the same OS account controlling the storage, consistent with the original local-filesystem contract.
- Writer acquisition probes directory flushing before creating or recovering a lock. Failure returns `WORKSPACE_DURABILITY_UNSUPPORTED`, retaining the original OS error as `cause`, without changing existing state/writer/recovery lock bytes. Release probes again before unlinking the owned lock. No ACL or filesystem check can be disabled by application input.
- A temporary file is still fully written, file-synced and closed before authoritative rename. Directory sync and close must both succeed before a transaction resolves or subscribers receive a cursor. Before rename, failure leaves the old state/cursor intact. After rename, failure returns `WORKSPACE_COMMIT_UNCERTAIN`, retains the replacement in memory, stops further writes, and emits no durable cursor. When sync and close both fail, the sync error remains primary with `closeError` attached.
- Reusing a migration backup and syncing copied recovery files now request explicit write access on Windows, through the existing private-file checks. Ordinary reads stay read-only. No file is truncated and no replacement backup is manufactured.

These are OS flush guarantees, subject to the existing storage-device assumptions. Tests do not simulate physical power loss or establish guarantees for SMB/NFS, ReFS, removable media, arbitrary storage controllers, or the original Harness's own Session writer.

## Artifact ownership found by disk integration

The original root Artifact service ignored the trusted Host's `admission.workerOwner`; the Muse download guard correctly rejected those files. The service now validates and commits the exact subject/Worker UUID with the first artifact version and includes it in idempotency fingerprints. Existing unowned artifacts preserve their schema and fingerprint. Public artifact bodies still reject `workerOwner`. A retry under a different owner conflicts; malformed persisted ownership fails startup validation before cleanup. No second ownership write or broader download permission was added.

## Reproduction and evidence

`node scripts/check-windows-directory-sync.mjs` only compares directory handles. `node scripts/check-muse-store-durability.mjs` creates a new owned probe directory, commits one transaction through the original Store, closes and reopens it, and reports errors and retained names accurately.

In the ordinary task sandbox the volume query cannot spawn and the Store probe reports unsupported with `cause.syscall=spawn`, `cause.code=EPERM`, and no created lock/state files. Outside that child-process restriction, the same reviewed code commits and reloads sequence 1 on TT041. Running outside the sandbox did not change system permissions or execution policy.

The validation directory records initial failures, final test results, sandbox/host probes, and their SHA-256 values. Tests inject failures without production fault switches. Coverage includes directory permissions and identity, unsupported volume/ACL capability, exact lock preservation, file sync/close and rename failure, directory sync/close uncertainty, subscriber suppression, single writer/dead-PID recovery, migration process exits, backups/restores, immutable artifact versions and exact ID/version/SHA downloads.

The disk Muse fixture uses the real Store and Artifact service, but a synthetic native Session and synthetic Muse sender. It verifies one original delegation/task across reopening, attempt/fence/cancellation/late results, exact returned file bytes and enterprise acceptance. It does not verify a real PersonalMuse wake-up or model turn. A restarted claimed order retains the original reconciliation requirement; it is never silently restarted with a substitute job ID.
