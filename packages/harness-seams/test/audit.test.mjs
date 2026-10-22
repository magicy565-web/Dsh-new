import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createStorage } from '../src/storage.mjs';
import { createAudit, createAuditProvider } from '../src/audit.mjs';
import { createHarness } from '../../harness-kernel/src/app.mjs';
import { harnessError, ACTOR_A, ACTOR_B, fakeClock, makeTempDirectory, removeDirectory, closeAfter } from './helpers.mjs';

async function fixture(t, options = {}) {
  const directory = await makeTempDirectory('harness-audit-');
  removeDirectory(t, directory);
  const storage = await createStorage({ directory });
  closeAfter(t, storage);
  const clock = fakeClock();
  const audit = createAudit({ storage, clock, limit: options.limit });
  return { directory, storage, audit, clock };
}

test('audit records a unified entry and lists it back with filters', async t => {
  const { audit, clock } = await fixture(t);
  const first = await audit.record({ kind: 'tool', action: 'inquiry_recovery_status', actor: ACTOR_A, ok: true, ref: 'call-1' });
  clock.advance(1000);
  await audit.record({ kind: 'approval', action: 'inquiry_recovery_select', actor: ACTOR_B, ok: false, code: 'HARNESS_APPROVAL_REQUIRED', detail: { tool: 'inquiry_recovery_select' } });
  clock.advance(1000);
  await audit.record({ kind: 'patch', action: 'disable', actor: 'local-operator', ok: true });

  assert.deepEqual(Object.keys(first).sort(), ['action', 'actor', 'at', 'code', 'detail', 'id', 'kind', 'ok', 'ref']);
  assert.equal(first.kind, 'tool');
  assert.deepEqual(first.actor, { subject: 'actor-a', role: 'user' });

  const all = audit.list();
  assert.deepEqual(all.map(entry => entry.kind), ['patch', 'approval', 'tool'], 'newest first');
  assert.deepEqual(audit.list({ kind: 'approval' }).map(entry => entry.action), ['inquiry_recovery_select']);
  assert.deepEqual(audit.list({ actor: 'actor-a' }).map(entry => entry.kind), ['tool']);
  assert.deepEqual(audit.list({ limit: 1 }).map(entry => entry.kind), ['patch']);
  assert.deepEqual(audit.summary(), { byKind: { tool: 1, approval: 1, patch: 1 }, total: 3, failed: 1 });
  assert.deepEqual(audit.list({ since: new Date(clock.now() - 1500).toISOString() }).map(entry => entry.kind), ['patch', 'approval']);
});

test('legacy P0 tool entries are normalised into the same stream', async t => {
  const { audit, storage } = await fixture(t);
  await storage.update(state => {
    state.harnessAudit = [{ id: 'legacy-1', at: new Date().toISOString(), actor: { subject: 'actor-a', role: 'admin' }, tool: 'inquiry_recovery_status', approvalId: 'ticket-1', ok: false, errorCode: 'HARNESS_TOOL_REFUSED' }];
  });
  const [entry] = audit.list();
  assert.equal(entry.kind, 'tool');
  assert.equal(entry.action, 'inquiry_recovery_status');
  assert.equal(entry.code, 'HARNESS_TOOL_REFUSED');
  assert.deepEqual(entry.detail, { approvalId: 'ticket-1' });
  assert.equal(audit.summary().failed, 1);
});

test('malformed entries and oversized detail are refused before writing', async t => {
  const { audit, storage } = await fixture(t);
  await assert.rejects(audit.record({ kind: 'Bad Kind', action: 'x' }), harnessError('HARNESS_MANIFEST_INVALID'));
  await assert.rejects(audit.record({ kind: 'tool', action: 'Bad Action' }), harnessError('HARNESS_MANIFEST_INVALID'));
  await assert.rejects(audit.record({ kind: 'tool', action: 'x', ok: 'yes' }), harnessError('HARNESS_MANIFEST_INVALID'));
  await assert.rejects(audit.record({ kind: 'tool', action: 'x', code: 'lowercase' }), harnessError('HARNESS_MANIFEST_INVALID'));
  await assert.rejects(audit.record({ kind: 'tool', action: 'x', body: 'not allowed' }), harnessError('HARNESS_MANIFEST_INVALID'));
  await assert.rejects(audit.record({ kind: 'tool', action: 'x', detail: { blob: 'x'.repeat(4096) } }), harnessError('HARNESS_MANIFEST_INVALID'));
  await assert.rejects(audit.record({ kind: 'tool', action: 'x', actor: 42 }), harnessError('HARNESS_MANIFEST_INVALID'));
  assert.deepEqual(storage.read().harnessAudit ?? [], []);
});

test('the log is capped, durable across restart, and closes idempotently', async t => {
  const directory = await makeTempDirectory('harness-audit-restart-');
  removeDirectory(t, directory);
  const storage = await createStorage({ directory });
  const audit = createAudit({ storage, clock: fakeClock(), limit: 5 });
  for (let index = 0; index < 7; index += 1) await audit.record({ kind: 'tool', action: `call-${index}` });
  assert.equal(audit.list({ limit: 100 }).length, 5);
  assert.equal(audit.list({ limit: 100 })[0].action, 'call-6');
  audit.close();
  await assert.rejects(audit.record({ kind: 'tool', action: 'after-close' }), harnessError('HARNESS_MANIFEST_INVALID'));
  await storage.close();

  const reopened = await createStorage({ directory });
  closeAfter(t, reopened);
  const again = createAudit({ storage: reopened });
  assert.equal(again.list({ limit: 100 })[0].action, 'call-6');
  assert.equal(again.summary().total, 5);
});

test('the provider mounts on the kernel and requires ctx.storage', async t => {
  const directory = await makeTempDirectory('harness-audit-kernel-');
  removeDirectory(t, directory);
  const storageDirectory = path.join(directory, 'data').replace(/\\/gu, '/');
  const composition = path.join(directory, 'audit.yml');
  await fs.writeFile(composition, [
    'version: 1', 'name: audit', 'server: { host: 127.0.0.1, port: 0 }', 'plugins:',
    '  - id: storage', "    name: '@workspace-harness/seams/storage'", `    config: { directory: '${storageDirectory}' }`,
    '  - id: audit', "    name: '@workspace-harness/seams/audit'",
    '',
  ].join('\n'), 'utf8');
  const harness = await createHarness({ compositionPath: composition, root: process.cwd() });
  t.after(async () => { await harness.stop(); });
  const audit = harness.ctx.reflect.get('audit', false);
  const recorded = await audit.record({ kind: 'harness', action: 'probe', actor: ACTOR_A, ref: 'probe-1' });
  assert.equal(recorded.kind, 'harness');
  assert.equal(audit.list({ kind: 'harness' }).length, 1);

  // Mounting the provider without storage fails closed.
  const provider = createAuditProvider();
  await assert.rejects(provider.apply({ provide() {} }, {}), harnessError('HARNESS_PLUGIN_MISSING_DEPENDENCY'));
});
