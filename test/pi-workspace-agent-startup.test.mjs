import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { promises as fs } from 'node:fs';
import { createWorkspaceAgentModel, createWorkspaceAgentRuntime } from '../scripts/pi-workspace-agent.mjs';
import { createWorkspaceClient } from '../pi/extensions/workspace.mjs';
import { fauxAssistantMessage } from '@earendil-works/pi-ai/providers/faux';
import { syntheticFrontend } from './fixtures/pi-workspace-agent-faux.mjs';
import { loadPiProviderConfig } from '../server/pi-provider-config.mjs';
import { startPiDevelopment } from '../server/pi-development.mjs';

const modelKey = 'synthetic-agent-model-key-never-valid';
const serviceToken = 'synthetic-agent-service-key-never-valid';

test('default official session partition continues the existing chat and rejects credential-shaped input before persistence or dispatch', async t => {
  const f = await startPiDevelopment({ seedApprovalConnector: false }); t.after(() => f.close());
  const isolationDirectory = await fs.mkdtemp('/tmp/workspace-agent-default-session-');
  t.after(() => fs.rm(isolationDirectory, { recursive: true, force: true }));
  const client = createWorkspaceClient(f);
  const first = await syntheticFrontend([fauxAssistantMessage('Explicit synthetic memory: public procurement context only.')]);
  let { runtime } = await createWorkspaceAgentRuntime({ client, isolationDirectory, ...first });
  t.after(async () => { await runtime.dispose(); }); await runtime.session.bindExtensions({});
  const fakeCredential = 'sk-synthetic0123456789abcdefghijkl';
  await runtime.session.prompt('Do not send this synthetic credential ' + fakeCredential);
  assert.equal(first.faux.state.callCount, 0);
  await runtime.session.prompt('Public procurement context only.');
  const originalFile = runtime.session.sessionFile; assert.ok(originalFile.includes(client.bindingFingerprint));
  assert.ok(!(await fs.readFile(originalFile, 'utf8')).includes(fakeCredential));
  await runtime.dispose();
  const second = await syntheticFrontend([context => {
    assert.ok(JSON.stringify(context.messages).includes('Public procurement context only.'));
    return fauxAssistantMessage('Explicit synthetic reopening; no business submission.');
  }]);
  ({ runtime } = await createWorkspaceAgentRuntime({ client, isolationDirectory, ...second, continueSession: true }));
  await runtime.session.bindExtensions({}); assert.equal(runtime.session.sessionFile, originalFile);
  await runtime.session.prompt('Read our previous public context.'); assert.equal(second.faux.state.callCount, 1);
  assert.equal(f.app.store.read().workspaceAgentTasks.tasks.length, 0);
});
async function cli(args, env = {}) {
  const child = spawn(process.execPath, ['scripts/pi-workspace-agent.mjs', ...args], { cwd: new URL('../', import.meta.url),
    env, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = '';
  child.stdout.on('data', value => { stdout += value; }); child.stderr.on('data', value => { stderr += value; });
  const timeout = setTimeout(() => child.kill('SIGKILL'), 10000);
  try { const [code] = await once(child, 'close'); return { code, stdout, stderr }; } finally { clearTimeout(timeout); }
}

test('development entry reports absent binding/model before TTY initialization, and never accepts sample or credential arguments', async () => {
  const missing = await cli([]); assert.equal(missing.code, 1); assert.match(missing.stderr, /WS_AGENT_URL/);
  const noModel = await cli([], { WS_AGENT_URL: 'http://127.0.0.1:1', WS_AGENT_TOKEN: serviceToken,
    PI_PROVIDER: 'deepseek', PI_MODEL: 'deepseek-flash', FASTAITOKEN_API_KEY: 'synthetic-other-key-no-fallback' });
  assert.equal(noModel.code, 1); assert.match(noModel.stderr, /host model key is missing/);
  assert.doesNotMatch(noModel.stderr, /interactive terminal|synthetic-other|sample transport/);
  for (const argument of ['--sample', '--token=' + serviceToken]) {
    const refused = await cli([argument]); assert.equal(refused.code, 1); assert.match(refused.stderr, /Invalid development Agent options/);
    assert.ok(!refused.stderr.includes(serviceToken));
  }
});

test('actual development CLI check authenticates original backend with synthetic config and zero model calls', async t => {
  const f = await startPiDevelopment({ seedApprovalConnector: false }); t.after(() => f.close());
  const value = await cli(['--check'], { WS_AGENT_URL: f.baseURL, WS_AGENT_TOKEN: f.token,
    PI_PROVIDER: 'deepseek', PI_MODEL: 'deepseek-flash', DEEPSEEK_API_KEY: modelKey });
  assert.equal(value.code, 0, value.stderr); assert.equal(value.stderr, '');
  const report = JSON.parse(value.stdout);
  assert.equal(report.profile, 'workspace-business-agent'); assert.equal(report.frontend.configured, true);
  assert.equal(report.frontend.onlineVerified, false); assert.equal(report.frontend.modelCalls, 0);
  assert.equal(report.backend.onlineVerified, false); assert.equal(report.paidCalls, 0);
  assert.equal(f.faux.state.callCount, 0); assert.equal(f.app.store.read().workspaceAgentTasks.tasks.length, 0);
  assert.ok(!value.stdout.includes(modelKey) && !value.stdout.includes(f.token));
});

test('shared native official model profile uses bounded non-thinking mocked wire and redacts key-bearing rejection without fallback', async t => {
  const originalFetch = globalThis.fetch; t.after(() => { globalThis.fetch = originalFetch; });
  const calls = [];
  globalThis.fetch = async (input, options) => {
    const outgoing = new Request(input, options); assert.equal(outgoing.url, 'https://api.deepseek.com/chat/completions');
    assert.ok(outgoing.signal instanceof AbortSignal);
    assert.equal(outgoing.headers.get('authorization'), 'Bearer ' + modelKey);
    const body = await outgoing.json(); calls.push(body);
    return new Response(JSON.stringify({ error: { message: 'Synthetic rejected ' + modelKey + ' and ' + serviceToken, type: 'authentication_error' } }),
      { status: 401, headers: { 'content-type': 'application/json' } });
  };
  const frontend = await createWorkspaceAgentModel(loadPiProviderConfig({ PI_PROVIDER: 'deepseek', PI_MODEL: 'deepseek-flash', DEEPSEEK_API_KEY: modelKey }), [serviceToken]);
  assert.equal(calls.length, 0);
  const response = await frontend.modelRuntime.completeSimple(frontend.model, { messages: [{ role: 'user', content: 'Explicit public synthetic prompt.', timestamp: 1 }] });
  assert.equal(response.stopReason, 'error'); assert.equal(calls.length, 1);
  assert.equal(calls[0].model, 'deepseek-flash'); assert.equal(calls[0].max_tokens, 1600);
  assert.deepEqual(calls[0].thinking, { type: 'disabled' });
  assert.ok(!JSON.stringify(response).includes(modelKey) && !JSON.stringify(response).includes(serviceToken));
  assert.match(response.errorMessage, /REDACTED/);
});
