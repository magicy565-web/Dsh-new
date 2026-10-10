import { promises as fs, constants } from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

export const STORE_VERSION = 2;
export const SUPPORTED_STORE_VERSIONS = Object.freeze([1, STORE_VERSION]);
export const defaultSettings = { name: 'Workspace', language: 'zh', model: 'deepseek-flash', maxGoalSteps: 3 };
const baseCollections = ['conversations', 'messages', 'goals', 'activity', 'memories'];
const capabilityCollections = ['skills', 'connectors', 'approvals', 'schedules', 'scheduleRuns', 'connectorRuns'];
const unsafeKeys = new Set(['__proto__', 'prototype', 'constructor']);
const storeError = (code, message, cause) => Object.assign(new Error(message, cause ? { cause } : undefined), { code });
const invalid = () => storeError('WORKSPACE_DATA_INVALID', 'Unsupported or invalid workspace data; no data has been overwritten.');
const migrationBackupName = 'workspace.v1.backup.json';
const abandonedWriteName = /^workspace\.(?:json|v1\.backup\.json)\.[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.tmp$/u;
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const iso = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
const freshCapabilities = () => ({ version: 1, ...Object.fromEntries(capabilityCollections.map(key => [key, []])) });
const fresh = () => {
  const time = new Date().toISOString();
  return { version: STORE_VERSION, meta: { sequence: 0, createdAt: time, updatedAt: time }, ...Object.fromEntries([...baseCollections, 'runs', 'artifacts'].map(key => [key, []])), capabilities: freshCapabilities(), settings: { ...defaultSettings } };
};

/** Reject values that JSON would silently alter, and unsafe object keys at every depth. */
export function validateJson(value, seen = new Set(), depth = 0) {
  if (depth > 100) throw invalid();
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number' && Number.isFinite(value)) return;
  if (typeof value !== 'object' || seen.has(value) || (!Array.isArray(value) && !isObject(value))) throw invalid();
  seen.add(value);
  if (Object.getOwnPropertySymbols(value).length) throw invalid();
  for (const key of Object.keys(value)) {
    if (unsafeKeys.has(key)) throw invalid();
    validateJson(value[key], seen, depth + 1);
  }
  if (Array.isArray(value) && Object.keys(value).length !== value.length) throw invalid();
  seen.delete(value);
}

function validateCollection(collection) {
  if (!Array.isArray(collection)) throw invalid();
  const ids = new Set();
  for (const item of collection) {
    if (!isObject(item) || typeof item.id !== 'string' || !item.id.trim() || item.id.length > 256 || /[\u0000-\u001f\u007f]/u.test(item.id) || ids.has(item.id)) throw invalid();
    ids.add(item.id);
  }
}

function validateState(state, version = STORE_VERSION) {
  validateJson(state);
  if (!isObject(state) || state.version !== version || !isObject(state.settings)) throw invalid();
  for (const key of baseCollections) validateCollection(state[key]);
  if (version === 1) return;
  for (const key of ['runs', 'artifacts']) validateCollection(state[key]);
  // Optional V2 additive collection; legacy stores acquire it on first Worker order.
  if (state.workerOrders !== undefined) validateCollection(state.workerOrders);
  if (state.workerOpportunities !== undefined) validateCollection(state.workerOpportunities);
  if (state.cloudExperts !== undefined) validateCollection(state.cloudExperts);
  if (state.cloudTeams !== undefined) validateCollection(state.cloudTeams);
  if (state.dotTasks !== undefined) validateCollection(state.dotTasks);
  if (state.dotLastSeenAt !== undefined && !iso(state.dotLastSeenAt)) throw invalid();
  if (state.museTasks !== undefined) validateCollection(state.museTasks);
  if (state.museLastSeenAt !== undefined && !iso(state.museLastSeenAt)) throw invalid();
  if (!isObject(state.meta) || !Number.isSafeInteger(state.meta.sequence) || state.meta.sequence < 0 || !iso(state.meta.createdAt) || !iso(state.meta.updatedAt)) throw invalid();
  if (!isObject(state.capabilities) || state.capabilities.version !== 1) throw invalid();
  for (const key of capabilityCollections) validateCollection(state.capabilities[key]);
}

/** A private, canonical directory whose final component cannot be a symlink. */
export async function privateDirectory(directory) {
  const requested = path.resolve(directory);
  await fs.mkdir(requested, { recursive: true, mode: 0o700 });
  const info = await fs.lstat(requested);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('The workspace directory must be a real private directory, not a symbolic link.');
  const canonical = await fs.realpath(requested);
  await fs.chmod(canonical, 0o700);
  const identity = await fs.stat(canonical);
  return {
    directory: canonical,
    async verify() {
      const current = await fs.lstat(canonical);
      if (!current.isDirectory() || current.isSymbolicLink() || current.dev !== identity.dev || current.ino !== identity.ino || await fs.realpath(requested) !== canonical) throw new Error('The workspace directory changed while in use. Restart only after inspecting the data directory.');
    },
  };
}

export async function syncDirectory(directory) {
  const handle = await fs.open(directory, 'r');
  try { await handle.sync(); } finally { await handle.close(); }
}

/** Opens regular, single-link files only; never follows a final-component symlink. */
export async function openPrivateFile(filename) {
  const before = await fs.lstat(filename);
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1) throw new Error('Unsafe workspace file. Symbolic links and hard links are not supported.');
  const handle = await fs.open(filename, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
  try {
    const actual = await handle.stat();
    if (!actual.isFile() || actual.nlink !== 1 || actual.dev !== before.dev || actual.ino !== before.ino) throw new Error('The workspace file changed while being opened.');
    return handle;
  } catch (error) { await handle.close(); throw error; }
}

async function readPrivateFile(filename) {
  const handle = await openPrivateFile(filename);
  try { return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(await handle.readFile()); } finally { await handle.close(); }
}

async function migrationBackupStatus(directory) {
  const result = { file: migrationBackupName, status: 'absent', scope: 'pre-upgrade-workspace-state-only', rollback: 'new-directory-only' };
  let raw;
  try { raw = await readPrivateFile(path.join(directory, migrationBackupName)); }
  catch (error) { return { ...result, status: error.code === 'ENOENT' ? 'absent' : 'unreadable' }; }
  try { validateState(JSON.parse(raw), 1); }
  catch { return { ...result, status: 'invalid' }; }
  return { ...result, status: 'verified-v1', sha256: createHash('sha256').update(raw).digest('hex') };
}

/** Exclusive process lock. Ambiguous owners fail closed instead of risking split writers. */
export async function acquireWriterLock(directory, basename = 'workspace.lock') {
  const lockname = path.join(directory, basename);
  const recoveryName = `${lockname}.recovery`;
  const token = randomUUID();
  const owner = { pid: process.pid, token, createdAt: new Date().toISOString() };
  async function claim() {
    const handle = await fs.open(lockname, 'wx', 0o600);
    try { await handle.writeFile(JSON.stringify(owner)); await handle.sync(); } finally { await handle.close(); }
  }
  async function readOwner() {
    let value;
    try { value = JSON.parse(await readPrivateFile(lockname)); } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw new Error('Workspace lock is unreadable. Inspect the data directory before restarting.');
    }
    if (!isObject(value) || !Number.isInteger(value.pid) || value.pid < 1 || typeof value.token !== 'string' || !value.token) throw new Error('Workspace lock is invalid. Inspect the data directory before restarting.');
    return value;
  }
  try { await claim(); } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    let recovery;
    try { recovery = await fs.open(recoveryName, 'wx', 0o600); }
    catch (error) {
      if (error.code === 'EEXIST') throw new Error('This workspace is already open or its writer lock is being recovered. Inspect an abandoned recovery lock before restarting.');
      throw error;
    }
    try {
      await recovery.writeFile(JSON.stringify(owner)); await recovery.sync();
      const previous = await readOwner();
      if (previous) {
        let alive = true;
        try { process.kill(previous.pid, 0); } catch (check) { if (check.code === 'ESRCH') alive = false; }
        if (alive) throw new Error('This workspace is already open in another server process.');
        await fs.unlink(lockname);
      }
      try { await claim(); } catch (error) { if (error.code === 'EEXIST') throw new Error('This workspace is already open in another server process.'); throw error; }
    } finally { await recovery.close(); await fs.unlink(recoveryName).catch(() => {}); }
  }
  await syncDirectory(directory);
  return {
    token,
    async verify() { const value = await readOwner(); if (value?.token !== token || value.pid !== process.pid) throw new Error('The workspace writer lock changed. No further writes are permitted.'); },
    async release() { const value = await readOwner(); if (value?.token === token && value.pid === process.pid) { await fs.unlink(lockname); await syncDirectory(directory); } },
  };
}

