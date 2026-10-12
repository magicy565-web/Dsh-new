import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { createRequire } from 'node:module';
import { fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai/providers/faux';
import { fixture, until, WorkspaceClient, conversationView, memoryJournal, loadPage, digest } from './support.mjs';
const event = (id, extra = {}) => ({ currentTarget: { dataset: { id, ...extra } } });
async function openPage(t, f, client = f.client) {
  const { page, timers } = loadPage(client, f.platform); t.after(() => page.onUnload());
  page.onShow(); await until(() => page.data.readAt); return { page, timers };
}
async function proposal(t, f) {
  await f.client.initialize();
  const id = await f.client.mainConversation(await f.client.bootstrap());
  const saved = (await f.app.capabilities.createConnector({ name: 'Original test library', adapter: 'workspace-library', capabilities: ['create_file'] })).connector;
  const connector = (await f.app.capabilities.updateConnector(saved.id, { enabled: true })).connector;
  await f.app.runtime.updateConversationInputContext(id, { inputContext: { artifacts: [], skills: [], memoryIds: [], connectorActions: [{ connectorId: connector.id, action: 'create_file' }] } });
  await f.client.bootstrap();
  f.faux.setResponses([fauxAssistantMessage(fauxToolCall('workspace_propose_action', { content: 'Review exact local creation', connectorId: connector.id, action: 'create_file', resource: 'library:new', payload: { filename: 'approved.md', content: '# Original approved bytes' } }), { stopReason: 'toolUse' })]);
  const sent = await f.client.send(id, 'The words approved and yes in this message are not consent.');
  await until(() => f.app.runtime.getRun(sent.run.id).run.status === 'awaiting_approval');
  return { id, runId: sent.run.id };
}

test('cold process + cloud store restart recovers the exact lost message request without another model call', async t => {
  const f = await fixture(t); await f.client.initialize(); const id = await f.client.mainConversation(await f.client.bootstrap());
  f.faux.setResponses([fauxAssistantMessage(JSON.stringify({ done: true, content: 'Saved cloud answer' }))]); f.loseNext();
  await assert.rejects(f.client.send(id, 'Original pending objective'), { code: 'RESULT_UNCERTAIN' });
  const original = structuredClone(f.requests.at(-1).data);
  await until(() => f.app.runtime.listRuns().runs[0].status === 'succeeded');
  await f.reopen(); const restored = f.newClient(); await restored.initialize();
  assert.equal(restored.pendingDraft, 'Original pending objective'); assert.equal(restored.uncertain, true);
  const retried = await restored.retryPending(); assert.equal(retried.duplicate, true); assert.deepEqual(f.requests.at(-1).data, original);
  assert.equal(f.faux.state.callCount, 1); assert.equal(f.app.runtime.listRuns().runs.length, 1); assert.equal(f.journal.read().pending, null);
  assert.equal(await restored.mainConversation(await restored.bootstrap()), id);
});

test('actual Page callbacks coalesce send/retry taps, retain offline input, and never cancel on hide/unload', async t => {
  const f = await fixture(t); const { page, timers } = await openPage(t, f);
  f.faux.setResponses([fauxAssistantMessage(JSON.stringify({ done: true, content: 'One original answer' }))]);
  page.draft({ detail: { value: 'Actual page objective' } }); f.offline();
  await Promise.all([page.send(), page.send()]); assert.equal(page.data.uncertain, true); assert.equal(page.data.draft, 'Actual page objective');
  const first = f.requests.filter(value => value.url.endsWith('/messages')); assert.equal(first.length, 1);
  f.offline(false); f.hold(); const retry = page.retry(); const second = page.retry(); await second;
  assert.equal(f.requests.filter(value => value.url.endsWith('/messages')).length, 2); f.release(); await retry;
  await until(() => f.app.runtime.listRuns().runs[0]?.status === 'succeeded');
  page.onHide(); assert.equal(timers.size, 0); assert.ok(!f.requests.some(value => value.url.endsWith('/cancel')));
  page.onShow(); await until(() => page.data.messages.some(value => value.content === 'One original answer'));
  assert.equal(f.faux.state.callCount, 1); assert.equal(page.data.draft, ''); page.onUnload();
});

test('exact approval survives lost response; retry reads original proposal; execution continuation reuses one requestId', async t => {
  const f = await fixture(t); const { id, runId } = await proposal(t, f);
  const approval = conversationView(await f.client.bootstrap(), id).cards.find(card => card.operation === 'approve');
  assert.ok(approval.detail.includes('approved.md')); assert.ok(approval.detail.includes('审批'));
  f.loseNext(); await assert.rejects(f.client.action(approval, true, id), { code: 'RESULT_UNCERTAIN' });
  assert.equal(f.app.artifacts.list().artifacts.length, 0); assert.equal(f.faux.state.callCount, 1);
  const cold = f.newClient(); await cold.initialize(); const before = f.requests.filter(value => value.url.endsWith('/action-decision')).length;
  assert.equal((await cold.retryPending()).reconciled, true); assert.equal(f.requests.filter(value => value.url.endsWith('/action-decision')).length, before);
  const resume = conversationView(await cold.bootstrap(), id).cards.find(card => card.operation === 'resume');
  await assert.rejects(cold.action({ ...resume, proposalId: undefined }, true, id), { code: 'INVALID_ACTION' });
  f.faux.setResponses([fauxAssistantMessage(JSON.stringify({ done: true, content: 'Adapter executed after explicit continuation' }))]); f.loseNext();
  await assert.rejects(cold.action(resume, true, id), { code: 'RESULT_UNCERTAIN' }); const original = structuredClone(f.requests.at(-1).data);
  await until(() => f.app.runtime.getRun(runId).run.status === 'succeeded'); const coldAgain = f.newClient(); await coldAgain.initialize();
  const result = await coldAgain.retryPending(); assert.equal(result.duplicate, true); assert.deepEqual(f.requests.at(-1).data, original);
  assert.equal(f.app.capabilities.listConnectorRuns().length, 1); assert.equal(f.faux.state.callCount, 2);
});

test('actual Page rejection targets the exact proposal and never executes the original connector', async t => {
  const f = await fixture(t); const { runId } = await proposal(t, f); const { page } = await openPage(t, f);
  const card = page.data.cards.find(card => card.operation === 'approve'); await page.card(event(card.id));
  assert.equal(page.data.reviewCard.proposalId, card.proposalId);
  await Promise.all([page.confirmCard(event(null, { decision: 'deny' })), page.confirmCard(event(null, { decision: 'deny' }))]);
  const run = f.app.runtime.getRun(runId).run; assert.equal(run.proposals[0].status, 'denied'); assert.equal(run.error.code, 'ACTION_DENIED');
  const decisions = f.requests.filter(value => value.url.endsWith('/action-decision')); assert.equal(decisions.length, 1); assert.equal(decisions[0].data.decision, 'denied');
  assert.equal(f.app.capabilities.listConnectorRuns().length, 0); assert.equal(f.app.artifacts.list().artifacts.length, 0); assert.equal(f.faux.state.callCount, 1);
});

test('actual Page full review preserves payload beyond old 3000-character modal limit', async t => {
  const f = await fixture(t); const { page } = await openPage(t, f);
  const detail = 'x'.repeat(7000) + ' EXACT TAIL'; page.setData({ cards: [{ id: 'long', operation: 'approve', kind: 'approval', detail, title: 'Long exact scope', runId: 'run', proposalId: 'proposal' }] });
  await page.card(event('long')); assert.equal(page.data.reviewCard.detail, detail); assert.ok(page.data.reviewCard.detail.endsWith('EXACT TAIL'));
  page.closeReview(); assert.equal(page.data.reviewCard, null); assert.ok(!f.requests.some(value => value.url.endsWith('/action-decision')));
});

test('image/PDF upload loss retries original bytes without extraction; actual file preview requires SHA match', async t => {
  const f = await fixture(t); const { page } = await openPage(t, f);
  const bytes = Buffer.from('%PDF-1.7\nfixture only, not a real document'); const path = `${f.directory}/source.pdf`; await fs.writeFile(path, bytes);
  f.loseNext(); await assert.rejects(page.attach('product.pdf', path, bytes.length), { code: 'RESULT_UNCERTAIN' });
  const original = structuredClone(f.requests.at(-1).data); const cold = f.newClient(); const { page: restored } = await openPage(t, f, cold);
  await Promise.all([restored.retry(), restored.retry()]); assert.deepEqual(f.requests.filter(value => value.url.endsWith('/artifacts')).at(-1).data, original);
  assert.equal(f.app.artifacts.list().artifacts.length, 1); assert.equal(restored.data.files[0].sha256, digest(bytes));
  const file = restored.data.files[0]; restored.setData({ cards: [{ id: 'file', kind: 'file', title: file.filename, detail: '', file }] });
  f.corrupt(); await restored.card(event('file')); assert.match(restored.data.error, /不一致/); assert.equal(f.previews.length, 0);
  f.corrupt(false); await restored.card(event('file')); assert.equal(f.previews[0].type, 'pdf');
  f.faux.setResponses([ctx => { assert.ok(!JSON.stringify(ctx).includes(bytes.toString())); return fauxAssistantMessage(JSON.stringify({ done: true, content: 'Text description only' })); }]);
  restored.setData({ draft: 'Text explanation of the product PDF' }); await restored.send(); await until(() => f.app.runtime.listRuns().runs[0]?.status === 'succeeded');
  assert.equal(f.requests.filter(value => value.url.endsWith('/messages')).at(-1).data.inputContext.artifacts.length, 0);
});

test('journal is bound to confirmed enterprise subject, never stores login/session/CSRF; expired sessions fail closed', async () => {
  const journal = memoryJournal(); let subject = 'original-owner', expired = false, codes = 0;
  const session = () => ({ authenticated: !expired, user: expired ? null : { id: subject, role: 'operator' }, csrfToken: 'secret-csrf', expiresAt: '2030-01-01', mode: 'enterprise' });
  const platform = { login(options) { codes++; options.success({ code: 'one-time-private-code' }); }, request(options) {
    if (options.url.endsWith('/session')) options.success({ statusCode: 200, data: session() });
    else if (expired) options.success({ statusCode: 401, data: { error: { code: 'LOGIN_REQUIRED' } } });
    else options.fail({ errMsg: 'response lost' });
  } };
  const options = { baseUrl: 'https://workspace.example', journal, loginBroker: async () => ({ session: session(), token: 'A'.repeat(43) }) };
  const client = new WorkspaceClient(platform, options); await Promise.all([client.login(), client.login()]); assert.equal(codes, 1);
  await assert.rejects(client.send('original-conversation', 'Preserve my exact objective'), { code: 'RESULT_UNCERTAIN' });
  const serialized = JSON.stringify(journal.read()); for (const secret of ['secret-csrf', 'one-time-private-code', 'A'.repeat(43)]) assert.ok(!serialized.includes(secret));
  subject = 'another-owner'; const other = new WorkspaceClient(platform, options); await other.login(); assert.equal(other.uncertain, false);
  journal.write({ version: 1, owner: subject, baseUrl: options.baseUrl, conversationId: 'another-conversation', pending: null });
  subject = 'original-owner'; const owner = new WorkspaceClient(platform, options); await owner.login(); assert.equal(owner.uncertain, true);
  expired = true; await assert.rejects(owner.retryPending(), { status: 401 }); assert.equal(owner.session, null); assert.equal(owner.uncertain, true);
});

test('write-ahead journal failure stops mutation; unknown create is not replayed without a backend idempotency contract', async () => {
  const requests = [];
  const session = { authenticated: true, user: { id: 'owner', role: 'operator' }, csrfToken: null, expiresAt: null, mode: 'enterprise' };
  const platform = { request(options) { requests.push(options); if (options.url.endsWith('/session')) options.success({ statusCode: 200, data: session }); else options.fail({ errMsg: 'unknown acknowledgment' }); } };
  const blocked = new WorkspaceClient(platform, { baseUrl: 'https://workspace.example', journal: { read: () => null, write() { throw new Error('disk unavailable'); } } });
  await blocked.initialize(); await assert.rejects(blocked.send('original', 'No unsafe send'), /disk unavailable/); assert.equal(requests.length, 1);
  const client = new WorkspaceClient(platform, { baseUrl: 'https://workspace.example', journal: memoryJournal() }); await client.initialize();
  await assert.rejects(client.mainConversation({ conversations: [] }), { code: 'RESULT_UNCERTAIN' }); const count = requests.length;
  await assert.rejects(client.retryPending(), { code: 'CONVERSATION_RECONCILIATION_REQUIRED' }); assert.equal(requests.length, count);
  assert.equal(await client.mainConversation({ conversations: [{ id: 'cloud-created', title: '主会话' }] }), 'cloud-created'); assert.equal(client.uncertain, false);
});

test('Muse stop states and accepted files retain exact scope; refresh can run again and never claims execution', async () => {
  const sha = 'a'.repeat(64), snapshot = { conversations: [], messages: [], runs: [], artifacts: [] };
  const item = { conversationId: 'original', orderId: 'order', reviewHash: sha, review: { product: 'Public fixture', market: 'US', objective: 'Scope', budgetCredits: 5 }, receiptHash: sha, returnedHash: sha, receipt: { files: [{ id: 'file', version: 1, sha256: sha, filename: 'result.md' }] } };
  const stopping = conversationView(snapshot, 'original', [{ ...item, phase: 'cancel_requested' }]); assert.ok(stopping.cards.some(card => card.title.includes('等待停止确认'))); assert.ok(!stopping.cards.some(card => card.operation === 'cancel'));
  const stopped = conversationView(snapshot, 'original', [{ ...item, phase: 'cancelled' }]); assert.ok(stopped.cards.every(card => !card.operation));
  const accepted = conversationView(snapshot, 'original', [{ ...item, phase: 'enterprise_accepted' }]); assert.equal(accepted.cards.find(card => card.file).file.sha256, sha);
  const requests = [], client = new WorkspaceClient({ request(options) { requests.push(options); options.success({ statusCode: 200, data: {} }); } }, { baseUrl: 'https://workspace.example' });
  const refresh = conversationView(snapshot, 'original', [{ ...item, phase: 'queued' }]).cards.find(card => card.operation === 'refresh');
  await Promise.all([client.action(refresh, true, 'original'), client.action(refresh, true, 'original')]); assert.equal(requests.length, 1);
  await client.action(refresh, true, 'original'); assert.equal(requests.length, 2);
  await assert.rejects(client.action(refresh, true, 'another'), { code: 'INVALID_ACTION' });
});

test('actual Page ignores delayed reads after unload and clears old account content on expired session', async t => {
  const f = await fixture(t); const { page } = await openPage(t, f);
  f.hold(); const refresh = page.refresh(); page.onUnload(); const before = JSON.stringify(page.data); f.release(); await refresh; assert.equal(JSON.stringify(page.data), before);
  const client = new WorkspaceClient({ request(options) { options.success({ statusCode: 200, data: { authenticated: false, user: null, mode: 'enterprise' } }); } }, { baseUrl: 'https://workspace.example' });
  const { page: expired } = loadPage(client, f.platform); t.after(() => expired.onUnload()); expired.setData({ subject: 'old-owner', messages: [{ content: 'private old text' }], cards: [{ id: 'old' }], files: [{ id: 'private' }] });
  expired.onShow(); await until(() => !expired.data.subject); assert.equal(expired.data.authenticated, false); assert.equal(expired.data.messages.length, 0); assert.equal(expired.data.files.length, 0);
});

test('real file journal preserves original request and fails closed for corrupt saved JSON', async t => {
  const require = createRequire(import.meta.url); const { fileJournal } = require('../../release/miniprogram/shared/journal.js');
  const directory = await fs.mkdtemp('/tmp/wechat-file-journal-'); t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const fsSync = require('node:fs'); const journal = fileJournal({ env: { USER_DATA_PATH: directory }, getFileSystemManager: () => ({ ...fsSync, mkdirSync: (path, recursive) => fsSync.mkdirSync(path, { recursive }) }) });
  assert.equal(journal.read(), null); const value = { version: 1, owner: 'owner', baseUrl: 'https://workspace.example', conversationId: 'original', pending: { kind: 'send', key: 'same', path: '/messages', body: { requestId: 'same' } } };
  journal.write(value); assert.deepEqual(journal.read(value.owner, value.baseUrl), value);
  const namespace = encodeURIComponent(JSON.stringify([value.baseUrl, value.owner])).match(/.{1,80}/g).join('/');
  await fs.writeFile(`${directory}/workspace-recovery/${namespace}/checkpoint.json`, '{corrupt'); assert.throws(() => journal.read(value.owner, value.baseUrl), /无法读取/);
});

test('compiled shipped App boots with empty service and cannot obtain a code or send any request', async t => {
  const require = createRequire(import.meta.url), fsSync = require('node:fs');
  const file = require.resolve('../../release/miniprogram/app.js');
  const previousApp = globalThis.App, previousWx = globalThis.wx;
  let application; const calls = [];
  globalThis.wx = { env: { USER_DATA_PATH: '/tmp/wechat-default-never-written' }, getFileSystemManager: () => fsSync, request() { calls.push('request'); }, login() { calls.push('login'); } };
  globalThis.App = value => { application = value; };
  delete require.cache[file]; require(file);
  t.after(() => { globalThis.App = previousApp; globalThis.wx = previousWx; delete require.cache[file]; });
  await assert.rejects(application.globalData.client.initialize(), { code: 'SERVICE_SETUP_REQUIRED' });
  await assert.rejects(application.globalData.client.login(), { code: 'LOGIN_INTEGRATION_REQUIRED' });
  assert.deepEqual(calls, []);
});

test('malformed local recovery record remains blocked on every initialization attempt', async () => {
  let posts = 0;
  const client = new WorkspaceClient({ request(options) { if (options.method === 'POST') posts++; options.success({ statusCode: 200, data: { authenticated: true, user: { id: 'owner', role: 'operator' }, mode: 'enterprise' } }); } }, { baseUrl: 'https://workspace.example', journal: { read: () => ({ version: 9, owner: 'owner', baseUrl: 'https://workspace.example' }), write() {} } });
  for (let i = 0; i < 2; i++) await assert.rejects(client.initialize(), { code: 'RECOVERY_RECORD_INVALID' });
  assert.equal(posts, 0);
});

test('actual Page explicit cancel aborts the original durable run; lost stop response reuses original run after cold restart', async t => {
  const f = await fixture(t); const { page } = await openPage(t, f);
  f.faux.setResponses([async (_ctx, options) => { await new Promise(resolve => options.signal.addEventListener('abort', resolve, { once: true })); return fauxAssistantMessage('', { stopReason: 'aborted' }); }]);
  page.draft({ detail: { value: 'Cancellation protocol fixture only' } }); await page.send(); await until(() => f.faux.state.callCount === 1); await page.refresh();
  const runId = f.app.runtime.listRuns().runs[0].id, card = page.data.cards.find(card => card.runId === runId && card.operation === 'cancel');
  await page.card(event(card.id)); f.loseNext(); await page.confirmCard(event(null, { decision: 'confirm' }));
  assert.equal(page.data.uncertain, true); await until(() => f.app.runtime.getRun(runId).run.status === 'cancelled');
  page.onUnload(); await f.reopen(); const cold = f.newClient(); const { page: restored } = await openPage(t, f, cold);
  assert.equal(cold.pendingKind, 'action'); await restored.retry();
  assert.equal(f.app.runtime.listRuns().runs.length, 1); assert.equal(f.app.runtime.getRun(runId).run.status, 'cancelled'); assert.equal(f.faux.state.callCount, 1);
  assert.ok(restored.data.cards.some(card => card.title === '任务已取消')); assert.equal(restored.data.busy, false);
});

test('actual Page explicit interrupted recovery retries one original requestId and retains cloud run/submission', async t => {
  const f = await fixture(t); const { page } = await openPage(t, f);
  f.faux.setResponses([async (_ctx, options) => { await new Promise(resolve => options.signal.addEventListener('abort', resolve, { once: true })); return fauxAssistantMessage('', { stopReason: 'aborted' }); }]);
  page.draft({ detail: { value: 'Recovery protocol fixture only' } }); await page.send(); await until(() => f.app.runtime.listRuns().runs[0]?.piSubmissionId);
  const runId = f.app.runtime.listRuns().runs[0].id, submissionId = f.app.runtime.getRun(runId).run.piSubmissionId;
  page.onUnload(); await f.reopen(); assert.equal(f.app.runtime.getRun(runId).run.status, 'interrupted');
  const cold = f.newClient(); const { page: restored } = await openPage(t, f, cold); const count = f.faux.state.callCount;
  assert.equal(f.faux.state.callCount, count); const recovery = restored.data.cards.find(card => card.operation === 'recover'); assert.ok(recovery);
  f.faux.setResponses([fauxAssistantMessage(JSON.stringify({ done: true, content: 'Same submission recovered' }))]);
  await restored.card(event(recovery.id)); f.loseNext(); await restored.confirmCard(event(null, { decision: 'confirm' }));
  const original = structuredClone(f.requests.filter(value => value.url.endsWith('/retry')).at(-1).data);
  await until(() => f.app.runtime.getRun(runId).run.status === 'succeeded'); await restored.retry();
  assert.deepEqual(f.requests.filter(value => value.url.endsWith('/retry')).at(-1).data, original); assert.equal(f.app.runtime.listRuns().runs.length, 1); assert.equal(f.app.runtime.getRun(runId).run.piSubmissionId, submissionId);
});
