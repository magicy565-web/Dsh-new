// Normal CLI contract: actual official launcher, original HTTP and synthetic
// backend only. No --sample, private configuration or live model transport.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createWorkspaceClient } from '../pi/extensions/workspace.mjs';
import { createWorkspaceTuiRuntime } from '../scripts/pi-workspace-tui.mjs';
import { startPiDevelopment } from '../server/pi-development.mjs';
import { createApp } from '../server/index.mjs';
import { createPiProvider } from '../server/pi-provider.mjs';
import { createHash } from 'node:crypto';

const exec = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const token = 'workspace-normal-public-synthetic-token';
const healthy = { status: 'ok', version: 'synthetic', mode: 'model', model: 'faux-1', configured: true,
  runtime: 'pi-durable', readiness: 'configured_unverified', projection: { projection: 'ready' } };
const presets = [{ id: 'procurement', required_inputs: ['product', 'spec', 'quantity'], optional_inputs: [] }];
const env = f => ({ PATH: process.env.PATH, LANG: 'C.UTF-8', ...(f ? { WS_AGENT_URL: f.baseURL, WS_AGENT_TOKEN: f.token } : {}) });
const cli = f => exec(process.execPath, [path.join(root, 'scripts/pi-workspace-tui.mjs'), '--check'], { cwd: root, env: env(f), timeout: 20_000 });
async function evidence(name, value) {
  const directory = process.env.PI_TUI_TEST_EVIDENCE_DIR;
  if (!directory) return;
  assert.ok(path.isAbsolute(directory)); await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(path.join(directory, name), JSON.stringify(value, null, 2));
}

test('readiness performs only original service GETs and rejects missing model, demo, degraded projection and auth', async () => {
  for (const [health, status, pattern] of [[healthy, 200, null], [{ ...healthy, readiness: 'unconfigured' }, 200, /model is not configured/],
    [{ ...healthy, mode: 'demo', readiness: 'demo' }, 200, /model is not configured/],
    [{ ...healthy, projection: { projection: 'degraded' } }, 200, /projection requires review/], [healthy, 403, /HTTP 403/]]) {
    const calls = [];
    const client = createWorkspaceClient({ baseURL: 'http://127.0.0.1:3210', token, fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return Response.json(url.endsWith('/health') ? health : presets, { status: url.endsWith('/presets') ? status : 200 });
    } });
    if (pattern) await assert.rejects(client.check(), pattern);
    else { const result = await client.check(); assert.equal(result.onlineVerified, false); assert.equal(result.modelCalls, 0); assert.equal(result.naturalLanguage, 'blocked-command-profile'); }
    assert.deepEqual(calls.map(row => new URL(row.url).pathname), ['/api/agent/v1/health', '/api/agent/v1/presets']);
    assert.ok(calls.every(row => row.options.method === 'GET' && row.options.body === undefined && row.options.redirect === 'error'));
  }
});

test('normal --check succeeds against explicit synthetic original backend without executing any model or task', async t => {
  const backend = await startPiDevelopment({ seedApprovalConnector: false }); t.after(() => backend.close());
  const calls = [], original = backend.app.server.listeners('request')[0];
  backend.app.server.removeListener('request', original);
  backend.app.server.on('request', (req, res) => { calls.push({ method: req.method, url: req.url }); return original(req, res); });
  const { stdout, stderr } = await cli(backend), receipt = JSON.parse(stdout);
  assert.equal(stderr, ''); assert.equal(receipt.transport, 'workspace-command-profile'); assert.equal(receipt.modelCalls, 0);
  assert.equal(receipt.backend.model, 'faux-1'); assert.equal(receipt.backend.readiness, 'configured_unverified'); assert.equal(receipt.backend.onlineVerified, false);
  assert.equal(backend.faux.state.callCount, 0); assert.equal(backend.app.store.read().runs.length, 0);
  assert.equal(backend.app.store.read().workspaceAgentTasks.tasks.length, 0);
  assert.deepEqual(calls, [{ method: 'GET', url: '/api/agent/v1/health' }, { method: 'GET', url: '/api/agent/v1/presets' }]);
  assert.ok(!stdout.includes(backend.token));
  await evidence('normal-check.json', { transport: backend.transport, cliSample: false, receipt, requests: calls, taskCount: 0, modelCalls: 0 });
});

