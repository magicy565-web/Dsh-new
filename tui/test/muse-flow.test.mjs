import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createHash, generateKeyPairSync } from 'node:crypto';
import http from 'node:http';
import { Readable } from 'node:stream';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { openStore } from '../../server/store.mjs';
import { createApp } from '../../server/index.mjs';
import { signWorkspaceRequest } from '../../server/auth-ingress.mjs';
import { registerWorkspaceMuse } from '../extensions/workspace-muse.mjs';
import { createWorkspaceClient, loadOwnerTransport } from '../workspace-client.mjs';
import { createRequestJournal } from '../request-journal.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const actor = { subject: 'tui-owner', nativeAgentId: 'original:tui/conversation' };
const workerId = 'cf4a108c-8051-48bb-9bd2-b8e5a10a1db1';
const bearer = 'disposable-offline-muse-protocol-fixture';
const origin = 'https://workspace.test';
const transportFetch = (url, options) => new Promise((resolve, reject) => {
  const req = http.request(url, options, res => resolve(new Response(Readable.toWeb(res), { status: res.statusCode, headers: res.headers })));
  req.on('error', reject); req.end(options.body);
});

async function fixture(t) {
  const directory = await mkdtemp('/tmp/workspace-tui-fixture-');
  const original = await openStore(directory);
  await original.update(state => state.conversations.push({ id: actor.nativeAgentId, ...actor, title: 'Synthetic original owner', status: 'idle', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }));
  await original.close();
  const pair = generateKeyPairSync('ed25519'); // Synthetic original ingress only.
  const access = { mode: 'enterprise', workspaceId: 'tui-fixture-workspace', publicOrigin: origin, issuer: 'fixture-ingress', keyId: 'fixture-key',
    publicKey: pair.publicKey.export({ type: 'spki', format: 'pem' }), members: [{ subject: actor.subject, role: 'admin' }, { subject: 'other-owner', role: 'admin' }, { subject: 'viewer', role: 'viewer' }] };
  const options = { dataDirectory: directory, access,
    provider: { kind: 'fixture', configured: false, complete() { assert.fail('No model execution'); } },
    museWorkerConfig: { workerId, ownerId: 'synthetic-muse-owner', tokenDigest: hash(bearer), enabled: true, scopeReviewed: true, externalBudgetVerified: true },
    museOriginalBinding: { actor, operators: [actor], expectedHost: 'workspace.test' } };
  let app = await createApp(options), address = await app.listen(0), session;
  const api = async (target, { method = 'GET', body, subject = actor.subject, workspaceId = access.workspaceId, worker = false, cookie = session?.cookie, csrf = session?.csrf, unsigned = false } = {}) => {
    const bytes = body === undefined ? '' : JSON.stringify(body);
    const headers = { Host: 'workspace.test', ...(worker ? {} : { Origin: origin }), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(worker ? { Authorization: `Bearer ${bearer}` } : { ...(cookie ? { Cookie: cookie, 'X-CSRF-Token': csrf } : {}),
        ...(unsigned ? {} : { 'X-Workspace-Assertion': signWorkspaceRequest({ privateKey: pair.privateKey, ...access, workspaceId, subject, method, target, body: bytes }) }) }),
      ...(target === '/api/session/login' ? { 'X-Workspace-Login': '1' } : {}) };
    const response = await transportFetch(`http://127.0.0.1:${address.port}${target}`, { method, headers, body: bytes || undefined });
    return { status: response.status, body: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0] };
  };
  async function login(subject = actor.subject) {
    const result = await api('/api/session/login', { method: 'POST', body: {}, subject, cookie: null });
    assert.equal(result.status, 200, JSON.stringify(result.body));
    session = { cookie: result.cookie, csrf: result.body.csrfToken }; return session;
  }
  await login();
  t.after(async () => { await app.close(); await rm(directory, { recursive: true, force: true }); });
  return { directory, api, login, get app() { return app; }, get port() { return address.port; },
    request: ({ method, path: target, body }) => api(target, { method, body }),
    async restart() { await app.close(); app = await createApp(options); address = await app.listen(0); await login(); } };
}

