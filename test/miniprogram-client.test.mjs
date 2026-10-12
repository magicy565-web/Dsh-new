import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { promises as fs } from 'node:fs';
import { createHash } from 'node:crypto';
import { createModels } from '@earendil-works/pi-ai';
import { fauxProvider, fauxAssistantMessage } from '@earendil-works/pi-ai/providers/faux';
import { createApp } from '../server/index.mjs';
import { createPiProvider } from '../server/pi-provider.mjs';
const built = spawnSync(process.execPath, ['scripts/build-miniprogram.mjs'], { encoding: 'utf8' });
assert.equal(built.status, 0, built.stdout + built.stderr);
const require = createRequire(import.meta.url);
const { WorkspaceClient, conversationView } = require('../release/miniprogram/shared/client.js');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check) { for (let i = 0; i < 500; i++) { if (await check()) return; await delay(10); } throw new Error('Mini client fixture did not settle'); }
async function fixture(t) {
  const directory = await fs.mkdtemp('/tmp/workspace-mini-fixture-');
  const faux = fauxProvider(), models = createModels(); models.setProvider(faux.provider);
  const app = await createApp({ dataDirectory: directory, provider: createPiProvider({ models, providerId: 'faux', model: 'faux-1' }) });
  const address = await app.listen(0), base = `http://127.0.0.1:${address.port}`;
  const requests = []; let loseNextMutation = false, corruptDigest = false;
  const platform = {
    request(options) {
      requests.push({ url: options.url, method: options.method, data: options.data, header: options.header });
      void fetch(options.url, { method: options.method, headers: options.header, body: options.data ? JSON.stringify(options.data) : undefined }).then(async response => {
        const data = await response.json();
        if (loseNextMutation && options.method === 'POST') { loseNextMutation = false; options.fail({ errMsg: 'fixture lost acknowledgment' }); }
        else options.success({ statusCode: response.status, data, header: Object.fromEntries(response.headers) });
      }).catch(error => options.fail(error)); return { abort() {} };
    },
    downloadFile(options) {
      void fetch(options.url, { headers: options.header }).then(async response => {
        const tempFilePath = `${directory}/download-fixture.bin`; await fs.writeFile(tempFilePath, Buffer.from(await response.arrayBuffer()));
        options.success({ statusCode: response.status, tempFilePath });
      }).catch(options.fail);
    },
    getFileSystemManager() { return {
      readFile(options) { void fs.readFile(options.filePath).then(bytes => options.success({ data: bytes.toString(options.encoding) })).catch(options.fail); },
      getFileInfo(options) { assert.equal(options.digestAlgorithm, 'sha256'); void fs.readFile(options.filePath).then(bytes => options.success({ digest: corruptDigest ? '0'.repeat(64) : digest(bytes), size: bytes.length })).catch(options.fail); },
    }; },
    login() { assert.fail('No real WeChat login/account is used in fixtures'); },
  };
  const client = new WorkspaceClient(platform, { baseUrl: base, allowLoopback: true });
  t.after(async () => { await app.close(); await fs.rm(directory, { recursive: true, force: true }); });
  return { app, client, faux, directory, requests, loseNext() { loseNextMutation = true; }, corrupt() { corruptDigest = true; } };
}

test('WeChat protocol fixture: one conversation uses real Pi backend and verifies actual deliverable bytes', async t => {
  const f = await fixture(t);
  await f.client.initialize();
  const id = await f.client.mainConversation(await f.client.bootstrap());
  f.faux.setResponses([fauxAssistantMessage(JSON.stringify({ done: true, content: 'Mini fixture delivery', artifact: { filename: 'result.md', content: '# Exact server bytes' } }))]);
  const sent = await f.client.send(id, 'Create a fixture report');
  await until(() => f.app.runtime.getRun(sent.run.id).run.status === 'succeeded');
  const view = conversationView(await f.client.bootstrap(), id);
  assert.equal(view.messages.filter(value => value.role === 'user').length, 1);
  const card = view.cards.find(value => value.kind === 'file'); assert.ok(card);
  const filename = await f.client.download(card.file);
  assert.equal(await fs.readFile(filename, 'utf8'), '# Exact server bytes');
  f.corrupt(); await assert.rejects(f.client.download(card.file), { code: 'FILE_HASH_MISMATCH' });
  assert.equal(f.faux.state.callCount, 1);
  assert.ok(f.requests.every(value => ['GET', 'POST', 'DELETE'].includes(value.method)));
});

test('WeChat protocol fixture: lost send acknowledgment retries same business request without another model run', async t => {
  const f = await fixture(t); await f.client.initialize();
  const id = await f.client.mainConversation(await f.client.bootstrap());
  f.faux.setResponses([fauxAssistantMessage(JSON.stringify({ done: true, content: 'Exactly once fixture' }))]);
  f.loseNext();
  await assert.rejects(f.client.send(id, 'Stable original input'), { code: 'RESULT_UNCERTAIN' });
  const first = f.requests.at(-1).data;
  await assert.rejects(f.client.send(id, 'Changed input'), { code: 'RESULT_UNCERTAIN' });
  const retried = await f.client.retrySend();
  assert.deepEqual(f.requests.at(-1).data, first);
  await until(() => f.app.runtime.getRun(retried.run.id).run.status === 'succeeded');
  assert.equal(f.faux.state.callCount, 1);
  assert.equal(f.app.runtime.listRuns().runs.length, 1);
});