test('normal --check fails explicitly for absent binding, unreachable backend, unconfigured model and denied identity', async t => {
  const failures = [];
  const refused = async (f, pattern, label) => assert.rejects(cli(f), error => { failures.push({ label, code: error.code, message: error.stderr.trim() }); return error.code === 1 && pattern.test(error.stderr); });
  await refused(undefined, /Set WS_AGENT_URL/, 'absent binding');
  const backend = await startPiDevelopment({ seedApprovalConnector: false });
  const endpoint = { baseURL: backend.baseURL, token: backend.token }; await backend.close();
  await refused(endpoint, /request did not settle/, 'unreachable backend');
  const directory = await fs.mkdtemp('/tmp/workspace-normal-unconfigured-');
  const app = await createApp({ dataDirectory: directory, provider: createPiProvider({ apiKey: '' }), capabilityEnvironment: {},
    agentConfig: { env: {}, principals: [{ subject: 'local-operator', workspaceId: 'local', tokenSha256: createHash('sha256').update(token).digest('hex'), scopes: ['agent:read', 'agent:submit'] }] } });
  t.after(async () => { await app.close(); await fs.rm(directory, { recursive: true, force: true }); });
  const address = await app.listen(0), f = { baseURL: `http://127.0.0.1:${address.port}`, token };
  await refused(f, /model is not configured/, 'backend model unconfigured');
  await refused({ ...f, token: 'wrong-public-synthetic-token' }, /HTTP 401|HTTP 403/, 'identity denied');
  assert.equal(app.store.read().runs.length, 0); assert.equal(app.store.read().workspaceAgentTasks.tasks.length, 0);
  await evidence('normal-check-failures.json', { failures, taskCount: 0, modelCalls: 0 });
});

test('official procurement inputs cancel safely, validate public fields and preserve identical requestId on retry', async t => {
  const directory = await fs.mkdtemp('/tmp/workspace-normal-input-'), submissions = [], errors = [], labels = [];
  const client = { businessSubmit: async value => { submissions.push(value); return { task: { taskId: 'original-public-task' } }; } };
  const { runtime } = await createWorkspaceTuiRuntime({ client, isolationDirectory: directory }); await runtime.session.bindExtensions({});
  t.after(async () => { await runtime.dispose(); await fs.rm(directory, { recursive: true, force: true }); });
  const command = runtime.session.extensionRunner.getCommand('ws-procurement');
  let answers = [];
  const ctx = { ui: { notify: message => errors.push(message), input: async label => { labels.push(label); return answers.shift(); } } };
  await command.handler('stable-public-key', ctx); assert.equal(submissions.length, 0);
  answers = ['public cup', 'password=public-synthetic-rejection']; await command.handler('stable-public-key', ctx); assert.equal(submissions.length, 0);
  answers = ['public cup', 'public spec', '0']; await command.handler('stable-public-key', ctx); assert.equal(submissions.length, 0);
  await command.handler('invalid:key', ctx); assert.equal(submissions.length, 0);
  for (let i = 0; i < 2; i++) { answers = ['public cup', 'public spec', '10']; await command.handler('stable-public-key', ctx); }
  assert.deepEqual(submissions[0], submissions[1]); assert.deepEqual(submissions[0], { type: 'procurement', title: 'Procurement: public cup', input: { product: 'public cup', spec: 'public spec', quantity: 10 }, requestId: 'stable-public-key' });
  assert.ok(labels.includes('Public quantity (positive integer)')); assert.ok(errors.some(value => value.includes('Public procurement input only')));
  assert.equal(runtime.session.model.provider, 'unknown'); // Official SDK placeholder; no frontend model selected.
});
