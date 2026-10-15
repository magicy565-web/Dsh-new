import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { presence, acceptanceConfiguration, boundedDeepseekFetch, measuredUsage, readonlyWorkspaceFetch, verifyReadonlyAnswer } from '../server/deepseek-acceptance-policy.mjs';
test('latest user-confirmed CNY5 uses original OMP config, fixed Flash/origin, and needs no billing JSON or flags', () => {
  const config = acceptanceConfiguration({ DEEPSEEK_API_KEY: 'synthetic-invalid', PI_PROVIDER: 'other', PI_MODEL: 'expensive', PI_BASE_URL: 'https://other.invalid' });
  assert.equal(config.providerId, 'workspace-deepseek'); assert.equal(config.model, 'deepseek-flash'); assert.equal(config.baseUrl, 'https://api.deepseek.com');
  assert.equal(config.remainingBudgetVerified, true); assert.equal(config.cost.input, 0.3);
  assert.ok(Object.values(presence({ DEEPSEEK_API_KEY: 'synthetic-invalid' })).every(v => typeof v === 'boolean'));
});
const body = () => ({ model: 'deepseek-flash', messages: [{ role: 'developer', content: 'Read only.' }], tools: [{ type: 'function', function: { name: 'workspace_business_tasks', strict: true } }], max_tokens: 9999 });
const send = (guard, value = body()) => guard.fetch('https://api.deepseek.com/chat/completions', { method: 'POST', body: JSON.stringify(value) });
test('official model transport clamps short request/output, non-thinking, receiver and two-request limit', async () => {
  const sent = [], guard = boundedDeepseekFetch(async req => { sent.push(await req.json()); return new Response('{}'); });
  await send(guard); await send(guard);
  assert.equal(sent[0].max_tokens, 512); assert.deepEqual(sent[0].thinking, { type: 'disabled' }); assert.equal(sent[0].messages[0].role, 'system');
  assert.equal(sent[0].tools[0].function.strict, undefined);
  await assert.rejects(send(guard), /EXHAUSTED/); assert.equal(guard.requests(), 2);
  const fresh = boundedDeepseekFetch(async () => { throw Error('must-not-send'); });
  await assert.rejects(send(fresh, { ...body(), model: 'deepseek-v4-pro' }), /PINNED/);
  await assert.rejects(send(fresh, { ...body(), messages: [{ role: 'user', content: 'x'.repeat(12001) }] }), /SHORT_INPUT/);
  assert.equal(fresh.requests(), 0);
});
test('uncertain network charges and non-200 replies stop subsequent requests with no automatic retry', async () => {
  for (const network of [async () => { throw Error('synthetic-secret'); }, async () => new Response('{}', { status: 401 })]) {
    const guard = boundedDeepseekFetch(network); await send(guard).catch(() => {});
    await assert.rejects(send(guard), /UNCERTAIN/); assert.equal(guard.requests(), 1);
  }
  assert.throws(() => measuredUsage([{ role: 'assistant', stopReason: 'toolUse', usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 } }]), /UNCERTAIN/);
});
test('read-only HTTP refuses writes, private reads, cross-origin and extra selectors before fetching', async () => {
  let calls = 0; const read = readonlyWorkspaceFetch('http://127.0.0.1', async () => { calls++; return new Response('{}'); });
  await read('http://127.0.0.1/api/agent/v1/tasks?limit=1');
  for (const [url, method] of [['http://127.0.0.1/api/agent/v1/tasks', 'POST'], ['http://127.0.0.1/api/library/model-read', 'GET'], ['https://other.invalid/api/agent/v1/tasks', 'GET']]) await assert.rejects(read(url, { method }), /READONLY/);
  assert.equal(calls, 1);
});
test('citation requires original task ID/API and refuses credential-like final text', () => {
  const messages = text => [{ role: 'toolResult', toolName: 'workspace_business_tasks', content: [{ type: 'text', text: JSON.stringify({ status: 'available', tasks: [{ taskId: 'synthetic-task' }], sources: [{ kind: 'task', recordId: 'synthetic-task', api: '/api/agent/v1/tasks/synthetic-task' }] }) }] }, { role: 'assistant', stopReason: 'stop', content: [{ type: 'text', text }] }];
  assert.equal(verifyReadonlyAnswer(messages('synthetic-task /api/agent/v1/tasks/synthetic-task')).status, 'passed');
  assert.throws(() => verifyReadonlyAnswer(messages('No source')), /CITATION/);
  assert.throws(() => verifyReadonlyAnswer(messages('synthetic-task /api/agent/v1/tasks/synthetic-task api_key=synthetic-dangerous')), /UNSAFE/);
});
test('one-command check and paid flag with no secret both wait with zero model requests and no billing requirement', () => {
  for (const flag of ['--check', '--execute-paid-requests']) {
    const child = spawnSync(process.execPath, ['scripts/acceptance-deepseek-readonly.mjs', flag], { env: { PATH: process.env.PATH }, encoding: 'utf8' });
    assert.equal(child.status, 2); const report = JSON.parse(child.stdout);
    assert.equal(report.sdk, 'omp@18.10.4'); assert.equal(report.modelRequests, 0); assert.equal(report.needsBillingJson, false); assert.equal(report.remainingBudgetCapCny, 5);
  }
});
