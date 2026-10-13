import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createApp } from '../server/index.mjs';
import { createAgentService } from '../server/agent/service.mjs';
import { pruneAgentHistory } from '../scripts/agent-retention.mjs';
import { API, INPUTS, request, stream, credentials, serviceFixture } from './agent-service.helpers.mjs';

// Unified Pi execution/recovery is tested in agent-pi-service.http.test.mjs.
// PR44-specific engine/retention assertions are archived with the unchanged source.
test('input validation rejects invalid text/quantity fields and preserves both quote text and structured quotes', async t => {
  const f = await serviceFixture(t);
  for (const changed of [{ product: 123 }, { spec: 500 }, { market: 100 }, { quantity: '0个' }, { quantity: '-10' }, { quantity: '很多' }]) {
    const response = await f.api(`${API}/tasks`, { method: 'POST', body: { type: 'procurement', title: '无效输入验收', input: { ...INPUTS.procurement, ...changed } } });
    assert.equal(response.status, 400); assert.equal(typeof response.json.error, 'string');
  }
  const quoteText = '用户原始报价文字：打样周期尚未回复，需要追问。';
  const response = await f.api(`${API}/tasks`, { method: 'POST', body: { type: 'procurement', title: '混合报价材料', input: {
    ...INPUTS.procurement, quantity: '1,000个', quotes: [quoteText, { supplier: '用户提供的候选甲', unit_price: '18', currency: 'CNY', trade_term: 'EXW' }],
  } } });
  assert.equal(response.status, 201);
  const events = (await stream(f.base, response.json.events_url, f.tokenA)).events;
  assert.equal(events.at(-1).kind, 'done');
  const comparison = events.find(event => event.kind === 'artifact' && event.payload.name === 'comparison.md').payload;
  const file = await f.api(comparison.url);
  assert.equal(file.status, 200); assert.ok(file.text.includes(quoteText));
  assert.ok(file.text.includes('用户提供的候选甲')); assert.ok(file.text.includes('1,000个'));
});
