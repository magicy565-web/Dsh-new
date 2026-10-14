import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorkspaceClient } from '../packages/workspace-procurement/src/workspace.mjs';
import { createWorkspaceOmpEngineAdapter, workspaceOmpPaths } from '../server/workspace-omp-bridge.mjs';
import { taskFixture, TOKEN_A } from './fixtures/pi-task-helpers.mjs';
import { request } from './agent-service.helpers.mjs';
import fs from 'node:fs/promises';
const paths = workspaceOmpPaths({});
const model = { provider: 'workspace-omp-native-review-fixture', id: 'finite', api: 'openai-completions', baseUrl: 'https://synthetic.invalid' };
const configuration = { providerId: model.provider, model: model.id, baseUrl: model.baseUrl };
const tool = 'workspace_factory_public_review';
async function until(check) { for (let i = 0; i < 500; i++) { if (check()) return; await new Promise(resolve => setTimeout(resolve, 25)); } throw new Error('Native public child lifecycle did not reach its expected receipt.'); }
async function fixture(t, responses, lifecycle = []) {
  let f;
  f = await taskFixture(t, { businessAgentOptions: { recipient: { kind: 'pi-coding-agent', provider: model.provider, model: model.id, destination: model.baseUrl },
    engineAdapter: createWorkspaceOmpEngineAdapter({ paths, configuration, syntheticResponses: responses, publicTools: { searchProvider: 'disabled' }, onWorkerLifecycle: event => lifecycle.push(event) }),
    resolveBinding: async () => ({ client: createWorkspaceClient({ baseURL: f.baseURL, token: TOKEN_A }), model }) } });
  const created = await request(f.baseURL, '/api/conversations', { method: 'POST', body: { title: 'Public native factory review', requestId: 'omp-native-review-conversation' } });
  assert.equal(created.status, 201, created.text);
  const id = created.json.conversation.id;
  const sent = await request(f.baseURL, `/api/conversations/${id}/messages`, { method: 'POST', body: { content: 'Review only public ALPHA and BETA factory text; capacity stays UNKNOWN.', requestId: 'omp-native-review-run' } });
  assert.equal(sent.status, 202, sent.text); return { ...f, id, runId: sent.json.run.id };
}
async function finished(f) {
  for (let attempt = 0; attempt < 500; attempt++) { const run = f.app.store.read().runs.find(row => row.id === f.runId);
    if (run && !['queued', 'running'].includes(run.status)) return run; await new Promise(resolve => setTimeout(resolve, 25)); }
  throw new Error('Original native public review Run did not settle.');
}
test('controlled original Run executes two official TaskTool child AgentSessions without tools, using the same four-call budget', { timeout: 90000 }, async t => {
  const f = await fixture(t, [{ tool, arguments: { context: 'Public synthetic product text; capacity UNKNOWN.', tasks: [
    { name: 'ALPHA', task: 'Summarize publicly submitted ALPHA product text.' }, { name: 'BETA', task: 'Summarize publicly submitted BETA product text.' }] } },
  { text: 'ALPHA_PUBLIC_TEXT_REVIEWED; capacity UNKNOWN.', expectedToolNames: [] },
  { text: 'BETA_PUBLIC_TEXT_REVIEWED; capacity UNKNOWN.', expectedToolNames: [] },
  { text: 'NATIVE_CHILD_PUBLIC_REVIEWS_RECEIVED; human verification remains pending.', expectedContextText: 'ALPHA_PUBLIC_TEXT_REVIEWED' }]);
  const run = await finished(f);
  assert.equal(run.status, 'succeeded', JSON.stringify(run));
  assert.equal(run.events.filter(event => event.type === 'pi.agent-session.request').length, 4);
  assert.equal(run.usage.completionTokens, 4); assert.equal(run.usage.promptTokens, 4); assert.equal(run.usage.totalTokens, 8);
  assert.equal(run.budget.maxOutputTokens, 1600); assert.equal(f.app.store.read().runs.length, 1); assert.equal(f.app.store.read().workspaceAgentTasks.tasks.length, 0);
  assert.equal(f.faux.state.callCount, 0);
  const receipt = await request(f.baseURL, `/api/conversations/${f.id}/terminal-status?runId=${f.runId}`);
  assert.equal(receipt.status, 200, receipt.text); assert.match(receipt.json.reply.content, /NATIVE_CHILD_PUBLIC_REVIEWS_RECEIVED/);
  const mapping = f.app.store.read().conversations.find(row => row.id === f.id).businessAgentSession;
  const entries = (await fs.readFile(mapping.sessionFile, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  const returned = entries.find(entry => entry.message?.role === 'toolResult' && entry.message.toolName === tool);
  assert.match(JSON.stringify(returned.message.content), /ALPHA_PUBLIC_TEXT_REVIEWED/);
  assert.match(JSON.stringify(returned.message.content), /BETA_PUBLIC_TEXT_REVIEWED/);
});
test('original frontend stop aborts a real native public TaskTool child and closes its hosting Bun worker', { timeout: 90000 }, async t => {
  const lifecycle = [];
  const f = await fixture(t, [{ tool, arguments: { context: 'Only supplied public synthetic cancellation text.', tasks: [{ name: 'cancel', task: 'Public synthetic child cancellation check.' }] } },
    { wait: 60000, text: 'This native child must be cancelled.', expectedToolNames: [] }], lifecycle);
  try { await until(() => lifecycle.some(event => event.phase === 'nativeModelWaiting')); }
  catch (error) { const run = f.app.store.read().runs.find(row => row.id === f.runId); t.diagnostic(JSON.stringify({ lifecycle, status: run.status, events: run.events, error: run.error })); throw error; }
  const stopped = await request(f.baseURL, `/api/conversations/${f.id}/cancel`, { method: 'POST', body: {} }); assert.equal(stopped.status, 200);
  assert.equal((await finished(f)).status, 'cancelled'); await until(() => lifecycle.some(event => event.phase === 'exit'));
  assert.ok(lifecycle.some(event => event.phase === 'nativeModelAbort'), JSON.stringify(lifecycle));
  assert.throws(() => process.kill(lifecycle.find(event => event.phase === 'spawn').pid, 0), error => error.code === 'ESRCH');
  assert.equal(f.app.store.read().runs.length, 1); assert.equal(f.app.store.read().workspaceAgentTasks.tasks.length, 0);
});
test('native public review cannot broaden child tools or model even when extra arguments are stripped by the official schema', { timeout: 90000 }, async t => {
  const f = await fixture(t, [{ tool, arguments: { context: 'Explicit public text only.', tasks: [{ name: 'forbidden', task: 'Public text', agent: 'factory-text-review', tools: ['read'], model: 'another-provider/private' }] } },
    { text: 'Child retained no tools and the pinned original model.', expectedToolNames: [] },
    { text: 'Extra arguments did not grant private capabilities.' }]);
  const run = await finished(f); assert.equal(run.status, 'succeeded', JSON.stringify(run));
  assert.equal(run.events.filter(event => event.type === 'pi.agent-session.request').length, 3);
  assert.equal(f.app.store.read().runs.length, 1); assert.equal(f.app.store.read().workspaceAgentTasks.tasks.length, 0);
});
test('native public review rejects a foreign child agent and a third child before their model requests', { timeout: 90000 }, async t => {
  const cases = [
    [{ name: 'foreign', task: 'Public text', agent: 'task' }],
    ['ALPHA', 'BETA', 'THIRD'].map(name => ({ name, task: 'Public text' })),
  ];
  for (const tasks of cases) {
    const f = await fixture(t, [{ tool, arguments: { context: 'Explicit public text only.', tasks } }, { text: 'The original public child scope refused this request.' }]);
    const run = await finished(f); assert.equal(run.status, 'succeeded', JSON.stringify(run));
    assert.equal(run.events.filter(event => event.type === 'pi.agent-session.request').length, 2);
    assert.equal(f.app.store.read().runs.length, 1); assert.equal(f.app.store.read().workspaceAgentTasks.tasks.length, 0);
  }
});