function tui(request, journal, { confirm = true, inputs = [] } = {}) {
  const commands = new Map(), events = new Map(), messages = [], confirmations = [];
  registerWorkspaceMuse({ registerCommand: (name, def) => commands.set(name, def), on: (name, fn) => events.set(name, fn) }, { transport: async () => request, journal });
  const ctx = { mode: 'tui', hasUI: true, ui: {
    input: async () => inputs.shift(), notify: (message, level) => messages.push({ message, level }), setStatus() {},
    confirm: async (title, message) => { confirmations.push({ title, message }); return confirm; },
  } };
  return { commands, events, ctx, messages, confirmations,
    run: args => commands.get('workspace-muse').handler(args, ctx),
    result: () => JSON.parse(messages.at(-1).message), error: () => messages.at(-1).message };
}

test('TUI command → signed owner HTTP → original Muse claim/upload/submit → same Session result; cold recovery preserves request and task', async t => {
  const f = await fixture(t), journalRoot = path.join(f.directory, 'client-journal');
  let losePrepare = true;
  const request = async input => {
    const response = await f.request(input);
    if (losePrepare && input.method === 'POST' && input.path.endsWith('/muse-delegations')) { losePrepare = false; throw new Error('simulated lost acknowledgement'); }
    return response;
  };
  let ui = tui(request, createRequestJournal(journalRoot), { inputs: ['channel-validation', 'Public fixture product', 'US', 'Local protocol test, no real Muse execution', '5', new Date(Date.now() + 86400000).toISOString()] });
  await ui.run('connect'); assert.equal(ui.result().conversationId, actor.nativeAgentId);
  await ui.run('new'); assert.equal(ui.error(), 'RESULT_UNKNOWN_READ_OR_RETRY_SAME_REQUEST');
  assert.equal(f.app.store.read().workerOrders.length, 1);
  const originalId = f.app.store.read().workerOrders[0].id;
  await f.restart();
  ui = tui(request, createRequestJournal(journalRoot));
  await ui.run('retry'); assert.equal(ui.result().delegation.orderId, originalId); assert.equal(ui.result().duplicate, true);
  assert.equal(f.app.store.read().workerOrders.length, 1);
  await ui.run(`dispatch ${originalId}`); assert.equal(ui.error(), 'MW_CONVERSATION_APPROVAL_REQUIRED');
  await ui.run(`approve ${originalId}`); assert.equal(ui.result().delegation.phase, 'approved');
  await ui.run(`dispatch ${originalId}`); assert.equal(ui.result().delegation.phase, 'queued');
  const reviewHash = ui.result().delegation.reviewHash;
  await ui.run(`dispatch ${originalId}`); assert.equal(ui.result().duplicate, true);
  const inbox = await f.api('/api/muse-worker/v1/inbox', { worker: true });
  assert.equal(inbox.status, 200, JSON.stringify(inbox.body)); assert.match(JSON.stringify(inbox.body), new RegExp(originalId));
  const claim = await f.api(`/api/muse-worker/v1/tasks/${originalId}/claim`, { worker: true, method: 'POST', body: { requestId: 'tui-fixture-claim' } });
  assert.equal(claim.status, 200, JSON.stringify(claim.body));
  const attempt = { attemptId: claim.body.attemptId, fence: claim.body.fence };
  await ui.run(`status ${originalId}`); assert.equal(ui.result().delegation.phase, 'claimed');
  assert.equal(ui.result().delegation.attemptId, attempt.attemptId);
  const bytes = Buffer.from(JSON.stringify({ schema: 'workspace.worker.delivery.v1', orderId: originalId, deliverables: [{ name: 'Fixture report', type: 'report', summary: 'Offline protocol evidence' }], evidence: [{ title: 'Fixture source', url: 'https://www.loc.gov/about/', detail: 'Protocol only' }] }));
  const upload = await f.api(`/api/muse-worker/v1/tasks/${originalId}/upload-file`, { worker: true, method: 'POST', body: { ...attempt, uploadId: 'tui-fixture-upload', filename: 'result.json', base64: bytes.toString('base64'), sha256: hash(bytes) } });
  assert.equal(upload.status, 201, JSON.stringify(upload.body));
  const submit = await f.api(`/api/muse-worker/v1/tasks/${originalId}/submit-result`, { worker: true, method: 'POST', body: { ...attempt, requestId: 'tui-fixture-submit', summary: 'Synthetic Muse fixture result', sources: ['https://www.loc.gov/about/'], toolEvidence: [], evidenceNote: 'Offline fixture; no real Muse executed.' } });
  assert.equal(submit.status, 200, JSON.stringify(submit.body));
  await ui.run(`refresh ${originalId}`);
  const returned = ui.result().delegation;
  assert.equal(returned.phase, 'result_returned'); assert.equal(returned.reviewHash, reviewHash);
  assert.equal(returned.returnedHash, returned.receiptHash); assert.equal(returned.wake.observed, false);
  assert.equal(returned.receipt.files[0].sha256, hash(bytes));
  await f.restart(); ui = tui(request, createRequestJournal(journalRoot));
  await ui.run('list'); assert.equal(ui.result().delegations.length, 1);
  await ui.run(`status ${originalId}`); assert.equal(ui.result().delegation.receiptHash, returned.receiptHash);
  await ui.run(`accept ${originalId}`); assert.equal(ui.result().delegation.phase, 'enterprise_accepted');
  assert.equal(f.app.store.read().runs.length, 0); assert.equal(f.app.store.read().museTasks.length, 1);
});

