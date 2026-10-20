import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHarness } from '../../../packages/harness-kernel/src/app.mjs';
import { apply } from '../src/index.mjs';

const ROOT = path.resolve(new URL('../../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/u, '$1'));

async function boot(t, config) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'llm-bridge-'));
  const storage = path.join(directory, 'data').replace(/\\/gu, '/');
  const composition = [
    'version: 1', 'name: llm-bridge', 'server: { host: 127.0.0.1, port: 0 }', 'plugins:',
    '  - id: storage', "    name: '@workspace-harness/seams/storage'", `    config: { directory: '${storage}' }`,
    '  - id: llm', "    name: '@workspace-harness/seams/llm'",
    '  - id: bridge', '    name: workspace-llm-bridge', `    config: ${JSON.stringify(config)}`,
    '',
  ].join('\n');
  const file = path.join(directory, 'harness.yml');
  await fs.writeFile(file, composition, 'utf8');
  const harness = await createHarness({ compositionPath: file, root: ROOT });
  t.after(async () => { await harness.stop(); await fs.rm(directory, { recursive: true, force: true }); });
  return harness;
}

const health = harness => harness.healthz().checks.find(check => check.name === 'llm-bridge');

test('disabled by default: nothing is registered and health says why', async t => {
  const harness = await boot(t, {});
  const llm = harness.ctx.reflect.get('llm', false);
  assert.deepEqual(llm.providers(), []);
  const check = health(harness);
  assert.equal(check.status, 'ok');
  assert.equal(check.detail.configured, false);
  assert.match(check.detail.reason, /disabled in composition/u);
  assert.equal(harness.healthz().status, 'ok');
});

test('enabled without a credential stays unconfigured and never prints a value', async t => {
  const harness = await boot(t, { enabled: true, apiKeyEnv: 'HARNESS_LLM_TEST_MISSING' });
  const llm = harness.ctx.reflect.get('llm', false);
  assert.deepEqual(llm.providers(), []);
  const check = health(harness);
  assert.equal(check.detail.configured, false);
  assert.equal(check.detail.env, 'HARNESS_LLM_TEST_MISSING');
  assert.match(check.detail.reason, /credential is not set/u);
});

test('enabled with a credential registers the runtime provider without exposing the secret', async t => {
  const variable = 'HARNESS_LLM_TEST_KEY';
  const secret = 'test-key-do-not-leak-123';
  const previous = process.env[variable];
  process.env[variable] = secret;
  t.after(() => {
    if (previous === undefined) delete process.env[variable];
    else process.env[variable] = previous;
  });
  const harness = await boot(t, { enabled: true, apiKeyEnv: variable, model: 'deepseek-v4-pro', maxTokens: 222 });
  const llm = harness.ctx.reflect.get('llm', false);
  assert.deepEqual(llm.providers(), [{ id: 'workspace-deepseek', model: 'deepseek-v4-pro', label: 'Workspace runtime (deepseek-v4-pro)' }]);
  const check = health(harness);
  assert.equal(check.detail.configured, true);
  assert.equal(check.detail.provider, 'workspace-deepseek');
  assert.equal(check.detail.model, 'deepseek-v4-pro');
  assert.doesNotMatch(JSON.stringify(harness.healthz()), /test-key-do-not-leak|HARNESS_LLM_TEST_KEY=/u);
});

test('the plugin validates its configuration and requires ctx.llm', async t => {
  await assert.rejects(apply({}, {}), error => error.code === 'HARNESS_PLUGIN_MISSING_DEPENDENCY');
  await assert.rejects(apply({ llm: { register() {} } }, { enabled: 'yes' }), error => error.code === 'HARNESS_MANIFEST_INVALID');
  await assert.rejects(apply({ llm: { register() {} } }, { apiKeyEnv: 'lower-case' }), error => error.code === 'HARNESS_MANIFEST_INVALID');
  await assert.rejects(apply({ llm: { register() {} } }, { maxTokens: 0 }), error => error.code === 'HARNESS_MANIFEST_INVALID');
  await assert.rejects(apply({ llm: { register() {} } }, { timeoutMs: 1 }), error => error.code === 'HARNESS_MANIFEST_INVALID');
});
