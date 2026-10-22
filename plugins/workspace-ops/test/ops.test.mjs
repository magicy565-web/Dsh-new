import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createOpsService, summarize, validateBackup } from '../src/domain.mjs';
import { apply, ROUTES } from '../src/index.mjs';

function fakeStorage(initial = {}) {
  let state = structuredClone(initial);
  return {
    directory: 'C:\\data',
    read: () => structuredClone(state),
    update: async mutator => {
      const draft = structuredClone(state);
      const result = mutator(draft);
      state = draft;
      return structuredClone(result);
    },
    replace: value => { state = structuredClone(value); },
    snapshot: () => structuredClone(state),
  };
}

const ADMIN = { subject: 'local-operator', role: 'admin', workspaceId: 'local' };
const OPERATOR = { subject: 'service:runner', role: 'operator', workspaceId: 'local' };

test('counts come from the durable state without guessing keys', () => {
  const counts = summarize({
    workspaces: {
      local: {
        harnessChat: { conversations: [{}, {}], messages: [{}], runs: [{}, {}, {}], approvals: [] },
        harnessGoals: { goals: [{}] },
        harnessSchedules: { schedules: [{}, {}] },
        harnessInbox: { items: [{}] },
        harnessAccess: { sessions: [] },
      },
    },
  });
  assert.deepEqual(counts, {
    workspaces: 1, conversations: 2, messages: 1, runs: 3, approvals: 0,
    goals: 1, schedules: 2, inbox: 1, sessions: 0,
  });
  assert.equal(summarize({}).workspaces, 0);
});

test('a backup must look like the state this harness writes', () => {
  assert.ok(validateBackup({ workspaces: {} }));
  assert.throws(() => validateBackup({}), error => error.code === 'OPS_BACKUP_INVALID');
  assert.throws(() => validateBackup({ workspaces: [] }), error => error.code === 'OPS_BACKUP_INVALID');
  assert.throws(() => validateBackup({ workspaces: { local: 1 } }), error => error.code === 'OPS_BACKUP_INVALID');
  assert.throws(() => validateBackup({ workspaces: {} }, { bytes: 9 * 1024 * 1024 }), error => error.code === 'OPS_BACKUP_TOO_LARGE');
});

test('status is admin-only and reports real counts', () => {
  const ops = createOpsService({ storage: fakeStorage({ workspaces: { local: { harnessGoals: { goals: [{}] } } } }), version: '1.2.3' });
  const status = ops.status({ actor: ADMIN });
  assert.equal(status.version, '1.2.3');
  assert.equal(status.storage.counts.goals, 1);
  assert.equal(status.storage.directory, 'C:\\data');
  assert.throws(() => ops.status({ actor: OPERATOR }), error => error.code === 'OPS_FORBIDDEN');
  assert.throws(() => ops.status({}), error => error.code === 'OPS_SESSION_REQUIRED');
});

test('restore requires the echoed id and replaces the whole state', async () => {
  const storage = fakeStorage({ workspaces: { local: { harnessGoals: { goals: [{}] } } } });
  const ops = createOpsService({ storage });
  const backup = { workspaces: { local: { harnessGoals: { goals: [] } } } };

  await assert.rejects(ops.restore({ actor: ADMIN }, { backupId: 'x', confirm: 'y', value: backup }),
    error => error.code === 'OPS_CONFIRM_REQUIRED');
  await assert.rejects(ops.restore({ actor: OPERATOR }, { backupId: 'x', confirm: 'x', value: backup }),
    error => error.code === 'OPS_FORBIDDEN');

  const result = await ops.restore({ actor: ADMIN }, { backupId: 'b1', confirm: 'b1', value: backup });
  assert.equal(result.restored, true);
  assert.deepEqual(storage.snapshot(), backup);
  assert.equal(result.counts.goals, 0);
});

test('the HTTP surface creates, lists and restores a backup', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'ops-test-'));
  const storage = fakeStorage({ workspaces: { local: { harnessGoals: { goals: [{}] } } } });
  const routes = new Map();
  const audits = [];
  const ctx = {
    storage,
    audit: { record: async entry => { audits.push(entry); } },
    http: { route: definition => { routes.set(`${definition.method} ${definition.path}`, definition); } },
    health: { register: () => {} },
    provide: () => () => {},
  };
  try {
    await apply(ctx, { backupDirectory: directory, version: '9.9.9' });
    assert.equal(routes.size, ROUTES.length);

    const call = async (key, { body = {}, actor = ADMIN } = {}) => {
      const [method, pathname] = key.split(' ');
      return routes.get(key).handler({}, {}, { method, pathname, params: {}, query: {}, body, actor });
    };

    const status = await call('GET /api/ops/status');
    assert.equal(status.body.version, '9.9.9');

    const created = await call('POST /api/ops/backups');
    assert.equal(created.status, 201);
    const id = created.body.backup.id;
    assert.ok(Number(created.body.backup.bytes) > 0);

    const listed = await call('GET /api/ops/backups');
    assert.equal(listed.body.total, 1);
    assert.equal(listed.body.items[0].id, id);

    const file = path.join(directory, `backup-${id}.json`);
    const saved = JSON.parse(await readFile(file, 'utf8'));
    assert.deepEqual(saved, storage.snapshot());

    // Break the live state, then restore it from the backup.
    storage.replace({ workspaces: {} });
    const restored = await call('POST /api/ops/restore', { body: { backupId: id, confirm: id } });
    assert.equal(restored.status, 200);
    assert.equal(storage.snapshot().workspaces.local.harnessGoals.goals.length, 1);
    assert.equal(audits.at(-1).action, 'ops.restore');

    await assert.rejects(
      call('POST /api/ops/restore', { body: { backupId: id, confirm: 'nope' } }),
      error => error.code === 'OPS_CONFIRM_REQUIRED',
    );

    await assert.rejects(
      call('POST /api/ops/restore', { body: { backupId: 'missing', confirm: 'missing' } }),
      error => error.code === 'OPS_BACKUP_NOT_FOUND',
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
