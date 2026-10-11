#!/usr/bin/env node
/** Offline verified recovery. Never overwrite an existing workspace or resume execution. */
import { promises as fs, constants } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { acquireWriterLock, openPrivateFile, syncDirectory, validateJson } from '../server/store.mjs';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const MAX_BYTES = 512 * 1024 * 1024, MAX_FILES = 120_000;
const exclusions = new Set(['workspace.lock', 'workspace.lock.recovery', 'artifacts/artifacts.lock', 'artifacts/artifacts.lock.recovery']);
const appPermitted = name => ['workspace.json', 'workspace.v1.backup.json', 'security/audit.jsonl', 'RECOVERY-REPORT.json'].includes(name) || /^artifacts\/[a-f0-9-]{36}\.v[1-9][0-9]*\.[a-f0-9]{64}\.blob$/.test(name);
const failure = message => { throw new Error(message); };
const nativeSessionFile = name => /^harness\/sessions\/[^/]+\/[^/]+\/(?:session(?:\.v[1-9][0-9]*)?\.jsonl(?:\.zstd)?|session\.lock)$/.test(name);
const safeRelative = name => typeof name === 'string' && name.length <= 4096 && !name.includes('\\') && !/[\u0000-\u001f\u007f]/.test(name) && name.split('/').every(part => part && part !== '.' && part !== '..');
const nativePermitted = name => safeRelative(name) && (nativeSessionFile(name) || /^(?:harness\/(?:attachments\/v1|storages|spills)|agent-workspace|recovery-quarantine)\//.test(name));
const nativeExcluded = name => ['harness/.credentials.yaml', 'harness/.env', 'harness/.anonymous-user-id'].includes(name) || name.startsWith('harness/.cache/') || name.startsWith('harness/logs/');
const attachmentHash = name => /^harness\/attachments\/v1\/(?:file-objects\/[a-f0-9]{2}\/([a-f0-9]{64})|files\/[a-f0-9]{2}\/([a-f0-9]{64})\/[^/]+)$/.exec(name)?.slice(1).find(Boolean);
const nativeLock = name => nativeSessionFile(name) && name.endsWith('/session.lock');
const permitted = (name, native = false) => safeRelative(name) && (appPermitted(name) || (native && nativePermitted(name) && !nativeLock(name)));
async function syncTree(directory) {
  await fs.chmod(directory, 0o700);
  for (const item of await fs.readdir(directory, { withFileTypes: true })) {
    const filename = path.join(directory, item.name);
    if (item.isDirectory()) await syncTree(filename);
    else { await fs.chmod(filename, 0o600); const handle = await openPrivateFile(filename, { writable: process.platform === 'win32' }); try { await handle.sync(); } finally { await handle.close(); } }
  }
  await syncDirectory(directory);
}
function nativeOptions(native, source) {
  if (!native || !['none', 'zstd'].includes(native.compression)) failure('Native recovery requires an explicit none or zstd compression mode.');
  return { runtimeVersion: '0.2.0-rc.2', compression: native.compression, requiredDataDirectory: source, workspaceDirectory: path.join(source, 'agent-workspace') };
}
function validateNativeSummary(summary, metadata, state) {
  if (summary?.runtimeVersion !== '0.2.0-rc.2' || summary.sessionFormatVersion !== 4 || summary.compression !== metadata.compression || !Array.isArray(summary.sessions)) failure('Native recovery runtime or session format is incompatible.');
  const ids = new Set();
  for (const item of summary.sessions) {
    if (typeof item.id !== 'string' || !item.id || ids.has(item.id) || item.cwd !== metadata.workspaceDirectory || !Number.isSafeInteger(item.eventCount) || item.eventCount < 0) failure('Native session identity or original workspace path is invalid.');
    ids.add(item.id);
  }
  for (const item of [...state.conversations, ...state.runs]) if (item.nativeSessionId && !ids.has(item.nativeSessionId)) failure('A Workspace native session mapping has no durable native history.');
}
async function nativeInspection(source, metadata, state, adapter) {
  if (!adapter || typeof adapter.inspect !== 'function' || typeof adapter.quarantine !== 'function' || typeof adapter.acquireLeases !== 'function') failure('Use the reviewed native recovery adapter to verify complete native session history.');
  const summary = await adapter.inspect(path.join(source, 'harness', 'sessions'), metadata.compression, { workspaceDirectory: metadata.workspaceDirectory });
  validateNativeSummary(summary, metadata, state);
  return summary;
}
async function realDirectory(directory) {
  const name = path.resolve(directory); const info = await fs.lstat(name);
  if (!info.isDirectory() || info.isSymbolicLink() || await fs.realpath(name) !== name) failure('Use a canonical real directory with no symbolic path components.');
  return name;
}
async function bytes(filename, maximum = MAX_BYTES, expectedAttachmentHash) {
  let handle;
  if (expectedAttachmentHash) {
    // Native attachment file-objects and filename aliases intentionally share
    // an inode. Read bounded regular bytes; restored copies are independent.
    const before = await fs.lstat(filename);
    if (!before.isFile() || before.isSymbolicLink()) failure('Unsafe native attachment file.');
    handle = await fs.open(filename, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
    const actual = await handle.stat();
    if (!actual.isFile() || actual.ino !== before.ino || actual.dev !== before.dev) { await handle.close(); failure('Native attachment changed while being opened.'); }
  } else handle = await openPrivateFile(filename);
  try { const info = await handle.stat(); if (info.size > maximum) failure('Recovery file exceeds its size limit.'); const value = await handle.readFile(); if (value.length !== info.size || value.length > maximum) failure('Recovery file changed while being read.'); if (expectedAttachmentHash && digest(value) !== expectedAttachmentHash) failure('Native attachment bytes do not match their content-addressed identity.'); return value; } finally { await handle.close(); }
}
async function walk(root, prefix = '') {
  const names = [];
  for (const entry of await fs.readdir(path.join(root, prefix), { withFileTypes: true })) {
    const name = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isSymbolicLink()) failure('Recovery refuses symbolic links.');
    if (entry.isDirectory()) names.push(...await walk(root, name));
    else if (entry.isFile()) names.push(name);
    else failure('Recovery only supports regular files.');
    if (names.length > MAX_FILES) failure('Recovery file count limit exceeded.');
  }
  return names.sort();
}
function validateState(state, manifestFiles) {
  validateJson(state);
  if (state?.version !== 2 || !Number.isSafeInteger(state.meta?.sequence) || !state.settings || !state.capabilities) failure('Only valid v2 workspace backups are supported.');
  for (const name of ['conversations', 'messages', 'goals', 'activity', 'memories', 'runs', 'artifacts']) if (!Array.isArray(state[name])) failure('Invalid workspace collection.');
  for (const name of ['skills', 'connectors', 'approvals', 'schedules', 'scheduleRuns', 'connectorRuns']) if (!Array.isArray(state.capabilities[name])) failure('Invalid workspace capability collection.');
  // Optional external Worker collections must be well-formed before a backup is
  // trusted for restore. State validation will run again on Workspace startup.
  for (const name of ['workerOrders', 'dotTasks', 'museTasks']) {
    if (state[name] === undefined) continue;
    if (!Array.isArray(state[name])) failure('Invalid external Worker backup collection.');
    const seen = new Set();
    for (const task of state[name]) {
      if (!task || typeof task.id !== 'string' || !task.id || task.id.length > 256 || seen.has(task.id))
        failure('Invalid or duplicate external Worker identity in backup.');
      seen.add(task.id);
    }
  }
  for (const artifact of state.artifacts) {
    if (!/^[a-f0-9-]{36}$/.test(artifact.id) || !Array.isArray(artifact.versions)) failure('Invalid artifact backup record.');
    for (const version of artifact.versions) {
      const name = `artifacts/${artifact.id}.v${version.version}.${version.sha256}.blob`;
      const entry = manifestFiles.find(item => item.path === name);
      if (!entry || entry.bytes !== version.size || entry.sha256 !== version.sha256) failure('Artifact backup is missing or inconsistent.');
    }
  }
}
async function exclusiveDirectory(directory) {
  const name = path.resolve(directory);
  await realDirectory(path.dirname(name));
  try { await fs.mkdir(name, { mode: 0o700 }); } catch (error) { if (error.code === 'EEXIST') failure('Destination already exists. Choose a new directory; nothing was overwritten.'); throw error; }
  return name;
}
async function write(filename, content) { await fs.mkdir(path.dirname(filename), { recursive: true, mode: 0o700 }); const handle = await fs.open(filename, 'wx', 0o600); try { await handle.writeFile(content); await handle.sync(); } finally { await handle.close(); } }

export async function createBackup(dataDirectory, destination, { native, nativeAdapter } = {}) {
  const source = await realDirectory(dataDirectory), target = path.resolve(destination);
  if (target === source || target.startsWith(`${source}${path.sep}`)) failure('Keep backups outside the live data directory.');
  const lock = await acquireWriterLock(source); let created, leases;
  try {
    const metadata = native ? nativeOptions(native, source) : null;
    if (metadata) {
      if (!nativeAdapter?.acquireLeases) failure('Native backup requires the reviewed native recovery adapter.');
      leases = await nativeAdapter.acquireLeases(path.join(source, 'harness', 'sessions'));
    }
    const selected = [], excluded = [];
    for (const name of await walk(source)) {
      if (exclusions.has(name) || (metadata && nativeLock(name))) continue;
      if (metadata && nativeExcluded(name)) { excluded.push(name); continue; }
      if (!permitted(name, Boolean(metadata))) failure('Unrecognized data files are present. Review them before backup; native runtime homes require native-aware recovery.');
      selected.push(name);
    }
    if (!selected.includes('workspace.json')) failure('Workspace state is missing.');
    const payloads = []; let total = 0;
    for (const name of selected) { const value = await bytes(path.join(source, name), MAX_BYTES, metadata && attachmentHash(name)); total += value.length; if (total > MAX_BYTES) failure('Backup exceeds the 512 MiB recovery limit.'); payloads.push({ name, value }); }
    const state = JSON.parse(payloads.find(item => item.name === 'workspace.json').value.toString('utf8'));
    const summary = metadata ? await nativeInspection(source, metadata, state, nativeAdapter) : null;
    const manifest = { format: 'workspace-offline-backup', version: metadata ? 2 : 1, createdAt: new Date().toISOString(), scope: metadata ? 'workspace-v2-native-jsonl-artifacts-access-audit' : 'workspace-v2-artifacts-access-audit', nativeRuntimeIncluded: Boolean(metadata), ...(metadata ? { native: { ...metadata, ...summary }, excludedFiles: excluded } : {}), files: payloads.map(({ name, value }) => ({ path: name, bytes: value.length, sha256: digest(value) })) };
    validateState(state, manifest.files);
    await lock.verify(); created = await exclusiveDirectory(target);
    for (const item of payloads) await write(path.join(created, item.name), item.value);
    // The app lock plus native kernel leases protect known writers. Recheck the
    // entire inventory and byte digests before publishing an immutable snapshot.
    const again = (await walk(source)).filter(name => !exclusions.has(name) && !(metadata && (nativeLock(name) || nativeExcluded(name))));
    if (JSON.stringify(again) !== JSON.stringify(selected)) failure('Source inventory changed during backup.');
    for (const item of manifest.files) if (digest(await bytes(path.join(source, item.path), MAX_BYTES, metadata && attachmentHash(item.path))) !== item.sha256) failure('Source changed during backup.');
    await leases?.verify?.(); await lock.verify();
    await write(path.join(created, 'BACKUP-MANIFEST.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    await syncTree(created); await syncDirectory(path.dirname(created));
    const result = await verifyBackup(created, { nativeAdapter });
    return { ...result, backup: created };
  } catch (error) { if (created) await fs.rm(created, { recursive: true, force: true }); throw error; }
  finally { try { await leases?.release(); } finally { await lock.release(); } }
}
export async function verifyBackup(directory, { nativeAdapter } = {}) {
  const source = await realDirectory(directory);
  const raw = await bytes(path.join(source, 'BACKUP-MANIFEST.json'), 32 * 1024 * 1024);
  const manifest = JSON.parse(raw.toString('utf8')); validateJson(manifest);
  if (manifest.format !== 'workspace-offline-backup' || ![1, 2].includes(manifest.version) || !Array.isArray(manifest.files) || manifest.files.length > MAX_FILES) failure('Unsupported backup manifest.');
  const native = manifest.version === 2;
  if (native !== (manifest.nativeRuntimeIncluded === true)) failure('Backup native scope is inconsistent.');
  if (native && (!manifest.native || manifest.native.runtimeVersion !== '0.2.0-rc.2' || !['none', 'zstd'].includes(manifest.native.compression) || !path.isAbsolute(manifest.native.requiredDataDirectory) || manifest.native.workspaceDirectory !== path.join(manifest.native.requiredDataDirectory, 'agent-workspace'))) failure('Unsupported native backup version or workspace mapping.');
  const seen = new Set(); let total = 0; let state;
  for (const item of manifest.files) {
    if (!permitted(item.path, native) || seen.has(item.path) || !Number.isSafeInteger(item.bytes) || item.bytes < 0 || !/^[a-f0-9]{64}$/.test(item.sha256)) failure('Invalid backup entry.');
    seen.add(item.path); total += item.bytes; if (total > MAX_BYTES) failure('Backup exceeds the recovery limit.');
    const value = await bytes(path.join(source, item.path), MAX_BYTES, native && attachmentHash(item.path));
    if (value.length !== item.bytes || digest(value) !== item.sha256) failure('Backup integrity check failed.');
    if (item.path === 'workspace.json') state = JSON.parse(value.toString('utf8'));
  }
  const present = await walk(source);
  if (present.length !== seen.size + 1 || present.some(name => name !== 'BACKUP-MANIFEST.json' && !seen.has(name))) failure('Backup contains unlisted files.');
  validateState(state, manifest.files);
  const summary = native ? await nativeInspection(source, manifest.native, state, nativeAdapter) : null;
  if (native && JSON.stringify(summary.sessions) !== JSON.stringify(manifest.native.sessions)) failure('Native session inventory is inconsistent with its manifest.');
  return { verified: true, files: seen.size, bytes: total, manifestSha256: digest(raw), nativeRuntimeIncluded: native, ...(native ? { nativeSessions: summary.sessions.length, sessionFormatVersion: summary.sessionFormatVersion } : {}) };
}
export function quarantineRestoredState(state) {
  const result = structuredClone(state), at = new Date().toISOString();
  const error = { code: 'RESTORE_REVIEW_REQUIRED', message: 'Restored from backup. Review the previous attempt before an explicit retry; no automatic execution is permitted.' };
  for (const run of [...result.runs, ...result.capabilities.connectorRuns, ...result.capabilities.scheduleRuns]) if (['queued', 'running', 'dispatching'].includes(run.status)) Object.assign(run, { status: 'interrupted', finishedAt: at, error });
  for (const conversation of result.conversations) if (conversation.status === 'running') Object.assign(conversation, { status: 'blocked', activeRunId: null, lastError: error, updatedAt: at });
  for (const goal of result.goals) if (['running', 'queued'].includes(goal.status)) Object.assign(goal, { status: 'paused', runId: null, revision: (goal.revision || 0) + 1, lastError: error, updatedAt: at });
  for (const message of result.messages) if (message.status === 'pending') Object.assign(message, { status: 'blocked', error });
  for (const schedule of result.capabilities.schedules) Object.assign(schedule, { enabled: false, status: 'disabled', consent: null, revision: (schedule.revision || 0) + 1, updatedAt: at });
  for (const approval of result.capabilities.approvals) if (['pending', 'approved'].includes(approval.status)) Object.assign(approval, { status: 'denied', decidedAt: at });
  for (const item of [...result.capabilities.skills, ...result.capabilities.connectors]) Object.assign(item, { enabled: false, revision: (item.revision || 0) + 1, updatedAt: at });

  // Backup restoration must never revive outstanding delegations, even when
  // the original cloud agent still has an apparently unexpired lease.
  // Keep stable IDs and submission evidence for audit; revoke execution
  // authority and invalidate the original fence before any new host starts.
  for (const queueKey of ['dotTasks', 'museTasks']) {
    for (const task of result[queueKey] || []) {
      if (!['pending', 'claimed', 'blocked', 'cancel_requested'].includes(task.status)) continue;
      task.status = 'blocked';
      task.blockedReason = error.message;
      task.leaseUntil = null;
      task.fence = (Number.isSafeInteger(task.fence) ? task.fence : 0) + 1;
      task.updatedAt = at;
    }
  }
  for (const order of result.workerOrders || []) {
    if (order.status === 'approved') {
      order.status = 'draft';
      order.approvedBy = null;
      order.approvedAt = null;
    } else if (['dispatching', 'queued', 'running', 'input_required', 'cancel_requested'].includes(order.status)) {
      order.status = 'dispatch_uncertain';
    } else if (order.status !== 'dispatch_uncertain') continue;
    order.error = error;
    order.updatedAt = at;
  }

  result.meta = { ...result.meta, sequence: result.meta.sequence + 1, updatedAt: at };
  result.activity.push({ id: randomUUID(), type: 'workspace_restored', title: 'Workspace restored with execution paused', detail: 'Queued work interrupted; external Worker leases revoked; schedules disabled and approvals invalidated. Review before restarting work.', createdAt: at });
  result.activity = result.activity.slice(-2000); return result;
}
export async function restoreBackup(backupDirectory, destination, { nativeAdapter } = {}) {
  const verified = await verifyBackup(backupDirectory, { nativeAdapter }), source = await realDirectory(backupDirectory), target = path.resolve(destination);
  if (target === source || target.startsWith(`${source}${path.sep}`)) failure('Restore outside the backup directory.');
  const manifest = JSON.parse((await bytes(path.join(source, 'BACKUP-MANIFEST.json'))).toString('utf8'));
  let created;
  try {
    created = await exclusiveDirectory(target);
    await write(path.join(created, 'RECOVERY-INCOMPLETE.json'), `${JSON.stringify({ version: 1, sourceManifestSha256: verified.manifestSha256 })}\n`);
    await syncDirectory(created); await syncDirectory(path.dirname(created));
    for (const item of manifest.files) {
      const value = await bytes(path.join(source, item.path), MAX_BYTES, manifest.nativeRuntimeIncluded && attachmentHash(item.path));
      if (digest(value) !== item.sha256 || value.length !== item.bytes) failure('Backup changed during restore.');
      if (item.path === 'RECOVERY-REPORT.json') continue;
      const destinationPath = manifest.nativeRuntimeIncluded && item.path.startsWith('harness/storages/') ? `recovery-quarantine/${verified.manifestSha256}/${item.path}` : item.path;
      await write(path.join(created, destinationPath), item.path === 'workspace.json' ? `${JSON.stringify(quarantineRestoredState(JSON.parse(value.toString('utf8'))), null, 2)}\n` : value);
    }
    let native;
    if (manifest.nativeRuntimeIncluded) {
      await fs.mkdir(path.join(created, 'harness', 'sessions'), { recursive: true, mode: 0o700 });
      await fs.mkdir(path.join(created, 'agent-workspace'), { recursive: true, mode: 0o700 });
      const summary = await nativeAdapter.quarantine(path.join(created, 'harness', 'sessions'), manifest.native.compression, { workspaceDirectory: manifest.native.workspaceDirectory });
      const state = JSON.parse((await bytes(path.join(created, 'workspace.json'))).toString('utf8'));
      validateNativeSummary(summary, manifest.native, state);
      if (summary.permissionsReset !== true || summary.inFlightReplayed !== false || JSON.stringify(summary.sessions.map(item => item.id).sort()) !== JSON.stringify(manifest.native.sessions.map(item => item.id).sort())) failure('Native recovery did not establish safe execution state.');
      native = { runtimeVersion: summary.runtimeVersion, sessionFormatVersion: summary.sessionFormatVersion, compression: summary.compression, requiredDataDirectory: manifest.native.requiredDataDirectory, workspaceDirectory: manifest.native.workspaceDirectory, sessions: summary.sessions.length, permissionsReset: true, inFlightReplayed: false, storageDisposition: 'quarantined' };
    }
    const report = { version: 1, restoredAt: new Date().toISOString(), sourceManifestSha256: verified.manifestSha256, schedulesEnabled: false, connectorsEnabled: false, skillsEnabled: false, outstandingApprovalsValid: false, queuedWorkResumed: false, nativeRuntimeIncluded: Boolean(native), ...(native ? { native } : {}) };
    await write(path.join(created, 'RECOVERY-REPORT.json'), `${JSON.stringify(report, null, 2)}\n`);
    await syncTree(created);
    await fs.unlink(path.join(created, 'RECOVERY-INCOMPLETE.json')); await syncDirectory(created); await syncDirectory(path.dirname(created));
    return { restored: true, dataDirectory: created, ...report };
  } catch (error) { if (created) await fs.rm(created, { recursive: true, force: true }); throw error; }
}
async function main() {
  const args = process.argv.slice(2); const [command, source] = args.splice(0, 2);
  const destination = command === 'verify' ? undefined : args.shift();
  let runtimePackagePath, compression;
  while (args.length) { const option = args.shift(), value = args.shift(); if (option === '--native-runtime' && !runtimePackagePath && value) runtimePackagePath = value; else if (option === '--compression' && !compression && ['none', 'zstd'].includes(value)) compression = value; else failure('Unknown or incomplete recovery option.'); }
  if (!source || !['backup', 'verify', 'restore'].includes(command) || (command !== 'verify' && !destination) || (compression && (!runtimePackagePath || command !== 'backup')) || (runtimePackagePath && command === 'backup' && !compression)) failure('Usage: node scripts/recovery.mjs backup DATA NEW_BACKUP [--native-runtime BASE_PACKAGE_JSON --compression none|zstd] | verify BACKUP [--native-runtime BASE_PACKAGE_JSON] | restore BACKUP NEW_DATA [--native-runtime BASE_PACKAGE_JSON]');
  const nativeAdapter = runtimePackagePath ? await (await import('../server/native-recovery.mjs')).loadNativeRecoveryAdapter(runtimePackagePath) : undefined;
  const result = command === 'backup' ? await createBackup(source, destination, { native: runtimePackagePath ? { compression } : undefined, nativeAdapter }) : command === 'verify' ? await verifyBackup(source, { nativeAdapter }) : await restoreBackup(source, destination, { nativeAdapter });
  console.log(JSON.stringify(result, null, 2));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error.message); process.exitCode = 1; });