test('TUI rejects missing owner, worker token, wrong tenant, other owner, revoked session and declined approval', async t => {
  const f = await fixture(t);
  const client = createWorkspaceClient(f.request);
  await client.connect();
  const scope = await client.connect();
  const pending = { scope, input: { provider: 'muse', conversationId: scope.conversationId, requestId: 'tui-denial-test', content: 'Fixture scope', order: { serviceId: 'channel-validation', product: 'Public fixture', market: 'US', objective: 'Fixture only', budgetCredits: 5, deadlineAt: new Date(Date.now() + 86400000).toISOString(), publicDataConfirmed: true } } };
  const made = await client.prepare(pending), id = made.delegation.orderId;
  for (const scope of [{ ...pending.scope, workspaceId: 'other-workspace' }, { ...pending.scope, subject: 'other-owner' }, { ...pending.scope, conversationId: 'other-conversation' }]) {
    await assert.rejects(client.prepare({ ...pending, scope }), { code: 'OWNER_SCOPE_CHANGED' });
  }
  const denied = tui(f.request, createRequestJournal(path.join(f.directory, 'journal')), { confirm: false });
  await denied.run(`approve ${id}`); await denied.run(`dispatch ${id}`);
  assert.equal((await client.get(id)).delegation.phase, 'review_required');
  assert.equal((f.app.store.read().museTasks || []).length, 0);
  const target = `/api/conversations/${encodeURIComponent(actor.nativeAgentId)}/muse-delegations/${id}/approve`;
  const body = { confirmed: true, expectedReviewHash: made.delegation.reviewHash };
  assert.equal((await f.api(target, { method: 'POST', body, worker: true })).status, 403);
  assert.equal((await f.api(target.replace('/approve', ''), { worker: true })).status, 401);
  assert.equal((await f.api(target, { method: 'POST', body, workspaceId: 'wrong-tenant' })).status, 401);
  assert.equal((await f.api(target, { method: 'POST', body, csrf: 'wrong' })).status, 403);
  assert.equal((await f.api(target, { method: 'POST', body: { ...body, expectedReviewHash: '0'.repeat(64) } })).status, 409);
  await f.login('other-owner');
  const other = createWorkspaceClient(input => f.api(input.path, { ...input, subject: 'other-owner' }));
  await assert.rejects(other.connect(), { code: 'MW_ORIGINAL_BINDING_REQUIRED' });
  assert.equal((await f.api(target, { method: 'POST', body, subject: 'other-owner' })).status, 403);
  await f.login('viewer');
  await assert.rejects(createWorkspaceClient(input => f.api(input.path, { ...input, subject: 'viewer' })).connect(), { code: 'EXISTING_OWNER_SESSION_REQUIRED' });
  await f.login();
  await f.api('/api/session/logout', { method: 'POST', body: {} });
  await assert.rejects(client.list(), { code: 'EXISTING_OWNER_SESSION_REQUIRED' });
  assert.equal(f.app.store.read().workerOrders[0].status, 'draft');
});

