import test from 'node:test';
import assert from 'node:assert/strict';
import { marketValidationMonitorExtension, MARKET_MONITOR_TOOLS } from '../packages/workspace-market-validation/src/monitor.js';
const input = { requestId: 'propose', planId: 'original', planRevision: 1, launchReceiptId: 'launch' };
function fixture(client, authorize = async signal => signal?.throwIfAborted()) {
  const tools = []; marketValidationMonitorExtension({ client, authorize })({ registerTool: t => tools.push(t) });
  return { tools, invoke: (i, args, signal) => tools[i].execute('test-call', args, signal, null, { model: { id: 'keyless-test' } }) };
}
test('monitor schemas and runtime reject model approval, changed start, extra scopes and malformed inputs before effects', async () => {
  let calls = 0; const f = fixture({ request() { calls++; } });
  assert.deepEqual(f.tools.map(t => t.name), MARKET_MONITOR_TOOLS);
  for (const args of [{ ...input, confirmed: true }, { ...input, approved: true }, { ...input, startedAt: 'now' }, { ...input, planRevision: 0 }, { ...input, requestId: '' }, { ...input, launchReceiptId: ' leading-space' }, { ...input, planId: 'bad\nreference' }]) {
    const r = await f.invoke(0, args); assert.equal(r.details.reason, 'MARKET_MONITOR_INPUT_INVALID'); assert.equal(r.isError, true);
    assert.deepEqual(JSON.parse(r.content[0].text), r.details);
  }
  assert.equal((await f.invoke(2, { goalId: 'original', action: 'pause', confirmed: true })).details.reason, 'MARKET_MONITOR_INPUT_INVALID');
  assert.equal(calls, 0); assert.equal((await f.invoke(2, { goalId: 'original', action: 'enable' })).isError, true);
});
test('unconfigured, failures, revoked authorization and abort return bounded recognizable errors', async () => {
  assert.equal((await fixture().invoke(0, input)).details.status, 'unconfigured');
  const f = fixture({ request: async () => { throw Object.assign(Error('PRIVATE_HOST_BODY'), { code: 'REAL_LAUNCH_RECEIPT_REQUIRED' }); } });
  const r = await f.invoke(0, input); assert.equal(r.details.reason, 'REAL_LAUNCH_RECEIPT_REQUIRED'); assert.ok(!JSON.stringify(r).includes('PRIVATE_HOST_BODY'));
  let calls = 0;
  const revoked = fixture({ request: () => { calls++; } }, async () => { throw Error('revoked'); });
  assert.equal((await revoked.invoke(0, input)).details.reason, 'ORIGINAL_AUTHORIZATION_REFUSED'); assert.equal(calls, 0);
  const abort = new AbortController();
  const cancel = fixture({ request: async (_input, signal) => { assert.equal(signal, abort.signal); abort.abort(); signal.throwIfAborted(); } });
  assert.equal((await cancel.invoke(0, input, abort.signal)).details.reason, 'ORIGINAL_OPERATION_CANCELLED');
});
