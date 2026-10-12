import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createModels } from '@earendil-works/pi-ai';
import { fauxProvider, fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai/providers/faux';
import { createApp } from '../server/index.mjs';
import { createPiProvider, PI_SOURCE } from '../server/pi-provider.mjs';

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check) { for (let i = 0; i < 500; i++) { if (await check()) return; await delay(10); } throw new Error('Pi fixture did not settle'); }
function makeProvider(faux) { const models = createModels(); models.setProvider(faux.provider); return createPiProvider({ models, providerId: 'faux', model: 'faux-1' }); }
async function fixture(t, responses = []) {
  const directory = await fs.mkdtemp('/tmp/workspace-pi-test-');
  const faux = fauxProvider(); faux.setResponses(responses);
  let app = await createApp({ dataDirectory: directory, provider: makeProvider(faux) });
  t.after(async () => { await app.close(); await fs.rm(directory, { recursive: true, force: true }); });
  return { directory, faux, get app() { return app; }, async reopen() { await app.close(); app = await createApp({ dataDirectory: directory, provider: makeProvider(faux) }); return app; } };
}
async function chat(f, content = 'Fixture input', extra = {}) {
  const conversation = (await f.app.runtime.createConversation({})).conversation;
  const result = await f.app.runtime.sendMessage(conversation.id, { content, requestId: 'pi-fixture-request', ...extra });
  return { conversation, result };
}

test('real Pi package fixture: durable text execution, usage, persisted submission and business dedupe', async t => {
  const f = await fixture(t, [fauxAssistantMessage('Pi fixture answer')]);
  const { conversation, result } = await chat(f);
  await until(() => f.app.runtime.getRun(result.run.id).run.status !== 'running');
  const run = f.app.runtime.getRun(result.run.id).run;
  assert.equal(run.status, 'succeeded', JSON.stringify(run.error));
  assert.ok(run.piSubmissionId); assert.ok(run.piRequestId);
  assert.equal(f.app.runtime.bootstrap().messages.at(-1).content, 'Pi fixture answer');
  assert.equal(f.app.runtime.bootstrap().messages.at(-1).runtime.source, PI_SOURCE);
  await f.reopen();
  const repeated = await f.app.runtime.sendMessage(conversation.id, { content: 'Fixture input', requestId: 'pi-fixture-request' });
  assert.equal(repeated.duplicate, true); assert.equal(repeated.run.id, run.id);
  assert.equal(f.faux.state.callCount, 1);
});

test('real Pi package fixture: selected file tool uses original ID/version/SHA snapshot and cannot read ambient data', async t => {
  const f = await fixture(t);
  const artifact = (await f.app.artifacts.create({ filename: 'selected.txt', content: 'Selected fixture bytes', mimeType: 'text/plain' })).artifact;
  f.faux.setResponses([fauxAssistantMessage(fauxToolCall('workspace_input', { kind: 'artifact', id: artifact.id }), { stopReason: 'toolUse' }), (ctx) => {
    assert.ok(JSON.stringify(ctx).includes('Selected fixture bytes'));
    return fauxAssistantMessage('Verified selected input fixture');
  }]);
  const { result } = await chat(f, 'Read selected file', { inputContext: { artifacts: [{ id: artifact.id, version: artifact.currentVersion }], skills: [], memoryIds: [], connectorActions: [] } });
  await until(() => f.app.runtime.getRun(result.run.id).run.status !== 'running');
  assert.equal(f.app.runtime.getRun(result.run.id).run.status, 'succeeded', JSON.stringify(f.app.runtime.getRun(result.run.id).run.error));
  assert.equal(f.faux.state.callCount, 2);
});

test('real Pi package fixture: user cancellation explicitly aborts durable work; reopen does not resume it', async t => {
  const f = await fixture(t, [async (_ctx, options) => { await new Promise(resolve => options.signal.addEventListener('abort', resolve, { once: true })); return fauxAssistantMessage('', { stopReason: 'aborted' }); }]);
  const { result } = await chat(f);
  await until(() => f.faux.state.callCount === 1);
  await f.app.runtime.cancelRun(result.run.id);
  await until(() => f.app.runtime.status().queue.active === 0);
  assert.equal(f.app.runtime.getRun(result.run.id).run.status, 'cancelled');
  await f.reopen(); await delay(40);
  assert.equal(f.faux.state.callCount, 1);
  assert.equal(f.app.runtime.getRun(result.run.id).run.status, 'cancelled');
});

test('real Pi package fixture: close/reopen preserves pending durable execution; explicit retry reattaches same run/submission', async t => {
  const f = await fixture(t, [async (_ctx, options) => { await new Promise(resolve => options.signal.addEventListener('abort', resolve, { once: true })); return fauxAssistantMessage('', { stopReason: 'aborted' }); }]);
  const { result } = await chat(f);
  await until(() => f.app.runtime.getRun(result.run.id).run.piSubmissionId && f.faux.state.callCount === 1);
  const submissionId = f.app.runtime.getRun(result.run.id).run.piSubmissionId;
  await f.reopen();
  assert.equal(f.app.runtime.getRun(result.run.id).run.status, 'interrupted');
  await delay(40); assert.equal(f.faux.state.callCount, 1);
  f.faux.setResponses([fauxAssistantMessage('Resumed fixture answer')]);
  const resumed = await f.app.runtime.retryRun(result.run.id, { requestId: 'recover-pi-fixture' });
  assert.equal(resumed.recovered, true); assert.equal(resumed.run.id, result.run.id);
  await until(() => f.app.runtime.getRun(result.run.id).run.status !== 'running');
  const run = f.app.runtime.getRun(result.run.id).run;
  assert.equal(run.status, 'succeeded', JSON.stringify(run.error)); assert.equal(run.piSubmissionId, submissionId);
  assert.equal(f.app.runtime.bootstrap().messages.filter(value => value.role === 'user').length, 1);
});

test('real Pi package fixture: default boot is DSH-free, private storage shares original exclusive writer and Muse never falls back', async t => {
  const directory = await fs.mkdtemp('/tmp/workspace-pi-default-');
  const app = await createApp({ dataDirectory: directory });
  t.after(async () => { await app.close(); await fs.rm(directory, { recursive: true, force: true }); });
  const address = await app.listen(0);
  const base = `http://127.0.0.1:${address.port}`;
  assert.equal((await (await fetch(base + '/api/health')).json()).provider.kind, 'pi-durable');
  await assert.rejects(createApp({ dataDirectory: directory }), /already open|lock|writer|owned/i);
  const conversation = (await app.runtime.createConversation({})).conversation;
  const response = await fetch(`${base}/api/conversations/${conversation.id}/messages`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content: 'Muse must remain original', provider: 'muse' }) });
  assert.equal(response.status, 409); assert.equal((await response.json()).error.code, 'MW_NATIVE_CONVERSATION_REQUIRED');
  assert.equal(app.runtime.listRuns().runs.length, 0);
  assert.equal((await fs.stat(path.join(directory, 'pi'))).mode & 0o077, 0);
});