test('focused TUI cannot approve through noninteractive/model input; transport defaults closed and rejects remote local-mode URLs', async () => {
  await assert.rejects(loadOwnerTransport({}), { code: 'EXISTING_OWNER_TRANSPORT_REQUIRED' });
  for (const url of ['https://127.0.0.1', 'http://example.com', 'http://127.0.0.1/api', 'http://user:pass@127.0.0.1', 'http://127.0.0.1?token=secret']) {
    await assert.rejects(loadOwnerTransport({ WORKSPACE_PI_LOCAL_URL: url }), { code: 'LOCAL_LOOPBACK_URL_REQUIRED' });
  }
  const ui = tui(() => assert.fail('No API call'), {});
  assert.deepEqual(await ui.events.get('input')({ text: 'Approve and dispatch everything' }, ui.ctx), { action: 'handled' });
  assert.equal((await ui.events.get('user_bash')()).result.exitCode, 1);
  await assert.rejects(ui.commands.get('workspace-muse').handler('new', { ...ui.ctx, mode: 'rpc' }), /INTERACTIVE_TUI_REQUIRED/);
});

test('checked-in Muse Python v4 CLI consumes the same TUI-created task with real current v1 bodies and preserved lease', async t => {
  const f = await fixture(t);
  const ui = tui(f.request, createRequestJournal(path.join(f.directory, 'journal')), { inputs: ['channel-validation', 'Consumer protocol fixture', 'US', 'Test the existing Muse v1 consumer', '5', new Date(Date.now() + 86400000).toISOString()] });
  await ui.run('new'); const id = ui.result().delegation.orderId;
  await ui.run(`approve ${id}`); await ui.run(`dispatch ${id}`);
  const child = spawn('python3', [fileURLToPath(new URL('./fixtures/muse-consumer.py', import.meta.url))], { stdio: ['pipe', 'pipe', 'pipe'] });
  let output = '', errors = '';
  child.stdout.on('data', bytes => output += bytes); child.stderr.on('data', bytes => errors += bytes);
  child.stdin.end(JSON.stringify({ port: f.port, host: 'workspace.test', taskRef: id, directory: path.join(f.directory, 'consumer') }));
  const code = await new Promise((resolve, reject) => { child.on('error', reject); child.on('exit', resolve); });
  assert.equal(code, 0, errors + output);
  assert.equal(JSON.parse(output).operations.length, 9);
  await ui.run(`refresh ${id}`);
  assert.equal(ui.result().delegation.phase, 'result_returned');
  assert.equal(ui.result().delegation.receipt.summary, 'Checked-in Muse CLI local fixture result');
  assert.equal(ui.result().delegation.wake.observed, false);
  assert.equal(f.app.store.read().museTasks.length, 1);
});

test('journal must persist before prepare and recovery is isolated by original owner/workspace/conversation', async t => {
  const f = await fixture(t), root = path.join(f.directory, 'journal');
  const scope = { workspaceId: 'a', subject: 'b', conversationId: 'c' };
  const journal = createRequestJournal(root);
  await journal.save({ scope, input: { requestId: 'original-key' } });
  for (const other of [{ ...scope, workspaceId: 'different' }, { ...scope, subject: 'different' }, { ...scope, conversationId: 'different' }]) assert.equal(await journal.read(other), null);
  assert.equal((await createRequestJournal(root).read(scope)).input.requestId, 'original-key');
  const blocked = path.join(f.directory, 'not-a-directory');
  await writeFile(blocked, 'Fixture blocks write-ahead persistence.');
  const ui = tui(f.request, createRequestJournal(blocked), { inputs: ['channel-validation', 'Public fixture', 'US', 'Must never send before journal write', '5', new Date(Date.now() + 86400000).toISOString()] });
  await ui.run('new');
  assert.equal(ui.error(), 'EEXIST');
  assert.equal((f.app.store.read().workerOrders || []).length, 0);
});