/** Single-writer, serialized JSON transactions with atomic replacement and explicit v1 migration. */
export async function openStore(directory) {
  const root = await privateDirectory(directory);
  directory = root.directory;
  const filename = path.join(directory, 'workspace.json');
  try {
    await fs.lstat(path.join(directory, 'RECOVERY-INCOMPLETE.json'));
    throw storeError('RESTORE_INCOMPLETE', 'This destination contains an incomplete restore. Preserve it for inspection and restore the verified backup into a new directory; the workspace has not been opened.');
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const lock = await acquireWriterLock(directory);
  let state;
  let diskDigest = null;
  let queue = Promise.resolve();
  let closePromise;
  let closed = false;
  let poisoned = false;
  let phase = 'read';
  const startup = { action: null, sourceVersion: null, migrationBackup: null, abandonedWritesRemoved: 0, abandonedMigrationWritesRetained: 0 };
  let backupStatus;
  const warnings = [];
  const listeners = new Set();

  async function prepareMigrationBackup(raw) {
    const backup = path.join(directory, migrationBackupName);
    const temporary = `${backup}.${randomUUID()}.tmp`;
    let handle;
    async function reuseExisting() {
      let existing;
      try { existing = await openPrivateFile(backup); }
      catch (error) { if (error.code === 'ENOENT') return false; throw error; }
      try {
        const bytes = await existing.readFile();
        if (!bytes.equals(Buffer.from(raw, 'utf8'))) throw storeError('WORKSPACE_MIGRATION_BACKUP_CONFLICT', 'The v1 migration backup could not be safely reused because it differs from workspace.json. Preserve both files and recover the validated v1 source in a new directory; no workspace data has been overwritten.');
        await existing.chmod(0o600); await existing.sync();
        return true;
      } finally { await existing.close(); }
    }
    try {
      await root.verify(); await lock.verify();
      if (await reuseExisting()) { await syncDirectory(directory); return 'reused'; }
      // Never expose a partial backup under its authoritative name. Under the
      // same single-writer lock, publish only fully written and synced bytes.
      handle = await fs.open(temporary, 'wx', 0o600);
      await handle.writeFile(raw); await handle.sync(); await handle.close(); handle = null;
      await root.verify(); await lock.verify();
      if (await reuseExisting()) { await syncDirectory(directory); return 'reused'; }
      await fs.rename(temporary, backup);
      await syncDirectory(directory);
      return 'created';
    } catch (error) {
      if (error.code === 'WORKSPACE_MIGRATION_BACKUP_CONFLICT') throw error;
      throw storeError('WORKSPACE_MIGRATION_BACKUP_FAILED', 'The v1 migration backup could not be safely created or its durability confirmed. Preserve the data directory and retry after correcting the storage problem; no workspace data has been overwritten.', error);
    } finally {
      if (handle) await handle.close().catch(() => {});
      await fs.unlink(temporary).catch(() => {});
    }
  }

  async function persist(next) {
    await root.verify(); await lock.verify();
    // Detect out-of-band edits, corruption, deletion and unsafe replacement before overwriting.
    try {
      const existing = await readPrivateFile(filename);
      if (createHash('sha256').update(existing).digest('hex') !== diskDigest) throw new Error('Workspace data changed outside this writer; no data has been overwritten.');
    } catch (error) { if (error.code !== 'ENOENT' || diskDigest !== null) throw error; }
    const temporary = `${filename}.${randomUUID()}.tmp`;
    let handle;
    let committed = false;
    try {
      handle = await fs.open(temporary, 'wx', 0o600);
      const serialized = `${JSON.stringify(next, null, 2)}\n`;
      await handle.writeFile(serialized); await handle.sync(); await handle.close(); handle = null;
      await root.verify(); await lock.verify();
      await fs.rename(temporary, filename); committed = true;
      diskDigest = createHash('sha256').update(serialized).digest('hex');
      await syncDirectory(directory);
    } catch (error) {
      if (handle) await handle.close().catch(() => {});
      await fs.unlink(temporary).catch(() => {});
      if (committed) { state = next; poisoned = true; throw storeError('WORKSPACE_COMMIT_UNCERTAIN', 'Workspace commit durability could not be confirmed. Writes are stopped; restart after inspecting the data directory.', error); }
      throw error;
    }
  }
  try {
    let raw;
    try { raw = await readPrivateFile(filename); }
    catch (error) { if (error.code !== 'ENOENT') throw storeError('WORKSPACE_DATA_UNREADABLE', 'Workspace data is unreadable; no data has been overwritten.', error); }
    if (raw === undefined) {
      // A missing authoritative file plus migration/write evidence is not a
      // new workspace. Do not hide possible data loss behind an empty store.
      if ((await fs.readdir(directory)).some(name => name === migrationBackupName || abandonedWriteName.test(name))) throw storeError('WORKSPACE_STATE_MISSING', 'workspace.json is missing but previous workspace write or migration files remain. Preserve this directory and recover into a new data directory; no data has been overwritten.');
      phase = 'initialize'; startup.action = 'created'; state = fresh(); await persist(state);
    }
    else {
      diskDigest = createHash('sha256').update(raw).digest('hex');
      try { state = JSON.parse(raw); } catch (error) { throw storeError('WORKSPACE_DATA_UNREADABLE', 'Workspace data is unreadable; no data has been overwritten.', error); }
      phase = 'validate';
      if (Number.isInteger(state?.version) && !SUPPORTED_STORE_VERSIONS.includes(state.version)) throw storeError('WORKSPACE_VERSION_UNSUPPORTED', `Workspace schema version ${state.version} is unsupported by this application (supported: ${SUPPORTED_STORE_VERSIONS.join(', ')}). Use a compatible application or restore a verified compatible backup into a new directory; no data has been overwritten.`);
      startup.sourceVersion = state?.version;
      if (state?.version === 1) {
        validateState(state, 1);
        const previous = state;
        state = { ...fresh(), ...previous, version: STORE_VERSION };
        validateState(state);
        phase = 'migration-backup';
        startup.migrationBackup = await prepareMigrationBackup(raw);
        phase = 'migration-commit';
        await persist(state);
        startup.action = 'migrated';
      } else { validateState(state); await fs.chmod(filename, 0o600); startup.action = 'opened'; }
    }
    phase = 'diagnostics'; backupStatus = await migrationBackupStatus(directory);
    if (['invalid', 'unreadable'].includes(backupStatus.status)) warnings.push({ code: 'WORKSPACE_MIGRATION_BACKUP_UNAVAILABLE', message: 'The pre-upgrade v1 backup cannot be verified. Current v2 data is valid; preserve both files and create a verified full backup before another upgrade. Do not use the v1 file for rollback.' });
    phase = 'cleanup';
    // Only our abandoned atomic-write names are eligible for cleanup.
    for (const name of await fs.readdir(directory)) if (abandonedWriteName.test(name)) {
      // If the final backup cannot be verified, a staging file may be the only
      // remaining pre-upgrade evidence. Leave it for offline inspection.
      if (name.startsWith(`${migrationBackupName}.`) && backupStatus.status !== 'verified-v1') { startup.abandonedMigrationWritesRetained++; continue; }
      const item = path.join(directory, name); const info = await fs.lstat(item);
      if (info.isFile() || info.isSymbolicLink()) { await fs.unlink(item); startup.abandonedWritesRemoved++; }
    }
    if (startup.abandonedWritesRemoved) await syncDirectory(directory);
    if (startup.abandonedMigrationWritesRetained) warnings.push({ code: 'WORKSPACE_MIGRATION_STAGING_RETAINED', message: 'Abandoned migration staging files were retained because no verified final v1 backup is available. Preserve them for offline inspection; they are not automatically trusted or restored.' });
  } catch (error) {
    error.phase = phase;
    try { await lock.release(); } catch { error.lockReleaseFailed = true; }
    throw error;
  }
  return {
    directory,
    read: () => structuredClone(state),
    diagnostics: () => structuredClone({ state: closed ? 'closed' : poisoned ? 'writes-stopped' : 'open', schemaVersion: STORE_VERSION, supportedVersions: [...SUPPORTED_STORE_VERSIONS], startup, migrationBackup: backupStatus, durability: poisoned ? 'uncertain' : 'confirmed', sequence: state.meta.sequence, warnings }),
    subscribe(listener) {
      if (typeof listener !== 'function') throw new TypeError('Store listener must be a function.');
      if (closed) throw new Error('Workspace store is closed.');
      listeners.add(listener); return () => listeners.delete(listener);
    },
    update(callback) {
      if (closed || poisoned) return Promise.reject(new Error(closed ? 'Workspace store is closed.' : 'Workspace writes are stopped after an uncertain disk commit.'));
      const task = queue.then(async () => {
        if (poisoned) throw new Error('Workspace writes are stopped after an uncertain disk commit.');
        const next = structuredClone(state);
        const result = callback(next);
        if (result && typeof result.then === 'function') { result.catch?.(() => {}); throw new Error('Store transactions must be synchronous.'); }
        const output = structuredClone(result);
        next.meta = { ...state.meta, sequence: state.meta.sequence + 1, updatedAt: new Date().toISOString() };
        validateState(next);
        // Detach from any reference retained by the callback before starting asynchronous I/O.
        const committed = structuredClone(next);
        await persist(committed); state = committed;
        const event = { sequence: state.meta.sequence, updatedAt: state.meta.updatedAt };
        for (const listener of listeners) { try { Promise.resolve(listener(Object.freeze({ ...event }))).catch(() => {}); } catch {} }
        return output;
      });
      queue = task.catch(() => {}); return task;
    },
    close() {
      if (closePromise) return closePromise;
      closed = true;
      closePromise = (async () => { await queue; listeners.clear(); await lock.release(); })();
      return closePromise;
    },
  };
}
