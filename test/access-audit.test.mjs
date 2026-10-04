import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { openAccessAudit, inspectAccessAudit } from '../server/access-audit.mjs';
import { rotateAccessAudit } from '../server/access-audit-maintenance.mjs';
import { acquireWriterLock } from '../server/store.mjs';
const hash = value => createHash('sha256').update(value).digest('hex');
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'workspace-audit-'));
  const data = path.join(root, 'data'), security = path.join(data, 'security'), archives = path.join(root, 'archives');
  await fs.mkdir(data, { mode: 0o700 });
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return { root, data, security, archives, filename: path.join(security, 'audit.jsonl'), archive: name => path.join(archives, name) };
}

test('audit: capacity exhaustion poisons writer rather than dropping audit records', async t => {
  const f = await fixture(t); const audit = await openAccessAudit(f.security, { maxBytes: 700 });
  t.after(() => audit.close());
  await audit.append({ type: 'fixture', note: 'x'.repeat(300) }); const before = await fs.readFile(f.filename);
  await assert.rejects(audit.append({ type: 'overflow', note: 'x'.repeat(300) }), /capacity/);
  assert.equal(audit.healthy, false); assert.deepEqual(await fs.readFile(f.filename), before);
  await assert.rejects(audit.append({ type: 'small' }), /unavailable/);
});

test('audit: unsafe links and invalid chains are refused without changing evidence', async t => {
  const f = await fixture(t); await fs.mkdir(f.security, { mode: 0o700 });
  const target = path.join(f.root, 'target'); await fs.writeFile(target, 'unchanged'); await fs.symlink(target, f.filename);
  await assert.rejects(openAccessAudit(f.security), /Unsafe/); assert.equal(await fs.readFile(target, 'utf8'), 'unchanged');
  await fs.unlink(f.filename); await fs.writeFile(f.filename, '{"sequence":1}\n');
  await assert.rejects(openAccessAudit(f.security), /chain/); assert.equal(await fs.readFile(f.filename, 'utf8'), '{"sequence":1}\n');
});

test('audit rotation: live ownership and unexpired replay claims prevent rotation', async t => {
  const f = await fixture(t), now = Date.now();
  const audit = await openAccessAudit(f.security, { now: () => now }); await audit.append({ type: 'request.admitted', assertionId: 'fixture_assertion_id_012345', assertionExpiresAt: now + 30_000 }); await audit.close();
  const lock = await acquireWriterLock(f.data);
  await assert.rejects(rotateAccessAudit({ dataDirectory: f.data, archiveFile: f.archive('one.jsonl'), now: () => now + 31_000 }), /already open/); await lock.release();
  const before = await fs.readFile(f.filename);
  await assert.rejects(rotateAccessAudit({ dataDirectory: f.data, archiveFile: f.archive('one.jsonl'), now: () => now }), /Unexpired/);
  assert.deepEqual(await fs.readFile(f.filename), before);
});

test('audit rotation: explicit verified archive and anchored successor preserve continuity across restarts', async t => {
  const f = await fixture(t); const now = Date.now();
  let audit = await openAccessAudit(f.security, { now: () => now });
  await audit.append({ type: 'server.started' }); await audit.append({ type: 'request.admitted', actor: 'fixture', assertionId: 'fixture_assertion_id_012345', assertionExpiresAt: now + 30_000 }); await audit.close();
  const before = await fs.readFile(f.filename), inspected = inspectAccessAudit(before);
  const result = await rotateAccessAudit({ dataDirectory: f.data, archiveFile: f.archive('first.jsonl'), now: () => now + 31_000 });
  assert.equal(result.archivedSha256, hash(before)); assert.deepEqual(await fs.readFile(result.archiveFile), before); assert.equal(result.nextSequence, inspected.sequence + 1);
  const successor = inspectAccessAudit(await fs.readFile(f.filename)); const anchor = successor.recent[0];
  assert.equal(anchor.type, 'audit.rotated'); assert.equal(anchor.previousSegmentSha256, hash(before)); assert.equal(anchor.previous, inspected.previous);
  audit = await openAccessAudit(f.security, { now: () => now + 31_000 }); await audit.append({ type: 'server.started' }); await audit.close();
  const second = await rotateAccessAudit({ dataDirectory: f.data, archiveFile: f.archive('second.jsonl'), now: () => now + 31_000 });
  assert.equal(second.nextSequence, result.nextSequence + 2); assert.equal((await fs.stat(f.filename)).mode & 0o777, 0o600);
  assert.equal((await fs.stat(result.archiveFile)).mode & 0o777, 0o600);
});

test('audit rotation: archive collisions, links, public parents, in-data paths and tampered source fail closed', async t => {
  const f = await fixture(t); const audit = await openAccessAudit(f.security); await audit.append({ type: 'fixture' }); await audit.close();
  const before = await fs.readFile(f.filename);
  await fs.mkdir(f.archives, { mode: 0o700 }); await fs.writeFile(f.archive('exists.jsonl'), 'PRESERVE');
  await assert.rejects(rotateAccessAudit({ dataDirectory: f.data, archiveFile: f.archive('exists.jsonl') }), /EEXIST/);
  assert.equal(await fs.readFile(f.archive('exists.jsonl'), 'utf8'), 'PRESERVE');
  await fs.symlink(f.archive('exists.jsonl'), f.archive('linked.jsonl'));
  await assert.rejects(rotateAccessAudit({ dataDirectory: f.data, archiveFile: f.archive('linked.jsonl') }), /EEXIST/);
  await assert.rejects(rotateAccessAudit({ dataDirectory: f.data, archiveFile: path.join(f.security, 'bad-archive.jsonl') }), /outside/);
  const publicParent = path.join(f.root, 'public'); await fs.mkdir(publicParent, { mode: 0o755 });
  await assert.rejects(rotateAccessAudit({ dataDirectory: f.data, archiveFile: path.join(publicParent, 'bad.jsonl') }), /private/);
  assert.deepEqual(await fs.readFile(f.filename), before);
  await fs.writeFile(f.filename, before.toString().replace('fixture', 'changed'));
  await assert.rejects(rotateAccessAudit({ dataDirectory: f.data, archiveFile: f.archive('tampered.jsonl') }), /chain/);
  await assert.rejects(fs.stat(f.archive('tampered.jsonl')), { code: 'ENOENT' });
});
