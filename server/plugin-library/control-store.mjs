import fs from 'node:fs/promises';
import path from 'node:path';
import { constants } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const plain = value => value && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
export function canonical(value, depth = 0) {
  if (depth > 20) throw new TypeError('Control-plane JSON is too deeply nested.');
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(item => canonical(item, depth + 1)).join(',') + ']';
  if (!plain(value)) throw new TypeError('Only plain finite JSON is accepted.');
  return '{' + Object.keys(value).sort().map(key => {
    if (['__proto__', 'constructor', 'prototype'].includes(key)) throw new TypeError('Reserved JSON key.');
    return JSON.stringify(key) + ':' + canonical(value[key], depth + 1);
  }).join(',') + '}';
}
export const controlDigest = value => sha(canonical(value));

/** Plugin review/intents only; not a business-data authority, grant store or Agent runtime. */
export async function openPluginControlStore({ directory, workspaceId, ApiError, clock = Date.now }) {
  const fail = (status, code, message) => { throw new ApiError(status, code, message); };
  if (typeof directory !== 'string' || !path.isAbsolute(directory) || directory !== path.resolve(directory)
    || typeof workspaceId !== 'string' || !workspaceId || workspaceId.length > 128 || workspaceId === 'local')
    fail(503, 'PLUGIN_CONTROL_CONFIGURATION_REQUIRED', 'A canonical private directory and enterprise workspace are required.');
  const stat = await fs.lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink() || await fs.realpath(directory) !== directory
    || process.platform !== 'linux' || (stat.mode & 0o077) !== 0 || stat.uid !== process.getuid())
    fail(503, 'PLUGIN_CONTROL_DIRECTORY_REFUSED', 'Use a pre-provisioned owner-only directory on the supported Linux host.');
  const lockPath = path.join(directory, 'writer.lock');
  let lock;
  try { lock = await fs.open(lockPath, constants.O_CREAT | constants.O_EXCL | constants.O_RDWR | (constants.O_NOFOLLOW || 0), 0o600); }
  catch (error) { if (error.code === 'EEXIST') fail(503, 'PLUGIN_CONTROL_WRITER_BUSY', 'A writer or unreviewed stale lock exists. No lock was removed.'); throw error; }
  const lockStat = await lock.stat();
  let healthy = true, closing = false, queue = Promise.resolve(), closePromise;
  const statePath = path.join(directory, 'state.json');
  let state;
  async function readState() {
    let handle;
    try { handle = await fs.open(statePath, constants.O_RDONLY | (constants.O_NOFOLLOW || 0)); }
    catch (error) { if (error.code === 'ENOENT') return { schemaVersion: 1, workspaceId, revision: 0, releases: [], intents: [], receipts: [], events: [] }; throw error; }
    try {
      const file = await handle.stat(), maximum = 2 * 1024 * 1024;
      if (!file.isFile() || file.nlink !== 1 || file.uid !== process.getuid() || (file.mode & 0o077) !== 0 || file.size > maximum)
        fail(503, 'PLUGIN_CONTROL_STATE_REFUSED', 'Plugin control state requires review; it was not reset.');
      const buffer = Buffer.alloc(maximum + 1);
      let length = 0;
      while (length < buffer.length) { const read = await handle.read(buffer, length, buffer.length - length, length); if (!read.bytesRead) break; length += read.bytesRead; }
      const after = await handle.stat();
      if (length > maximum || length !== file.size || file.size !== after.size || file.mtimeMs !== after.mtimeMs || file.ctimeMs !== after.ctimeMs)
        fail(503, 'PLUGIN_CONTROL_STATE_REFUSED', 'Plugin control state changed while reading; nothing was reset.');
      const value = JSON.parse(buffer.subarray(0, length).toString('utf8'));
      if (!plain(value) || value.schemaVersion !== 1 || value.workspaceId !== workspaceId || !Number.isSafeInteger(value.revision) || value.revision < 0
        || Object.keys(value).some(key => !['schemaVersion', 'workspaceId', 'revision', 'releases', 'intents', 'receipts', 'events'].includes(key))
        || !['releases', 'intents', 'receipts', 'events'].every(key => Array.isArray(value[key]) && value[key].length <= 2000))
        fail(503, 'PLUGIN_CONTROL_STATE_REFUSED', 'Plugin control state does not match this workspace. Nothing was reset.');
      canonical(value);
      for (const key of ['releases', 'intents', 'receipts']) {
        const ids = value[key].map(item => item?.id);
        if (ids.some(id => typeof id !== 'string' || !id) || new Set(ids).size !== ids.length)
          fail(503, 'PLUGIN_CONTROL_STATE_REFUSED', 'Plugin control records require independent review.');
      }
      return value;
    } finally { await handle.close(); }
  }
  async function unlock() {
    await lock.close();
    try {
      const current = await fs.lstat(lockPath);
      if (current.ino === lockStat.ino && current.dev === lockStat.dev && current.isFile() && !current.isSymbolicLink()) await fs.unlink(lockPath);
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  try {
    await lock.writeFile(JSON.stringify({ schemaVersion: 1, pid: process.pid, workspaceId, owner: randomUUID() }));
    await lock.sync();
    state = await readState();
  } catch (error) { await unlock(); throw error; }
  const live = () => { if (!healthy || closing) fail(503, 'PLUGIN_CONTROL_UNAVAILABLE', 'Plugin control is unavailable. Reconcile the original request before retrying.'); };
  async function persist(next) {
    const bytes = canonical(next);
    if (Buffer.byteLength(bytes) > 2 * 1024 * 1024) fail(507, 'PLUGIN_CONTROL_CAPACITY', 'Control records reached their bounded capacity. Nothing was pruned.');
    const temporary = path.join(directory, 'state.' + randomUUID() + '.tmp');
    let handle, renamed = false;
    try {
      handle = await fs.open(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | (constants.O_NOFOLLOW || 0), 0o600);
      await handle.writeFile(bytes); await handle.sync(); await handle.close(); handle = null;
      const currentLock = await fs.lstat(lockPath);
      if (!currentLock.isFile() || currentLock.ino !== lockStat.ino || currentLock.dev !== lockStat.dev) throw new Error('Control writer changed.');
      await fs.rename(temporary, statePath); renamed = true;
      const parent = await fs.open(directory, constants.O_RDONLY);
      try { await parent.sync(); } finally { await parent.close(); }
      state = next;
    } catch (error) {
      if (renamed) healthy = false;
      if (error instanceof ApiError) throw error;
      fail(503, renamed ? 'PLUGIN_CONTROL_COMMIT_UNCERTAIN' : 'PLUGIN_CONTROL_WRITE_FAILED', 'The control write could not be confirmed. Reconcile the exact request; no automatic retry was performed.');
    } finally {
      await handle?.close().catch(() => {});
      if (!renamed) await fs.unlink(temporary).catch(error => { if (error.code !== 'ENOENT') healthy = false; });
    }
  }
  return Object.freeze({
    read() { live(); return structuredClone(state); },
    receipt(id, subject) { live(); const row = state.receipts.find(item => item.id === id && item.subject === subject); return row ? structuredClone(row.result) : null; },
    transact({ requestId, expectedRevision, subject, operation, assertCurrent = () => {} }, change) {
      const execute = async () => {
        live(); assertCurrent();
        if (typeof requestId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/u.test(requestId)
          || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0 || typeof subject !== 'string' || !subject || subject.length > 128)
          fail(400, 'PLUGIN_CONTROL_INVALID_REQUEST', 'Use a stable request ID and the exact reviewed revision.');
        const fingerprint = controlDigest({ subject, expectedRevision, operation });
        const previous = state.receipts.find(item => item.id === requestId);
        if (previous) {
          if (previous.subject !== subject || previous.fingerprint !== fingerprint) fail(409, 'PLUGIN_CONTROL_REQUEST_CONFLICT', 'The request ID belongs to different reviewed content.');
          return structuredClone(previous.result);
        }
        if (expectedRevision !== state.revision) fail(409, 'PLUGIN_CONTROL_STALE', 'Refresh and review the current plugin state before submitting a new request.');
        if (state.revision >= Number.MAX_SAFE_INTEGER || ['releases', 'intents', 'receipts', 'events'].some(key => state[key].length >= 2000))
          fail(507, 'PLUGIN_CONTROL_CAPACITY', 'Control capacity requires maintenance; old receipts were not discarded.');
        const next = structuredClone(state);
        const at = new Date(clock()).toISOString();
        const result = change(next, { at, subject, revision: state.revision + 1 });
        if (result && typeof result.then === 'function') throw new TypeError('Control transactions must not execute asynchronous services.');
        next.revision++;
        const reply = { ...result, schemaVersion: 1, revision: next.revision };
        canonical(reply); assertCurrent();
        next.receipts.push({ id: requestId, subject, fingerprint, result: reply });
        next.events.push({ revision: next.revision, at, subject, operation: operation.type, requestId });
        await persist(next);
        return structuredClone(reply);
      };
      const pending = queue.then(execute); queue = pending.catch(() => {}); return pending;
    },
    close() {
      if (!closePromise) { closing = true; closePromise = queue.then(unlock); }
      return closePromise;
    },
  });
}
