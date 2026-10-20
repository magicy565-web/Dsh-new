import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createWorkspace, createWorkspaceProvider } from '../src/workspace.mjs';
import { createHarness } from '../../harness-kernel/src/app.mjs';
import { harnessError } from './helpers.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

const company = () => createWorkspace({
  defaultWorkspaceId: 'alpha',
  workspaces: [
    { id: 'alpha', name: 'Alpha 工厂', members: [{ subject: 'alice', role: 'admin' }, { subject: 'bob', role: 'viewer' }] },
    { id: 'beta', name: 'Beta 工厂', members: [{ subject: 'carol', role: 'operator' }] },
  ],
});

test('resolve and list use the deployment configuration and never leak other tenants', async t => {
  const workspace = company();
  assert.deepEqual(workspace.resolve({ subject: 'alice' }), { workspaceId: 'alpha', workspaceName: 'Alpha 工厂', subject: 'alice', role: 'admin' });
  assert.equal(workspace.resolve({ subject: 'carol' }, { workspaceId: 'beta' }).role, 'operator');
  assert.deepEqual(workspace.list({ subject: 'bob' }), [{ id: 'alpha', name: 'Alpha 工厂', role: 'viewer' }]);
  assert.deepEqual(workspace.list({ subject: 'nobody' }), []);
  assert.equal(JSON.stringify(workspace.list({ subject: 'bob' })).includes('carol'), false, 'members of other workspaces are never listed');
});

test('the authoritative role comes from the membership, not from the actor claim', async t => {
  const workspace = company();
  // bob claims admin in the header; the config says viewer.
  assert.equal(workspace.resolve({ subject: 'bob', role: 'admin' }).role, 'viewer');
  assert.throws(() => workspace.assertRole({ subject: 'bob', role: 'admin' }, ['admin']), harnessError('HARNESS_WORKSPACE_FORBIDDEN'));
  assert.deepEqual(workspace.assertRole({ subject: 'alice', role: 'viewer' }, ['admin', 'operator']), { workspaceId: 'alpha', workspaceName: 'Alpha 工厂', subject: 'alice', role: 'admin' });
});

test('unknown tenants and non-members fail closed; no tenant is guessed', async t => {
  const workspace = company();
  assert.throws(() => workspace.resolve({ subject: 'alice' }, { workspaceId: 'gamma' }), harnessError('HARNESS_WORKSPACE_INVALID'));
  assert.throws(() => workspace.resolve({ subject: 'alice' }, { workspaceId: '' }), harnessError('HARNESS_WORKSPACE_INVALID'));
  assert.throws(() => workspace.resolve({ subject: 'mallory' }), harnessError('HARNESS_WORKSPACE_FORBIDDEN'));
  assert.throws(() => workspace.resolve({ subject: 'carol' }), harnessError('HARNESS_WORKSPACE_FORBIDDEN'), 'carol is not an alpha member and alpha is the default');
  assert.throws(() => workspace.resolve({}), harnessError('HARNESS_WORKSPACE_INVALID'));
  assert.throws(() => workspace.resolve(null), harnessError('HARNESS_WORKSPACE_INVALID'));
  assert.throws(() => workspace.assertRole({ subject: 'alice' }, []), harnessError('HARNESS_WORKSPACE_INVALID'));
  assert.throws(() => workspace.assertRole({ subject: 'alice' }, ['owner']), harnessError('HARNESS_WORKSPACE_INVALID'));
});

test('configuration validation is strict and bounded', async t => {
  assert.throws(() => createWorkspace({ workspaces: [{ id: 'Bad Id' }] }), harnessError('HARNESS_WORKSPACE_INVALID'));
  assert.throws(() => createWorkspace({ workspaces: [{ id: 'a' }, { id: 'a' }] }), harnessError('HARNESS_WORKSPACE_INVALID'));
  assert.throws(() => createWorkspace({ workspaces: [{ id: 'a', members: [{ subject: 'x', role: 'owner' }] }] }), harnessError('HARNESS_WORKSPACE_INVALID'));
  assert.throws(() => createWorkspace({ workspaces: [{ id: 'a', members: [{ subject: 'x', role: 'admin' }, { subject: 'x', role: 'viewer' }] }] }), harnessError('HARNESS_WORKSPACE_INVALID'));
  assert.throws(() => createWorkspace({ defaultWorkspaceId: 'missing' }), harnessError('HARNESS_WORKSPACE_INVALID'));
  assert.throws(() => createWorkspace({ workspaces: 'nope' }), harnessError('HARNESS_WORKSPACE_INVALID'));
  const empty = createWorkspace({});
  assert.deepEqual(empty.list({ subject: 'x' }), []);
  assert.throws(() => empty.resolve({ subject: 'x' }), harnessError('HARNESS_WORKSPACE_INVALID'), 'no default tenant and no actor tenant is invalid');
});

test('the provider mounts ctx.workspace and refuses a duplicate provider', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'workspace-kernel-'));
  t.after(async () => { await fs.rm(directory, { recursive: true, force: true }); });
  const composition = path.join(directory, 'workspace.yml');
  await fs.writeFile(composition, [
    'version: 1', 'name: workspace', 'server: { host: 127.0.0.1, port: 0 }', 'plugins:',
    '  - id: workspace', "    name: '@workspace-harness/seams/workspace'",
    '    config:',
    '      defaultWorkspaceId: alpha',
    '      workspaces:',
    '        - id: alpha',
    '          name: Alpha 工厂',
    '          members: [{ subject: alice, role: admin }]',
    '',
  ].join('\n'), 'utf8');
  const harness = await createHarness({ compositionPath: composition, root: ROOT });
  t.after(async () => { await harness.stop(); });
  assert.deepEqual(harness.healthz().plugins.map(plugin => plugin.id), ['workspace']);
  const workspace = harness.ctx.reflect.get('workspace', false);
  assert.equal(workspace.resolve({ subject: 'alice' }).workspaceId, 'alpha');

  const plain = {};
  await createWorkspaceProvider({ workspaces: [{ id: 'alpha' }] }).apply(plain);
  assert.equal(plain.workspace.list({ subject: 'x' }).length, 0);
  await assert.rejects(createWorkspaceProvider({ workspaces: [{ id: 'alpha' }] }).apply(plain), harnessError('HARNESS_PLUGIN_DUPLICATE'));
});
