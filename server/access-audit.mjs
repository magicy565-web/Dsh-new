import { promises as fs, constants } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { privateDirectory, openPrivateFile, syncDirectory } from './store.mjs';

const digest = value => createHash('sha256').update(value).digest('hex');
const genesis = '0'.repeat(64);

/** Local durable audit, under the application's exclusive workspace ownership.
 * Hash chaining detects damage; it is NOT a signature or protection from the OS owner.
 * An uncertain append poisons admission. No automatic log rotation/discard is permitted.
 */
export function inspectAccessAudit(bytes, { now = Date.now } = {}) {
  if (!Buffer.isBuffer(bytes) || (bytes.length && bytes.at(-1) !== 10)) throw new Error('Access audit has an incomplete record; preserve and inspect it before restart.');
  let sequence = 0, previous = genesis;
  const recent = [], replay = new Map();
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  let maxAssertionExpiresAt = 0, first = true;
  for (const line of text.split('\n')) {
    if (!line) continue;
    if (Buffer.byteLength(line) > 4096) throw new Error('Invalid access audit record.');
    let entry;
    try { entry = JSON.parse(line); } catch { throw new Error('Invalid access audit JSON.'); }
    if (first && entry.type === 'audit.rotated') {
      if (!Number.isSafeInteger(entry.previousSegmentSequence) || entry.previousSegmentSequence < 1 || !/^[a-f0-9]{64}$/.test(entry.previousSegmentLastHash) || !/^[a-f0-9]{64}$/.test(entry.previousSegmentSha256) || entry.previous !== entry.previousSegmentLastHash) throw new Error('Invalid access audit rotation anchor.');
      sequence = entry.previousSegmentSequence; previous = entry.previousSegmentLastHash;
    }
    first = false;
    const { hash, ...payload } = entry;
    if (entry.sequence !== sequence + 1 || entry.previous !== previous || hash !== digest(JSON.stringify(payload)) || typeof entry.type !== 'string') throw new Error('Access audit chain verification failed; preserve and inspect it before restart.');
    sequence = entry.sequence; previous = hash;
    if (Number.isFinite(entry.assertionExpiresAt)) maxAssertionExpiresAt = Math.max(maxAssertionExpiresAt, entry.assertionExpiresAt);
    if (entry.assertionId && Number.isFinite(entry.assertionExpiresAt) && entry.assertionExpiresAt > now()) replay.set(entry.assertionId, entry.assertionExpiresAt);
    recent.push(entry); if (recent.length > 5000) recent.shift();
  }
  return { sequence, previous, recent, replay, maxAssertionExpiresAt, sha256: digest(bytes) };
}

export async function openAccessAudit(directory, { now = Date.now, maxBytes = 64 * 1024 * 1024 } = {}) {
  const root = await privateDirectory(directory);
  const filename = path.join(root.directory, 'audit.jsonl');
  let created;
  try { created = await fs.open(filename, 'wx', 0o600); await created.sync(); }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
  finally { await created?.close(); }
  if (created) await syncDirectory(root.directory);
  const existing = await openPrivateFile(filename);
  let bytes;
  try {
    const stat = await existing.stat();
    if (stat.size > maxBytes) throw new Error('The access audit exceeds its configured limit; archive under an approved offline maintenance procedure.');
    bytes = await existing.readFile();
  } finally { await existing.close(); }
  if (bytes.length && bytes.at(-1) !== 10) throw new Error('Access audit has an incomplete record; preserve and inspect it before restart.');
  let { sequence, previous, recent, replay } = inspectAccessAudit(bytes, { now });
  await fs.chmod(filename, 0o600);
  const handle = await fs.open(filename, constants.O_WRONLY | constants.O_APPEND | (constants.O_NOFOLLOW || 0));
  const identity = await handle.stat();
  if (!identity.isFile() || identity.nlink !== 1) { await handle.close(); throw new Error('Unsafe access audit file.'); }
  let size = bytes.length, queue = Promise.resolve(), poisoned = false, closed = false;
  function append(event) {
    if (closed || poisoned) return Promise.reject(new Error('Access audit is unavailable; request admission is stopped.'));
    const operation = queue.then(async () => {
      if (poisoned) throw new Error('Access audit is unavailable; request admission is stopped.');
      await root.verify();
      const current = await fs.lstat(filename);
      if (!current.isFile() || current.isSymbolicLink() || current.nlink !== 1 || current.ino !== identity.ino || current.dev !== identity.dev || current.size !== size) throw new Error('Access audit changed outside this writer.');
      const payload = { sequence: sequence + 1, time: new Date(now()).toISOString(), ...event, previous };
      const hash = digest(JSON.stringify(payload));
      const record = { ...payload, hash };
      const line = JSON.stringify(record) + '\n';
      const length = Buffer.byteLength(line);
      if (length > 4096 || size + length > maxBytes) throw new Error('Access audit capacity reached; request admission is stopped.');
      await handle.writeFile(line); await handle.sync();
      size += length; sequence++; previous = hash;
      recent.push(record); if (recent.length > 5000) recent.shift();
      return { ...record };
    }).catch(error => { poisoned = true; throw error; });
    queue = operation.catch(() => {});
    return operation;
  }
  return {
    replay,
    append,
    list({ after = 0, limit = 100 } = {}) {
      if (!Number.isSafeInteger(after) || after < 0 || !Number.isInteger(limit) || limit < 1 || limit > 200) throw new Error('Invalid audit cursor.');
      const records = recent.filter(item => item.sequence > after).slice(0, limit).map(item => ({ ...item }));
      return { records, nextCursor: records.at(-1)?.sequence || after, latestSequence: sequence, oldestAvailableSequence: recent[0]?.sequence || 0, truncated: !!recent.length && after < recent[0].sequence - 1, integrity: 'local-hash-chain', externallyAnchored: false };
    },
    get healthy() { return !poisoned && !closed; },
    async close() { if (closed) return; closed = true; await queue; await handle.close(); },
  };
}
