import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { request } from './agent-service.helpers.mjs';
import { workspaceOmpConfiguration, workspaceOmpConfigured } from '../server/workspace-omp-host.mjs';
const repository = new URL('..', import.meta.url).pathname;
async function port() {
  const server = net.createServer(); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const value = server.address().port; await new Promise(resolve => server.close(resolve)); return value;
}
test('explicit legacy launcher starts the original local test server without model credentials and rejects model admission', { timeout: 45000 }, async t => {
  const directory = await fs.mkdtemp('/tmp/workspace-omp-default-launch-'), selectedPort = await port();
  const child = spawn(process.execPath, [repository + '/scripts/workspace-omp-legacy.mjs'], { cwd: repository,
    env: { PATH: path.dirname(process.execPath) + ':/usr/bin:/bin', HOME: directory, TMPDIR: directory,
      WORKSPACE_DATA_DIR: directory + '/original', PORT: String(selectedPort), NO_COLOR: '1' },
    detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const exited = once(child, 'close'); let output = '';
  child.stdout.on('data', data => { output += data; }); child.stderr.on('data', data => { output += data; });
  t.after(async () => {
    if (child.exitCode === null) { try { process.kill(-child.pid, 'SIGTERM'); } catch {} }
    let timer; await Promise.race([exited, new Promise(resolve => { timer = setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL'); } catch {} resolve(); }, 3000); })]); clearTimeout(timer);
    await exited; await fs.rm(directory, { recursive: true, force: true });
  });
  for (let i = 0; i < 250 && !output.includes('Workspace server:'); i++) {
    if (child.exitCode !== null) throw new Error(output); await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.match(output, /Workspace server:/); assert.match(output, /"status":"unconfigured"/);
  assert.match(output, /SELECTED_MODEL_COST_AND_REMAINING_BUDGET_REQUIRED/);
  const base = 'http://127.0.0.1:' + selectedPort;
  const created = await request(base, '/api/conversations', { method: 'POST', body: { title: 'Public startup fixture', requestId: 'omp-default-launch' } });
  assert.equal(created.status, 201, created.text);
  const denied = await request(base, '/api/conversations/' + created.json.conversation.id + '/messages', {
    method: 'POST', body: { content: 'Explicit public product text', requestId: 'omp-default-denied' } });
  assert.equal(denied.status, 409, denied.text); assert.equal(denied.json.error.code, 'BUSINESS_AGENT_UNCONFIGURED');
  const state = JSON.parse(await fs.readFile(directory + '/original/workspace.json'));
  assert.equal(state.runs.length, 0); assert.equal(state.workspaceAgentTasks?.tasks?.length || 0, 0);
  assert.deepEqual(state.conversations[0].businessAgentOwner, { subject: 'local-operator', workspaceId: 'local' });
});
test('reviewed prices and trusted remaining-budget assertion are mandatory configuration, never zero-cost defaults', () => {
  const environment = { FASTAITOKEN_API_KEY: 'public-synthetic-fixture-key' };
  assert.equal(workspaceOmpConfigured(workspaceOmpConfiguration(environment)), false);
  assert.equal(workspaceOmpConfigured(workspaceOmpConfiguration({ ...environment, WORKSPACE_OMP_PROVIDER_COST_JSON: '{"input":1,"output":2,"cacheRead":0,"cacheWrite":0}' })), false);
  assert.equal(workspaceOmpConfigured(workspaceOmpConfiguration({ ...environment, WORKSPACE_OMP_PROVIDER_COST_JSON: '{"input":1,"output":2,"cacheRead":0,"cacheWrite":0}', WORKSPACE_OMP_LIVE_BUDGET_VERIFIED: '1' })), true);
  assert.throws(() => workspaceOmpConfiguration({ WORKSPACE_OMP_PROVIDER_COST_JSON: '{"input":0}' }));
});

for (const profile of ['factory-materials', 'factory-inquiries']) test(`ordinary startup check reports ${profile} policy required and public tools disabled without reading credentials`, { timeout: 30000 }, async t => {
  const directory = await fs.mkdtemp('/tmp/workspace-omp-profile-check-');
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const child = spawn(process.execPath, [repository + '/scripts/workspace-omp-legacy.mjs', '--check'], { cwd: directory,
    env: { PATH: path.dirname(process.execPath) + ':/usr/bin:/bin', HOME: directory, TMPDIR: directory, NO_COLOR: '1', WORKSPACE_OMP_PROFILE: profile },
    stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '', errors = ''; child.stdout.on('data', chunk => { output += chunk; }); child.stderr.on('data', chunk => { errors += chunk; });
  assert.equal((await once(child, 'close'))[0], 0, errors);
  const value = JSON.parse(output.trim()); assert.equal(value.status, 'unconfigured');
  assert.equal(value.frontend.profile, profile); assert.equal(value.frontend.engineScope, `omp:18.10.4:${profile}-v1`);
  assert.equal(value.library, 'original-reviewed-session-policy-required'); assert.equal(value.frontend.modelKeyPresent, false);
  assert.equal(value.publicToolConfiguration.search, 'disabled_in_private_profile'); assert.equal(value.publicToolConfiguration.browser, 'disabled_in_private_profile');
  assert.equal(value.publicToolConfiguration.searchProvider, null); assert.equal(value.publicToolConfiguration.selectedPublicFileCount, 0);
  assert.equal(value.modelCalls, 0); assert.equal(value.paidModelCalls, 0); assert.equal(value.backend.status, 'unconfigured');
});
