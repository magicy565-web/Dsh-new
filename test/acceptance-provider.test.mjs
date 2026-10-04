import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { runProviderAcceptance, ACCEPTANCE_LIMITS } from '../scripts/acceptance-provider.mjs';
import { ProviderError } from '../server/provider.mjs';

test('provider acceptance runner uses true HTTP/restart but labels scripted model evidence explicitly', async () => {
  let count = 0; let marker;
  const provider = { configured: true, async complete({ messages, json, signal, maxTokens }) {
    count++; assert.ok(maxTokens <= ACCEPTANCE_LIMITS.outputTokensPerRequest);
    marker ||= messages.map(item => item.content).join(' ').match(/ACCEPTANCE-[a-f0-9-]{8}/)?.[0];
    if (count === 5) return await new Promise((resolve, reject) => { const stop = () => reject(new ProviderError('CANCELLED', 'Fixture cancelled')); if (signal.aborted) stop(); else signal.addEventListener('abort', stop, { once: true }); });
    return { content: json ? JSON.stringify({ done: true, content: 'Check tests and backups before release.' }) : marker, usage: { promptTokens: 8, completionTokens: 6, totalTokens: 14 } };
  } };
  const report = await runProviderAcceptance({ provider, timeoutMs: 15_000 });
  assert.equal(report.evidenceKind, 'scripted-model-fixture'); assert.equal(report.result, 'passed', JSON.stringify(report));
  assert.equal(count, 5); assert.equal(report.requestCount, 5); assert.equal(report.checks.length, 6);
  assert.equal(report.calls.at(-1).outcome, 'CANCELLED'); assert.match(report.sourceFingerprint, /^[a-f0-9]{64}$/);
  assert.ok(report.inputCharacters < ACCEPTANCE_LIMITS.totalInputCharacters);
});
test('live acceptance is opt-in and never falls back to a scripted model or emits credentials', () => {
  try { execFileSync(process.execPath, ['scripts/acceptance-provider.mjs'], { env: { PATH: process.env.PATH, DEEPSEEK_API_KEY: 'not-a-real-secret' }, encoding: 'utf8', stdio: 'pipe' }); assert.fail('Should reject'); }
  catch (error) { assert.equal(error.status, 1); assert.match(error.stderr, /not completed/); assert.doesNotMatch(error.stderr, /not-a-real-secret/); }
});
