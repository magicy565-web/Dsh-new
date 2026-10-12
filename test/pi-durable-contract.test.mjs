import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { Type, createModels } from '@earendil-works/pi-ai';
import { fauxProvider, fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai/providers/faux';
import { BACKGROUND_CONTEXT, withAbortSignal } from '@earendil-works/chord/context';
import { Harness, createRegistry, defineExtension, defineTool } from '@earendil-works/pi-durable';
import { openNodeJsonlStorage } from '@earendil-works/pi-durable/storage/jsonl/node';
const context = BACKGROUND_CONTEXT;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check) { for (let i = 0; i < 500; i++) { if (await check()) return; await delay(5); } throw new Error('Official durable fixture timed out'); }
async function fixture(t, registry = createRegistry()) {
  const directory = await fs.mkdtemp('/tmp/pi-durable-official-');
  const faux = fauxProvider(), models = createModels(); models.setProvider(faux.provider);
  let harness;
  const open = async () => { harness = await Harness.open(await openNodeJsonlStorage(directory, context, { fsync: true }), { models, registry, settings: { retry: { enabled: false }, compaction: { enabled: false } } }, context); return harness; };
  await open();
  t.after(async () => { await harness.close(context); await fs.rm(directory, { recursive: true, force: true }); });
  return { faux, get harness() { return harness; }, async reopen() { await harness.close(context); return open(); } };
}

test('official durable contract fixture: write appends without model execution and requestId deduplicates across reopen', async t => {
  const f = await fixture(t);
  const root = await f.harness.root(context, { agent: { model: { provider: 'faux', modelId: 'faux-1' } } });
  const write = await root.submit({ type: 'write', requestId: 'fixture-muse-receipt-write', entry: { kind: 'app.fixture-receipt', data: { executionVerified: false, wakeVerified: false } } }, context);
  assert.equal((await write.wait(context)).status, 'done');
  assert.equal(f.faux.state.callCount, 0);
  f.faux.setResponses([fauxAssistantMessage('Exactly once official fixture')]);
  const input = await root.submit({ type: 'input', requestId: 'fixture-stable-input', content: 'Fixture input' }, context);
  assert.equal((await input.wait(context)).status, 'done');
  await f.reopen();
  const reopened = await f.harness.root(context);
  const duplicate = await reopened.submit({ type: 'input', requestId: 'fixture-stable-input', content: 'Fixture input' }, context);
  assert.equal(duplicate.id, input.id);
  assert.equal((await duplicate.wait(context)).status, 'done');
  assert.equal(f.faux.state.callCount, 1);
});

test('official durable contract fixture: cancelling wait leaves work admitted; explicit conversation abort stops it', async t => {
  const f = await fixture(t);
  let providerAborted = false;
  f.faux.setResponses([async (_request, options) => { await new Promise(resolve => options.signal.addEventListener('abort', () => { providerAborted = true; resolve(); }, { once: true })); return fauxAssistantMessage('', { stopReason: 'aborted' }); }]);
  const root = await f.harness.root(context, { agent: { model: { provider: 'faux', modelId: 'faux-1' } } });
  const submission = await root.submit({ type: 'input', content: 'Fixture wait cancellation' }, context);
  const controller = new AbortController();
  const waited = submission.wait(withAbortSignal(controller.signal, context));
  await until(() => f.faux.state.callCount === 1); controller.abort('fixture waiter cancelled');
  await assert.rejects(waited);
  assert.equal(providerAborted, false);
  assert.notEqual((await submission.status(context)).status, 'unanswered');
  await root.abort(context);
  assert.equal(providerAborted, true);
  assert.equal((await submission.wait(context)).status, 'unanswered');
});

test('official durable contract fixture: only replay:safe tool execution restarts after close/reopen', async t => {
  for (const replay of ['safe', 'unsafe']) {
    let calls = 0;
    const tool = defineTool({ name: 'fixture_tool', description: 'Local synthetic replay fixture; no external effect', parameters: Type.Object({}), replay,
      async execute(_args, _api, toolContext) {
        calls++;
        if (calls === 1) { await new Promise(resolve => toolContext.abortSignal.addEventListener('abort', resolve, { once: true })); toolContext.abortSignal.throwIfAborted(); }
        return { content: [{ type: 'text', text: 'safe local result' }] };
      } });
    const extension = defineExtension({ name: 'fixture-replay', tools: [tool] }), registry = createRegistry(); registry.install(extension);
    const f = await fixture(t, registry);
    f.faux.setResponses([fauxAssistantMessage(fauxToolCall('fixture_tool', {}), { stopReason: 'toolUse' }), request => {
      assert.equal(Boolean(request.messages.at(-1).isError), replay === 'unsafe');
      return fauxAssistantMessage('Replay contract fixture finished');
    }]);
    const root = await f.harness.root(context, { agent: { model: { provider: 'faux', modelId: 'faux-1' }, extensions: [extension] } });
    const submission = await root.submit({ type: 'input', content: 'Replay fixture' }, context);
    await until(() => calls === 1);
    await f.reopen();
    const recovered = await f.harness.submission(submission.id, context);
    const settled = await recovered.wait(context);
    assert.equal(settled.status, 'done', JSON.stringify({ replay, settled, calls }));
    assert.equal(calls, replay === 'safe' ? 2 : 1);
  }
});
