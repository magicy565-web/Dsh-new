import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp } from '../server/index.mjs';
import { createPiProvider } from '../server/pi-provider.mjs';
import { createAgentAuth } from '../server/agent/auth.mjs';

const base = server => {
  const address = server.address();
  return 'http://127.0.0.1:' + address.port;
};
const input = { product: 'Stainless bottle', spec: '500 ml, units: pieces', quantity: 100, market: 'US' };
async function appFixture(t, agentConfig) {
  const dir = await mkdtemp(path.join(tmpdir(), 'cnsubscribe-unified-host-'));
  let app;
  try {
    app = await createApp({
      dataDirectory: dir,
      provider: createPiProvider(),
      capabilityEnvironment: {},
      agentConfig,
    });
    await app.listen(0);
  } catch (error) {
    await app?.close?.();
    await rm(dir, { recursive: true, force: true });
    throw error;
  }
  t.after(async () => {
    try { await app.close(); }
    finally { await rm(dir, { recursive: true, force: true }); }
  });
  return { app, dir, url: base(app.server) };
}

test('default-off Agent API does not replace the original Workspace Host', async t => {
  const { app, url } = await appFixture(t, false);
  assert.equal(app.builtinAgent, undefined);
  const result = await fetch(url + '/api/agent/v1/health');
  assert.equal(result.status, 404, 'Agent API must be absent unless explicitly enabled.');
  assert.equal(app.store.read().workspaceAgentTasks, undefined,
    'Disabling the Agent adapter must not create a second business task registry.');
  assert.ok(app.runtime);
  assert.ok(app.supplierService, 'Original supplier service remains mounted.');
  assert.ok(app.supplierNotifications, 'Original notification host remains mounted.');
});

test('explicit Agent adapter persists tasks in original Workspace Store on the same Host', async t => {
  const token = randomBytes(32).toString('base64url');
  const tokenSha256 = createHash('sha256').update(token).digest('hex');
  const principals = [{ subject: 'local-operator', workspaceId: 'local', tokenSha256,
    scopes: ['agent:read', 'agent:submit'] }];
  const dir = await mkdtemp(path.join(tmpdir(), 'cnsubscribe-unified-host-'));
  const config = { env: { WS_AGENT_ENABLED: '1', WS_AGENT_DEMO: '1',
    WS_AGENT_DATA: path.join(dir, 'agent') }, principals };
  let app;
  try {
    const provider = createPiProvider();
    app = await createApp({ dataDirectory: dir, provider,
      capabilityEnvironment: {}, agentConfig: config });
    await app.listen(0);
    const url = base(app.server);
    assert.equal(app.builtinAgent?.health()?.authority, 'workspace-store');
    const h = await fetch(url + '/api/agent/v1/health');
    assert.equal(h.status, 200);
    assert.equal((await h.json()).mode, 'demo');
    const unauth = await fetch(url + '/api/agent/v1/presets');
    assert.equal(unauth.status, 401);
    const response = await fetch(url + '/api/agent/v1/tasks', {
      method: 'POST',
      headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json',
        'idempotency-key': 'single-original-host-task' },
      body: JSON.stringify({ type: 'procurement', title: 'Original Workspace task', input }),
    });
    assert.equal(response.status, 201, 'An authenticated demo submission must use the original Host.');
    const task = await response.json();
    assert.ok(task.taskId);
    const state = app.store.read();
    const taskRecord = state.workspaceAgentTasks?.tasks.find(x => x.id === task.taskId);
    assert.ok(taskRecord, 'The Agent task must live in the original business Store.');
    assert.equal(taskRecord.subject, 'local-operator');
    assert.equal(taskRecord.workspaceId, 'local');
    assert.equal(app.builtinAgent.store?.directory, path.join(dir, 'agent'),
      'Agent SQLite is a projection beneath the original data root.');
    assert.ok(app.supplierService, 'The original supplier service remains available.');
    assert.ok(app.supplierNotifications, 'The original notification host remains available.');
    // An enabled Agent connector must not silently upgrade unrelated ordinary
    // Pi runs to the additional Agent-only tool authority.
    const ordinaryConversation = (await app.runtime.createConversation({ title: 'Original ordinary conversation' })).conversation;
    const ordinaryMessage = await app.runtime.sendMessage(ordinaryConversation.id, {
      content: 'Original ordinary Pi request', requestId: 'ordinary-unconfigured-agent-enabled',
    });
    const ordinaryRun = app.runtime.getRun(ordinaryMessage.run.id).run;
    assert.equal(ordinaryRun.execution.permissionFingerprint, provider.permissionFingerprint);
    assert.deepEqual(Object.keys(ordinaryRun.execution).sort(), ['kind', 'model', 'permissionFingerprint'],
      'Agent enablement must not alter the PR59 ordinary execution scope.');
    assert.equal(ordinaryRun.agentPresetContext, undefined);
  } finally {
    try { await app?.close?.(); }
    finally { await rm(dir, { recursive: true, force: true }); }
  }
});

test('Agent member Bearer rejects reused original Dot/Muse/sourcing token digests', () => {
  const token = randomBytes(32).toString('base64url');
  const tokenSha256 = createHash('sha256').update(token).digest('hex');
  const principal = { subject: 'local-operator', workspaceId: 'local', tokenSha256,
    scopes: ['agent:read', 'agent:submit'] };
  const access = {
    serviceIdentity: binding => ({ subject: binding.subject, workspaceId: binding.workspaceId, role: 'admin' }),
    beginServiceCredential: async () => { throw new Error('No HTTP request expected in construction test.'); },
  };
  assert.throws(
    () => createAgentAuth({ principals: [principal], access, env: {}, reservedTokenDigests: [tokenSha256] }),
    /must not reuse an existing Dot, Muse or sourcing Worker token digest/,
  );
  const anotherDigest = createHash('sha256').update('another independent fixture credential').digest('hex');
  assert.equal(createAgentAuth({ principals: [principal], access, env: {},
    reservedTokenDigests: [anotherDigest] }).configured, true);
});
