import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import { reserveBudgetEvidence } from '../scripts/acceptance-deepseek-readonly.mjs';
import { presence, acceptanceConfiguration, validateBudgetEvidence, modelAdmission, readonlyWorkspaceFetch, verifyReadonlyAnswer } from '../server/deepseek-acceptance-policy.mjs';
const now = Date.parse('2026-10-15T12:00:00Z');
const environment = { PI_PROVIDER: 'deepseek', PI_MODEL: 'deepseek-flash', DEEPSEEK_API_KEY: 'synthetic-invalid-key',
  WS_AGENT_URL: 'http://127.0.0.1:8787', WS_AGENT_TOKEN: 'synthetic-invalid-token' };
const evidence = () => ({ schema: 'workspace.deepseek-readonly-budget.v1', provider: 'workspace-deepseek', model: 'deepseek-flash',
  receiptId: 'synthetic-not-billing-proof', billingEvidenceRef: 'synthetic-billing', priceEvidenceRef: 'synthetic-price', hardCapEvidenceRef: 'synthetic-hard-cap',
  hardCapVerified: true, currency: 'CNY', approvedCapCny: 5, spentCny: 2, remainingCny: 3,
  inputUpperCnyPerMillion: 1, outputUpperCnyPerMillion: 2, verifiedAt: new Date(now).toISOString(), expiresAt: new Date(now + 600_000).toISOString() });

