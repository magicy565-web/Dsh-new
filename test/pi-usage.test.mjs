import test from 'node:test';
import assert from 'node:assert/strict';
import { invocationUsage, openAIUsage, requestAllowance } from '../server/pi-usage.mjs';

test('wire usage absence, partial/malformed counters and cached prompt totals retain uncertainty', () => {
  assert.equal(openAIUsage({ choices: [{ delta: { content: 'Answer' } }] }), null);
  assert.equal(openAIUsage({ usage: { prompt_tokens: -1, completion_tokens: 5, total_tokens: 105 } })?.promptTokens, null);
  assert.equal(openAIUsage({ usage: { prompt_tokens: 100, completion_tokens: 5, total_tokens: 106 } }), null);
  assert.equal(openAIUsage({ usage: { prompt_tokens: 100, completion_tokens: 5, total_tokens: 105, prompt_tokens_details: { cached_tokens: 101 } } }), null);
  const cached = openAIUsage({ usage: { prompt_tokens: 100, completion_tokens: 5, total_tokens: 105, prompt_tokens_details: { cached_tokens: 80, cache_write_tokens: 10 } } });
  assert.deepEqual(cached, { promptTokens: 100, completionTokens: 5, totalTokens: 105, cacheReadTokens: 80, cacheWriteTokens: 10 });
  assert.deepEqual(invocationUsage([{ maxTokens: 400, usage: cached }, { maxTokens: 400, usage: null }]),
    { promptTokens: null, completionTokens: null, totalTokens: null, cacheReadTokens: null, cacheWriteTokens: null });
});

test('request ceilings include unsettled crash reservations and stay within the original budget', () => {
  const active = { maxTokens: 1600, requests: [] };
  for (let attempt = 0; attempt < 4; attempt++) {
    const maxTokens = requestAllowance(active); assert.equal(maxTokens, 400);
    // No settlement simulates missing usage or SIGKILL before acknowledgement.
    active.requests.push({ maxTokens, usage: null });
  }
  assert.equal(active.requests.reduce((sum, request) => sum + request.maxTokens, 0), 1600);
  assert.equal(requestAllowance(active), 0);
  assert.throws(() => requestAllowance({ maxTokens: 1600 }), /no verifiable/);
  const measured = { maxTokens: 1600, requests: [{ maxTokens: 400, usage: { completionTokens: 100 } }] };
  assert.equal(requestAllowance(measured), 500);
});