test('WeChat protocol fixture: attachment upload uses original storage, opaque IDs encode once and business references use POST', async t => {
  const f = await fixture(t); await f.client.initialize();
  const id = 'original:conversation/mini-fixture';
  await f.app.store.update(state => state.conversations.push({ id, title: 'Fixture original', status: 'idle', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }));
  const filename = `${f.directory}/source.txt`; await fs.writeFile(filename, 'Selected exact mini fixture');
  const file = await f.client.upload(id, 'source.txt', filename, 27);
  assert.equal(file.sha256, digest(Buffer.from('Selected exact mini fixture')));
  f.faux.setResponses([ctx => { assert.ok(JSON.stringify(ctx).includes('Selected exact mini fixture')); return fauxAssistantMessage(JSON.stringify({ done: true, content: 'Selected file read fixture' })); }]);
  const sent = await f.client.send(id, 'Use selected source', [file]);
  await until(() => f.app.runtime.getRun(sent.run.id).run.status === 'succeeded');
  const references = (await f.client.references(id)).libraryReferences;
  await f.client.saveReferences(references);
  assert.equal(f.requests.at(-1).method, 'POST');
  assert.ok(f.requests.at(-1).url.includes(encodeURIComponent(id)));
});

test('WeChat client rejects unconfigured identity and unconfirmed approvals without a platform or model call', async () => {
  const calls = [];
  const client = new WorkspaceClient({ request() { calls.push('request'); }, login() { calls.push('login'); } }, { baseUrl: '' });
  await assert.rejects(client.initialize(), { code: 'SERVICE_SETUP_REQUIRED' });
  await assert.rejects(client.login(), { code: 'LOGIN_INTEGRATION_REQUIRED' });
  await assert.rejects(client.action({ runId: 'fixture', operation: 'approve' }, false), { code: 'APPROVAL_REQUIRED' });
  assert.deepEqual(calls, []);
});

test('WeChat login mapping fixture: broker cannot invent an enterprise role or impersonate another existing session', async () => {
  const actual = { authenticated: true, csrfToken: 'fixture-session-csrf', user: { id: 'existing-operator', role: 'operator' }, expiresAt: null, mode: 'enterprise' };
  const platform = { login(options) { options.success({ code: 'fixture-only-not-real-wechat-code' }); }, request(options) { assert.equal(options.header['X-Workspace-Session'], 'A'.repeat(43)); options.success({ statusCode: 200, data: actual }); } };
  const options = { baseUrl: 'https://workspace.example', loginBroker: async code => { assert.equal(code, 'fixture-only-not-real-wechat-code'); return { token: 'A'.repeat(43), session: { ...actual, user: { ...actual.user, role: 'admin' } } }; } };
  const client = new WorkspaceClient(platform, options);
  assert.equal((await client.login()).user.role, 'operator');
  const impersonation = new WorkspaceClient(platform, { ...options, loginBroker: async () => ({ token: 'A'.repeat(43), session: { ...actual, user: { id: 'other-owner', role: 'admin' } } }) });
  await assert.rejects(impersonation.login(), { code: 'LOGIN_IDENTITY_MISMATCH' });
  assert.equal(impersonation.session, null);
  const missingService = new WorkspaceClient({ login() { assert.fail('No login without configured service'); } }, { ...options, baseUrl: '' });
  await assert.rejects(missingService.login(), { code: 'SERVICE_SETUP_REQUIRED' });
});

test('WeChat original Muse fixture: exact approval/dispatch/file/accept cards never become a Pi model request or wake', async () => {
  const requests = [], sha = 'a'.repeat(64);
  const platform = { request(options) { requests.push(options); options.success({ statusCode: 200, data: { delegation: {} } }); } };
  const client = new WorkspaceClient(platform, { baseUrl: 'https://workspace.example' });
  const snapshot = { conversations: [], messages: [], runs: [], artifacts: [] };
  const original = { conversationId: 'original:owner/session', orderId: 'original-order', reviewHash: sha, review: { product: 'Public fixture', market: 'US', objective: 'Original reviewed scope', budgetCredits: 5 }, receiptHash: sha, returnedHash: sha, receipt: { files: [{ id: 'original-file', version: 1, sha256: sha, filename: 'result.json' }] } };
  for (const [phase, operation] of [['review_required', 'approve'], ['approved', 'dispatch'], ['result_returned', 'accept'], ['queued', 'refresh']]) {
    const view = conversationView(snapshot, original.conversationId, [{ ...original, phase }]);
    const card = view.cards.find(item => item.kind === 'approval' || item.operation === 'refresh');
    assert.equal(card.operation, operation);
    await assert.rejects(client.action(card, false, original.conversationId), { code: 'APPROVAL_REQUIRED' });
    const before = requests.length; await client.action(card, true, original.conversationId);
    assert.equal(requests.length, before + 1);
    assert.ok(requests.at(-1).url.endsWith(`/muse-delegations/original-order/${operation}`));
    assert.equal(requests.at(-1).data.expectedReviewHash, sha);
    if (operation === 'accept') { assert.equal(requests.at(-1).data.receiptHash, sha); assert.equal(view.cards.find(item => item.kind === 'file').muse, true); }
  }
  assert.ok(requests.every(item => !item.url.endsWith('/messages') && !item.url.includes('wake')));
  assert.equal(conversationView(snapshot, 'different-session', [{ ...original, phase: 'result_returned' }]).cards.length, 0);
});
