import { promises as fs, constants } from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { assertWindowsDirectoryVolume } from './windows-volume.mjs';
import { assertPrivateWindowsPath } from './windows-private-acl.mjs';
import { validateMuseJointSlots } from './muse-worker-slot.mjs';
import { validateMuseDraftRegistry } from './muse-draft.mjs';
import { validateAiWorksState } from './ai-works.mjs';

import {validateWorkspaceModelBudgetState} from './workspace-model-budget.mjs';

export const STORE_VERSION = 3;
export const SUPPORTED_STORE_VERSIONS = Object.freeze([1, 2, STORE_VERSION]);
export const defaultSettings = { name: 'Workspace', language: 'zh', model: 'deepseek-flash', maxGoalSteps: 3 };
const baseCollections = ['conversations', 'messages', 'goals', 'activity', 'memories'];
const capabilityCollections = ['skills', 'connectors', 'approvals', 'schedules', 'scheduleRuns', 'connectorRuns'];
const unsafeKeys = new Set(['__proto__', 'prototype', 'constructor']);
const storeError = (code, message, cause) => Object.assign(new Error(message, cause ? { cause } : undefined), { code });
const invalid = () => storeError('WORKSPACE_DATA_INVALID', 'Unsupported or invalid workspace data; no data has been overwritten.');
const migrationBackupNames = Object.freeze({ 1: 'workspace.v1.backup.json', 2: 'workspace.v2.backup.json' });
const abandonedWriteName = /^workspace\.(?:json|v[12]\.backup\.json)\.[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.tmp$/u;
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const iso = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
const freshCapabilities = () => ({ version: 1, ...Object.fromEntries(capabilityCollections.map(key => [key, []])) });
const freshBusinessLibrary = time => ({ version: 1, company: { id: 'company', revision: 1, legalName: '', displayName: '', description: '', createdAt: time, updatedAt: time }, products: [], documents: [], operations: [], conversationReferences: [], disclosureGrants: [], enterpriseMemories: [] });
const fresh = () => {
  const time = new Date().toISOString();
  return { version: STORE_VERSION, meta: { sequence: 0, createdAt: time, updatedAt: time }, ...Object.fromEntries([...baseCollections, 'runs', 'artifacts'].map(key => [key, []])), capabilities: freshCapabilities(), businessLibrary: freshBusinessLibrary(time), settings: { ...defaultSettings } };
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

export function validateState(state, version = STORE_VERSION) {
  validateJson(state);
  if (!SUPPORTED_STORE_VERSIONS.includes(version) || !isObject(state) || state.version !== version || !isObject(state.settings)) throw invalid();
  for (const key of baseCollections) validateCollection(state[key]);
  if (version === 1) return;
  for (const key of ['runs', 'artifacts']) validateCollection(state[key]);
  validateWorkspaceModelBudgetState(state);
  if (!isObject(state.meta) || !Number.isSafeInteger(state.meta.sequence) || state.meta.sequence < 0 || !iso(state.meta.createdAt) || !iso(state.meta.updatedAt)) throw invalid();
  if (!isObject(state.capabilities) || state.capabilities.version !== 1) throw invalid();
  for (const key of capabilityCollections) validateCollection(state.capabilities[key]);
  // Preserve mainline Worker, expert, and personal Dot records through v2 → v3.
  for (const key of ['workerOrders', 'workerOpportunities', 'cloudExperts', 'cloudTeams', 'dotTasks', 'museTasks', 'commerceProjects']) {
    if (state[key] !== undefined) validateCollection(state[key]);
  }
  validateMuseJointSlots(state);
  validateMuseDraftRegistry(state);
  if (state.dotLastSeenAt !== undefined && !iso(state.dotLastSeenAt)) throw invalid();
  if (state.museLastSeenAt !== undefined && !iso(state.museLastSeenAt)) throw invalid();
  if (version === 2) return;
  const library = state.businessLibrary;
  if (!isObject(library) || library.version !== 1 || !isObject(library.company)) throw invalid();
  const company = library.company;
  if (company.id !== 'company' || !Number.isSafeInteger(company.revision) || company.revision < 1 || !iso(company.createdAt) || !iso(company.updatedAt)) throw invalid();
  for (const key of ['legalName', 'displayName', 'description']) if (typeof company[key] !== 'string') throw invalid();
  for (const key of ['products', 'documents', 'operations']) validateCollection(library[key]);
  if (Object.hasOwn(library, 'conversationReferences')) validateCollection(library.conversationReferences);
  if (Object.hasOwn(state, 'workspaceConversationCreations')) {
    const registry = state.workspaceConversationCreations;
    if (!isObject(registry) || registry.version !== 1 || !Array.isArray(registry.receipts) || registry.receipts.length > 10000) throw invalid();
    const seen = new Set();
    for (const row of registry.receipts) {
      if (!isObject(row) || Object.keys(row).some(key => !['subject', 'workspaceId', 'requestId', 'fingerprint', 'conversationId'].includes(key)) ||
          !['subject', 'workspaceId', 'conversationId'].every(key => typeof row[key] === 'string' && row[key].length > 0 && row[key].length <= 256) ||
          typeof row.requestId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(row.requestId) || typeof row.fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(row.fingerprint)) throw invalid();
      const key = JSON.stringify([row.subject, row.workspaceId, row.requestId]);
      if (seen.has(key)) throw invalid(); seen.add(key);
    }
  }
  if (Object.hasOwn(state, 'workspaceWechatLoginAttempts')) {
    const registry = state.workspaceWechatLoginAttempts;
    if (!isObject(registry) || registry.version !== 1 || !Array.isArray(registry.codes) || registry.codes.length > 1000) throw invalid();
    const seen = new Set();
    for (const row of registry.codes) {
      if (!isObject(row) || Object.keys(row).some(key => !['digest', 'expiresAt'].includes(key)) || typeof row.digest !== 'string' || !/^[a-f0-9]{64}$/.test(row.digest) || !Number.isSafeInteger(row.expiresAt) || row.expiresAt < 0 || seen.has(row.digest)) throw invalid();
      seen.add(row.digest);
    }
  }
  // V12 optional bridge receipt registry: legacy schema-v3 snapshots stay readable.
  if (Object.hasOwn(state, 'workerDelegations')) validateCollection(state.workerDelegations);
  // Optional platform AI-work product registry + development-plan delegations.
  // The first published AI-work is created lazily on startup; legacy snapshots
  // without this collection remain valid.
  if (Object.hasOwn(state, 'aiWorks')) {
    try { validateAiWorksState(state.aiWorks); } catch { throw invalid(); }
  }
  // Optional private single-enterprise sourcing pilot. No migration of legacy
  // records or assumption that these are multi-tenant-ready business tables.
  if (Object.hasOwn(state, 'supplyNetwork')) {
    const net = state.supplyNetwork;
    if (!isObject(net) || net.version !== 1 || !['suppliers', 'listings', 'inquiries', 'events', 'commands'].every(key => Array.isArray(net[key])) || net.shopifyObservation !== null && !isObject(net.shopifyObservation)) throw invalid();
    for (const key of ['suppliers', 'listings', 'inquiries', 'events', 'commands']) validateCollection(net[key]);
    for (const supplier of net.suppliers) if (typeof supplier.published !== 'boolean' || !Number.isSafeInteger(supplier.revision) || supplier.revision < 1 || !iso(supplier.createdAt) || !iso(supplier.updatedAt)) throw invalid();
    for (const listing of net.listings) if (typeof listing.published !== 'boolean' || !Number.isSafeInteger(listing.revision) || listing.revision < 1 || !iso(listing.createdAt) || !iso(listing.updatedAt)) throw invalid();
    for (const event of net.events) if (typeof event.public !== 'boolean' || !iso(event.createdAt)) throw invalid();
    if (net.shopifyObservation && (!Array.isArray(net.shopifyObservation.products) || !iso(net.shopifyObservation.observedAt))) throw invalid();
  }
  for (const item of [...library.products, ...library.documents]) if (!/^[A-Za-z0-9_-]{1,128}$/u.test(item.id)) throw invalid();
}

/** A private, canonical directory whose final component cannot be a symlink. */
export async function privateDirectory(directory) {
  const requested = path.resolve(directory);
  await fs.mkdir(requested, { recursive: true, mode: 0o700 });
  const info = await fs.lstat(requested);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('The workspace directory must be a real private directory, not a symbolic link.');
  const canonical = await fs.realpath(requested);
  if (process.platform === 'win32') await assertPrivateWindowsPath(canonical, { initializeEmpty: true });
  else await fs.chmod(canonical, 0o700);
  const identity = await fs.stat(canonical);
  return {
    directory: canonical,
    async verify() {
      const current = await fs.lstat(canonical);
      if (!current.isDirectory() || current.isSymbolicLink() || current.dev !== identity.dev || current.ino !== identity.ino || await fs.realpath(requested) !== canonical) throw new Error('The workspace directory changed while in use. Restart only after inspecting the data directory.');
      await assertPrivateWindowsPath(canonical);
    },
  };
}

export async function syncDirectory(directory) {
  const before = await fs.lstat(directory);
  if (!before.isDirectory() || before.isSymbolicLink()) throw new Error('Unsafe workspace directory for durability sync.');
  if (process.platform === 'win32') await assertWindowsDirectoryVolume(directory, before);
  // Node/libuv calls FlushFileBuffers on Windows, which requires write access.
  // POSIX retains its read-only directory handle. Never ignore a flush failure.
  const flags = (process.platform === 'win32' ? constants.O_RDWR : constants.O_RDONLY) | (constants.O_NOFOLLOW || 0);
  const handle = await fs.open(directory, flags);
  let failure;
  try {
    const actual = await handle.stat();
    const current = await fs.lstat(directory);
    if (!actual.isDirectory() || current.isSymbolicLink() || !current.isDirectory() || actual.dev !== before.dev || actual.ino !== before.ino || current.dev !== actual.dev || current.ino !== actual.ino) throw new Error('The workspace directory changed while being synced.');
    await handle.sync();
  } catch (error) { failure = error; }
  try { await handle.close(); } catch (error) { if (failure) failure.closeError = error; else failure = error; }
  if (failure) throw failure;
}

/** Opens regular, single-link files only; never follows a final-component symlink. */
export async function openPrivateFile(filename, { writable = false } = {}) {
  if (typeof writable !== 'boolean') throw new TypeError('Private file write access must be explicit.');
  const before = await fs.lstat(filename);
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1) throw new Error('Unsafe workspace file. Symbolic links and hard links are not supported.');
  await assertPrivateWindowsPath(filename);
  const handle = await fs.open(filename, (writable ? constants.O_RDWR : constants.O_RDONLY) | (constants.O_NOFOLLOW || 0));
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

async function migrationBackupStatus(directory, version) {
  const result = { file: migrationBackupNames[version], status: 'absent', scope: 'pre-upgrade-workspace-state-only', rollback: 'new-directory-only' };
  let raw;
  try { raw = await readPrivateFile(path.join(directory, result.file)); }
  catch (error) { return { ...result, status: error.code === 'ENOENT' ? 'absent' : 'unreadable' }; }
  try { validateState(JSON.parse(raw), version); }
  catch { return { ...result, status: 'invalid' }; }
  return { ...result, status: `verified-v${version}`, sha256: createHash('sha256').update(raw).digest('hex') };
}

/** Exclusive process lock. Ambiguous owners fail closed instead of risking split writers. */
export async function acquireWriterLock(directory, basename = 'workspace.lock') {
  // Establish the metadata-flush capability before creating or recovering any
  // lock. Unsupported storage must preserve existing ownership evidence.
  try { await syncDirectory(directory); }
  catch (cause) {
    if (cause.code === 'WORKSPACE_DURABILITY_UNSUPPORTED') throw cause;
    throw storeError('WORKSPACE_DURABILITY_UNSUPPORTED', 'Directory durability preflight failed. Existing data and writer locks have not been changed.', cause);
  }
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
    async release() { const value = await readOwner(); if (value?.token === token && value.pid === process.pid) { await syncDirectory(directory); await fs.unlink(lockname); await syncDirectory(directory); } },
  };
}

/** Single-writer, serialized JSON transactions with atomic replacement and explicit legacy migration. */
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
  let backupStatuses;
  const warnings = [];
  const listeners = new Set();

  async function prepareMigrationBackup(raw, version) {
    const backup = path.join(directory, migrationBackupNames[version]);
    const temporary = `${backup}.${randomUUID()}.tmp`;
    let handle;
    async function reuseExisting() {
      let existing;
      try { existing = await openPrivateFile(backup, { writable: process.platform === 'win32' }); }
      catch (error) { if (error.code === 'ENOENT') return false; throw error; }
      try {
        const bytes = await existing.readFile();
        if (!bytes.equals(Buffer.from(raw, 'utf8'))) throw storeError('WORKSPACE_MIGRATION_BACKUP_CONFLICT', `The v${version} migration backup could not be safely reused because it differs from workspace.json. Preserve both files and recover the validated v${version} source in a new directory; no workspace data has been overwritten.`);
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
      throw storeError('WORKSPACE_MIGRATION_BACKUP_FAILED', `The v${version} migration backup could not be safely created or its durability confirmed. Preserve the data directory and retry after correcting the storage problem; no workspace data has been overwritten.`, error);
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
      if ((await fs.readdir(directory)).some(name => Object.values(migrationBackupNames).includes(name) || abandonedWriteName.test(name))) throw storeError('WORKSPACE_STATE_MISSING', 'workspace.json is missing but previous workspace write or migration files remain. Preserve this directory and recover into a new data directory; no data has been overwritten.');
      phase = 'initialize'; startup.action = 'created'; state = fresh(); await persist(state);
    }
    else {
      diskDigest = createHash('sha256').update(raw).digest('hex');
      try { state = JSON.parse(raw); } catch (error) { throw storeError('WORKSPACE_DATA_UNREADABLE', 'Workspace data is unreadable; no data has been overwritten.', error); }
      phase = 'validate';
      if (Number.isInteger(state?.version) && !SUPPORTED_STORE_VERSIONS.includes(state.version)) throw storeError('WORKSPACE_VERSION_UNSUPPORTED', `Workspace schema version ${state.version} is unsupported by this application (supported: ${SUPPORTED_STORE_VERSIONS.join(', ')}). Use a compatible application or restore a verified compatible backup into a new directory; no data has been overwritten.`);
      startup.sourceVersion = state?.version;
      if ([1, 2].includes(state?.version)) {
        validateState(state, state.version);
        const previous = state;
        state = { ...fresh(), ...previous, version: STORE_VERSION };
        validateState(state);
        phase = 'migration-backup';
        startup.migrationBackup = await prepareMigrationBackup(raw, previous.version);
        phase = 'migration-commit';
        await persist(state);
        startup.action = 'migrated';
      } else { validateState(state); await fs.chmod(filename, 0o600); startup.action = 'opened'; }
    }
    phase = 'diagnostics'; backupStatuses = await Promise.all([1, 2].map(version => migrationBackupStatus(directory, version)));
    for (const [index, backup] of backupStatuses.entries()) if (['invalid', 'unreadable'].includes(backup.status)) warnings.push({ code: 'WORKSPACE_MIGRATION_BACKUP_UNAVAILABLE', message: `The pre-upgrade v${index + 1} backup cannot be verified. Current v3 data is valid; preserve both files and create a verified full backup before another upgrade. Do not use that file for rollback.` });
    phase = 'cleanup';
    // Only our abandoned atomic-write names are eligible for cleanup.
    for (const name of await fs.readdir(directory)) if (abandonedWriteName.test(name)) {
      // If the final backup cannot be verified, a staging file may be the only
      // remaining pre-upgrade evidence. Leave it for offline inspection.
      const backupIndex = [1, 2].findIndex(version => name.startsWith(`${migrationBackupNames[version]}.`));
      if (backupIndex !== -1 && backupStatuses[backupIndex].status !== `verified-v${backupIndex + 1}`) { startup.abandonedMigrationWritesRetained++; continue; }
      const item = path.join(directory, name); const info = await fs.lstat(item);
      if (info.isFile() || info.isSymbolicLink()) { await fs.unlink(item); startup.abandonedWritesRemoved++; }
    }
    if (startup.abandonedWritesRemoved) await syncDirectory(directory);
    if (startup.abandonedMigrationWritesRetained) warnings.push({ code: 'WORKSPACE_MIGRATION_STAGING_RETAINED', message: 'Abandoned migration staging files were retained because no verified final backup for their source version is available. Preserve them for offline inspection; they are not automatically trusted or restored.' });
  } catch (error) {
    error.phase = phase;
    try { await lock.release(); } catch { error.lockReleaseFailed = true; }
    throw error;
  }
  return {
    directory,
    read: () => {
      const result = structuredClone(state);
      // Earlier v3 snapshots remain valid without rewriting them on startup.
      // The first reference edit creates this optional collection in its own transaction.
      result.businessLibrary.conversationReferences ??= [];
      result.businessLibrary.disclosureGrants ??= [];
      result.businessLibrary.enterpriseMemories ??= [];
      return result;
    },
    diagnostics: () => structuredClone({ state: closed ? 'closed' : poisoned ? 'writes-stopped' : 'open', schemaVersion: STORE_VERSION, supportedVersions: [...SUPPORTED_STORE_VERSIONS], startup, migrationBackup: backupStatuses[0], migrationBackups: backupStatuses, durability: poisoned ? 'uncertain' : 'confirmed', sequence: state.meta.sequence, warnings }),
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
