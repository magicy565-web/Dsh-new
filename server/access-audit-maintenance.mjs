import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { privateDirectory, acquireWriterLock, openPrivateFile, syncDirectory } from './store.mjs';
import { inspectAccessAudit } from './access-audit.mjs';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
async function read(filename) { const handle = await openPrivateFile(filename); try { const stat = await handle.stat(); if (stat.size > 64 * 1024 * 1024) throw new Error('Audit is larger than the supported rotation limit.'); return await handle.readFile(); } finally { await handle.close(); } }

/** Explicit offline-only rotation. Keeps an exact verified archive and an anchored
 * successor segment. Nothing is deleted automatically, including failed archives.
 * Both segments still require external backup/anchoring for adversarial integrity.
 */
export async function rotateAccessAudit({ dataDirectory, archiveFile, now = Date.now } = {}) {
  if (!dataDirectory || !archiveFile || !path.isAbsolute(dataDirectory) || !path.isAbsolute(archiveFile)) throw new Error('Rotation requires absolute data and new archive file paths.');
  const root = await privateDirectory(dataDirectory);
  const lock = await acquireWriterLock(root.directory);
  let temporary, renamed = false, archiveCreated = false;
  try {
    const security = path.join(root.directory, 'security');
    const securityInfo = await fs.lstat(security);
    if (!securityInfo.isDirectory() || securityInfo.isSymbolicLink()) throw new Error('The security directory must be a real private directory.');
    const filename = path.join(security, 'audit.jsonl');
    const bytes = await read(filename), before = inspectAccessAudit(bytes, { now });
    if (!before.sequence) throw new Error('There is no completed audit segment to rotate.');
    if (before.maxAssertionExpiresAt > now()) throw new Error(`Unexpired ingress assertions remain until ${new Date(before.maxAssertionExpiresAt).toISOString()}; stop the server and wait before rotating.`);
    const requestedParent = path.dirname(archiveFile);
    await privateDirectory(requestedParent);
    const parentInfo = await fs.lstat(requestedParent);
    if (!parentInfo.isDirectory() || parentInfo.isSymbolicLink() || process.platform !== 'win32' && (parentInfo.mode & 0o077)) throw new Error('Archive parent must be a private real directory.');
    const archiveParent = await fs.realpath(requestedParent);
    if (archiveParent === root.directory || archiveParent.startsWith(`${root.directory}${path.sep}`)) throw new Error('Audit archive must be outside the live data directory.');
    const archive = path.join(archiveParent, path.basename(archiveFile));
    const out = await fs.open(archive, 'wx', 0o600); archiveCreated = true;
    try { await out.writeFile(bytes); await out.sync(); } finally { await out.close(); }
    await syncDirectory(archiveParent);
    const archivedBytes = await read(archive), archived = inspectAccessAudit(archivedBytes, { now });
    if (archived.sha256 !== before.sha256 || !archivedBytes.equals(bytes)) throw new Error('Archived audit verification failed; the live audit was not replaced.');
    const payload = { sequence: before.sequence + 1, time: new Date(now()).toISOString(), type: 'audit.rotated', previousSegmentSha256: before.sha256, previousSegmentLastHash: before.previous, previousSegmentSequence: before.sequence, previous: before.previous };
    const replacement = Buffer.from(JSON.stringify({ ...payload, hash: digest(JSON.stringify(payload)) }) + '\n');
    inspectAccessAudit(replacement, { now });
    temporary = path.join(security, `audit.rotate.${randomUUID()}.tmp`);
    const staged = await fs.open(temporary, 'wx', 0o600);
    try { await staged.writeFile(replacement); await staged.sync(); } finally { await staged.close(); }
    if (!(await read(temporary)).equals(replacement)) throw new Error('Staged audit verification failed.');
    await root.verify(); await lock.verify();
    // Recheck source identity/content immediately before the only replacement.
    if (!(await read(filename)).equals(bytes)) throw new Error('Live audit changed during offline rotation; no replacement was made.');
    await fs.rename(temporary, filename); renamed = true;
    await syncDirectory(security);
    const after = inspectAccessAudit(await read(filename), { now });
    if (after.sha256 !== digest(replacement) || after.sequence !== before.sequence + 1) throw new Error('Successor audit verification failed; preserve both segments and inspect.');
    return { ok: true, archiveFile: archive, archivedBytes: bytes.length, archivedSha256: before.sha256, previousLastHash: before.previous, nextSequence: after.sequence, activeSha256: after.sha256, archivedVerified: true, activeVerified: true };
  } catch (error) {
    error.message += renamed ? ' The replacement may already be committed; preserve the archive and live segment for inspection. Do not retry blindly.' : archiveCreated ? ' Any newly created archive is retained for inspection; the live segment has not been intentionally replaced.' : '';
    throw error;
  } finally {
    if (temporary && !renamed) await fs.unlink(temporary).catch(() => {});
    await lock.release();
  }
}