test('diagnostic exposes only allowlisted names/booleans and never infers a provider from a key', () => {
  const output = presence({ ...environment, OTHER_SECRET: 'must-not-scan' });
  assert.ok(Object.values(output).every(v => typeof v === 'boolean'));
  assert.ok(!JSON.stringify(output).includes('synthetic-invalid')); assert.equal(output.OTHER_SECRET, undefined);
  assert.throws(() => acceptanceConfiguration({ ...environment, PI_PROVIDER: undefined }), /EXPLICIT_DEEPSEEK/);
  assert.throws(() => acceptanceConfiguration({ ...environment, DEEPSEEK_API_KEY: '' }), /KEY_NOT_BOUND/);
  assert.throws(() => acceptanceConfiguration({ ...environment, PI_MODEL: 'unknown' }), /PINNED/);
  assert.throws(() => acceptanceConfiguration({ ...environment, WS_AGENT_TOKEN: '' }), /BINDING/);
});
test('approval flags cannot replace a fresh reconciled cumulative remainder and price/hard-cap evidence', () => {
  assert.equal(validateBudgetEvidence(evidence(), 'deepseek-flash', now).ceilingCny, 0.3936);
  for (const change of [{ spentCny: undefined }, { spentCny: 0 }, { remainingCny: 5 }, { remainingCny: -1 },
    { approvedCapCny: 6 }, { inputUpperCnyPerMillion: 0 }, { outputUpperCnyPerMillion: Infinity },
    { hardCapVerified: false }, { hardCapEvidenceRef: '' }, { currency: 'USD' }, { model: 'different' },
    { verifiedAt: new Date(now - 901_000).toISOString() }, { verifiedAt: new Date(now + 1).toISOString() },
    { expiresAt: new Date(now).toISOString() }, { expiresAt: new Date(now + 3_601_000).toISOString() },
    { inputUpperCnyPerMillion: 100 }]) assert.throws(() => validateBudgetEvidence({ ...evidence(), ...change }, 'deepseek-flash', now));
  assert.throws(() => validateBudgetEvidence({ approved: true, totalCap: 5 }, 'deepseek-flash', now));
});
test('admission charges uncertain attempts, refuses the fourth call, changed receiver, oversize context and expiry', async () => {
  const config = acceptanceConfiguration(environment), budget = validateBudgetEvidence(evidence(), config.model, now);
  const model = { provider: config.providerId, id: config.model, baseUrl: config.baseUrl, contextWindow: 128000, maxTokens: 1600 };
  const gate = modelAdmission(config, budget, () => now);
  for (let i = 0; i < 3; i++) await gate.beforeModelRequest({ model, context: {} });
  await assert.rejects(gate.beforeModelRequest({ model, context: {} }), /CALL_LIMIT/); assert.equal(gate.calls(), 3);
  const changed = modelAdmission(config, budget, () => now);
  await assert.rejects(changed.beforeModelRequest({ model: { ...model, baseUrl: 'https://other.invalid' }, context: {} }), /RECEIVER/);
  await assert.rejects(changed.beforeModelRequest({ model, context: { text: 'a'.repeat(120_001) } }), /CONTEXT_LIMIT/);
  await assert.rejects(modelAdmission(config, budget, () => budget.expiresAt).beforeModelRequest({ model, context: {} }), /EXPIRED/);
  assert.equal(changed.calls(), 0);
});
test('HTTP boundary blocks writes, private endpoints, redirects and cross-origin destinations before fetch', async () => {
  const calls = [], read = readonlyWorkspaceFetch(environment.WS_AGENT_URL, async (request, options) => { calls.push(request.url); assert.equal(options.redirect, 'error'); return new Response('{}'); });
  await read(environment.WS_AGENT_URL + '/api/agent/v1/tasks?limit=1', { method: 'GET' });
  for (const [url, method] of [['/api/agent/v1/tasks', 'POST'], ['/api/agent/v1/tasks/id/resume', 'POST'], ['/api/library/model-read', 'GET'],
    ['/api/agent/v1/tasks?owner=other', 'GET'], ['https://other.invalid/api/agent/v1/tasks', 'GET']]) {
    await assert.rejects(read(url.startsWith('https:') ? url : environment.WS_AGENT_URL + url, { method }), /READONLY/);
  }
  assert.equal(calls.length, 1);
});
test('citation pass needs a successful actual tool receipt and both original task ID and API reference', () => {
  const receipt = { status: 'available', tasks: [{ taskId: 'synthetic-task' }], sources: [{ kind: 'task', recordId: 'synthetic-task', api: '/api/agent/v1/tasks/synthetic-task' }] };
  const messages = text => [{ role: 'toolResult', toolName: 'workspace_business_tasks', content: [{ type: 'text', text: JSON.stringify(receipt) }] },
    { role: 'assistant', stopReason: 'stop', content: [{ type: 'text', text }] }];
  assert.equal(verifyReadonlyAnswer(messages('synthetic-task /api/agent/v1/tasks/synthetic-task')).status, 'passed');
  assert.throws(() => verifyReadonlyAnswer(messages('Looks successful')), /CITATION/);
  assert.throws(() => verifyReadonlyAnswer(messages('synthetic-task /api/agent/v1/tasks/synthetic-task api_key=synthetic-dangerous-output')), /UNSAFE_ANSWER/);
  const failed = messages('synthetic-task /api/agent/v1/tasks/synthetic-task'); failed[0].isError = true;
  assert.throws(() => verifyReadonlyAnswer(failed), /RECEIPT/);
  failed[0].isError = false; failed[1].stopReason = 'error'; assert.throws(() => verifyReadonlyAnswer(failed), /INCOMPLETE/);
  const empty = messages('No records'); empty[0].content[0].text = JSON.stringify({ status: 'empty', tasks: [], sources: [] });
  assert.throws(() => verifyReadonlyAnswer(empty), /NO_AUTHORIZED_RECORDS/);
});
test('CLI without safe bindings reports waiting with zero model calls, even with paid flag', () => {
  for (const flag of ['--check', '--execute-paid-requests']) {
    const result = spawnSync(process.execPath, ['scripts/acceptance-deepseek-readonly.mjs', flag], { env: { PATH: process.env.PATH }, encoding: 'utf8' });
    assert.equal(result.status, 2); const report = JSON.parse(result.stdout);
    assert.equal(report.status, 'waiting'); assert.equal(report.modelRequests, 0); assert.equal(report.realModelVerified, false); assert.equal(result.stderr, '');
  }
});
test('exclusive reservation admits only one concurrent attempt and remains consumed after uncertain failure', async t => {
  const directory = await fs.mkdtemp('/tmp/deepseek-budget-reservation-'); t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const budget = validateBudgetEvidence(evidence(), 'deepseek-flash', now), file = directory + '/synthetic-billing-evidence.json';
  const attempts = await Promise.allSettled([reserveBudgetEvidence(file, budget), reserveBudgetEvidence(file, budget)]);
  assert.equal(attempts.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(attempts.find(r => r.status === 'rejected').reason.code, 'EEXIST');
  const reservation = JSON.parse(await fs.readFile(file + '.reservation', 'utf8'));
  assert.equal(reservation.reservedCny, budget.ceilingCny); assert.equal(reservation.reconciliationRequired, true);
  await assert.rejects(reserveBudgetEvidence(file, budget), { code: 'EEXIST' });
});
