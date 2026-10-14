// Explicit finite faux frontend; real enterprise Session/HTTP/Store reads.
import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { SessionManager } from '@earendil-works/pi-coding-agent';
import { createWorkspaceAgentRuntime } from '../scripts/pi-workspace-agent.mjs';
import { createWorkspaceClient } from '../pi/extensions/workspace.mjs';
import { createWorkspaceLibraryClient } from '../pi/extensions/workspace-library-client.mjs';
import { libraryReadHash } from '../server/library-model-read-contract.mjs';
import { api, TOKEN_A } from './fixtures/pi-task-helpers.mjs';
import { syntheticFrontend, callBusinessTool, actualToolReceipt } from './fixtures/pi-workspace-agent-faux.mjs';
import { libraryFixture, libraryClient, workspaceClient, toolReceipt, RECIPIENT, COMPANY, PRODUCT, PRIVATE, API } from './fixtures/pi-library-read.mjs';

async function runtime(t, f, responses, options = {}) {
  const isolated = options.isolationDirectory || await fs.mkdtemp('/tmp/workspace-pi-library-agent-');
  const frontend = await syntheticFrontend(responses);
  const a = await createWorkspaceAgentRuntime({ client: options.client || workspaceClient(f), isolationDirectory: isolated, ...frontend,
    ...(options.sessionManager ? { sessionManager: options.sessionManager } : {}) });
  t.after(() => a.runtime.dispose()); await a.runtime.session.bindExtensions({});
  if (!options.isolationDirectory) t.after(() => fs.rm(isolated, { recursive: true, force: true }));
  return { ...a, ...frontend, isolated };
}
function references(value, id, revision) {
  assert.ok(value.sources.some(row => row.recordId === id && row.revision === revision && /^[a-f0-9]{64}$/u.test(row.projectionSha256)), 'Original revision and projection hash must be cited.');
}

test('official Pi tools read persisted synthetic company/list/detail records and derive replies only from original receipts', async t => {
  const f = await libraryFixture(t), calls = [], contexts = [];
  const traced = response => context => { contexts.push(JSON.stringify(context)); return typeof response === 'function' ? response(context) : response; };
  const a = await runtime(t, f, [callBusinessTool('workspace_company_profile', {}), actualToolReceipt,
    callBusinessTool('workspace_products', { limit: 1 }), actualToolReceipt,
    callBusinessTool('workspace_product', { productId: f.product.id }), actualToolReceipt].map(traced), { client: workspaceClient(f, { calls }) });
  await libraryClient(f).companyProfile(); // Establish existing fixture Session before read-only sequence assertion.
  const sequence = f.app.store.read().meta.sequence;
  for (const [question, expected, key, id, revision] of [
    ['公司资料是什么？', COMPANY, 'company', 'company', f.company.revision],
    ['有哪些产品？', PRODUCT, 'products', f.product.id, f.product.revision],
    [`产品详情 ${f.product.id} 是什么？`, PRODUCT, 'product', f.product.id, f.product.revision],
  ]) {
    await a.runtime.session.prompt(question);
    const { row, value } = toolReceipt(a.runtime); assert.ok(!row.isError); assert.equal(value.status, 'available');
    const item = key === 'products' ? value.products[0] : value[key];
    for (const [field, text] of Object.entries(expected)) assert.equal(item[field], text);
    references(value, id, revision);
    const answer = a.runtime.session.agent.state.messages.filter(row => row.role === 'assistant').at(-1);
    assert.ok(JSON.stringify(answer).includes(expected.name || expected.legalName)); assert.ok(JSON.stringify(answer).includes(id));
    assert.equal(item.supply, undefined); assert.equal(item.skus, undefined); assert.equal(item.images, undefined); assert.equal(item.documents, undefined);
  }
  assert.ok(calls.some(row => row.route === API + '/company'));
  assert.ok(calls.some(row => row.route === API + '/products?limit=1'));
  assert.ok(calls.some(row => row.route === API + '/products/' + f.product.id));
  assert.ok(calls.every(row => row.method === 'GET'));
  assert.equal(f.app.store.read().meta.sequence, sequence); assert.equal(f.faux.state.callCount, 0);
  assert.ok(!JSON.stringify(contexts).includes(PRIVATE)); assert.ok(!JSON.stringify(contexts).includes(TOKEN_A));
  const persisted = await fs.readFile(a.runtime.session.sessionFile, 'utf8');
  assert.ok(persisted.includes(f.product.id)); assert.ok(!persisted.includes(PRIVATE)); assert.ok(!persisted.includes(TOKEN_A));
});

test('unconfigured, authorized-empty, wrong-member, recipient mismatch, transport failure and Agent-Bearer-only are distinct', async t => {
  const disabled = await libraryFixture(t, { policy: null });
  let disabledReads = 0;
  for (const name of ['getCompany', 'getProduct', 'listProducts']) {
    const original = disabled.app.businessLibrary[name];
    disabled.app.businessLibrary[name] = (...args) => { disabledReads++; return original(...args); };
  }
  const unconfigured = await libraryClient(disabled).companyProfile(); assert.equal(unconfigured.status, 'unconfigured');
  assert.equal(disabledReads, 0, 'Unconfigured capability must not inspect private Store records.');
  assert.ok(!JSON.stringify(unconfigured).includes(COMPANY.legalName));
  const empty = await libraryFixture(t, { seed: false });
  const emptyProducts = await libraryClient(empty).products({ limit: 10 }); assert.equal(emptyProducts.status, 'empty'); assert.deepEqual(emptyProducts.products, []);
  const f = await libraryFixture(t);
  const denied = await libraryClient(f, { subject: 'member-b' }).companyProfile(); assert.equal(denied.status, 'blocked');
  const wrongRecipient = await libraryClient(f, { recipient: { ...RECIPIENT, model: 'unreviewed-model', destination: 'https://unreviewed.example' } }).companyProfile(); assert.equal(wrongRecipient.status, 'blocked');
  await assert.rejects(() => libraryClient(f, { fail: true }).companyProfile(), /failed|transport/i);
  const agentOnly = await api(f, API + '/company'); assert.ok([401, 403].includes(agentOnly.status));
  for (const value of [denied, wrongRecipient, agentOnly.json]) assert.ok(!JSON.stringify(value).includes(COMPANY.legalName));
  const originalCommandClient = createWorkspaceClient({ baseURL: 'http://127.0.0.1:1', token: TOKEN_A });
  assert.equal((await originalCommandClient.companyProfile()).status, 'unconfigured');
});

test('unapproved IDs, revision drift, unsafe fields and malformed pagination disclose no private record body', async t => {
  const f = await libraryFixture(t), client = libraryClient(f);
  const other = (await f.app.businessLibrary.createProduct({ requestId: randomUUID(), name: 'UNAPPROVED_ORIGINAL_PRODUCT' }, { subject: 'member-a', role: 'admin' })).product;
  const unknown = await client.product(randomUUID()), unapproved = await client.product(other.id);
  assert.equal(unknown.status, unapproved.status); assert.ok(!JSON.stringify(unapproved).includes('UNAPPROVED_ORIGINAL_PRODUCT'));
  await f.app.businessLibrary.updateProduct(f.product.id, { requestId: randomUUID(), expectedRevision: f.product.revision, changes: { description: 'UNREVIEWED_NEW_REVISION' } }, { subject: 'member-a', role: 'admin' });
  const changed = await client.product(f.product.id); assert.ok(['blocked', 'unavailable'].includes(changed.status));
  assert.ok(!JSON.stringify(changed).includes('UNREVIEWED_NEW_REVISION')); assert.ok(!JSON.stringify(changed).includes(PRODUCT.description));
  for (const limit of [0, 21, '1']) assert.throws(() => client.products({ limit }), /limit|input|integer/i);
  assert.throws(() => client.product('../company'), /UUID|product/i);
  await assert.rejects(() => libraryFixture(t, { policy: { productFields: ['name', 'supply'] } }), /allowed fields|reviewed|scope/i);
});

test('policy subject/workspace/expiry remain existing authorization boundaries', async t => {
  for (const policy of [{ workspaceId: 'other-enterprise' }, { subject: 'member-b' }, { expiresAt: '2000-01-01T00:00:00.000Z' }]) {
    const f = await libraryFixture(t, { policy });
    const value = await libraryClient(f).companyProfile(); assert.equal(value.status, 'blocked'); assert.ok(!JSON.stringify(value).includes(COMPANY.legalName));
  }
});

test('official reopened cached Library receipts are checked before any model call under a different Session identity', async t => {
  const f = await libraryFixture(t);
  const a = await runtime(t, f, [callBusinessTool('workspace_product', { productId: f.product.id }), actualToolReceipt]);
  await a.runtime.session.prompt(`产品详情 ${f.product.id} 是什么？`);
  assert.equal(toolReceipt(a.runtime).value.status, 'available');
  const file = a.runtime.session.sessionFile; await a.runtime.dispose();
  const frontend = await syntheticFrontend([]), manager = SessionManager.open(file, undefined, a.isolated);
  await assert.rejects(() => createWorkspaceAgentRuntime({ client: workspaceClient(f, { subject: 'member-b' }), isolationDirectory: a.isolated,
    ...frontend, sessionManager: manager }), /Library|library|authoriz|policy|receipt|scope/i);
  assert.equal(frontend.faux.state.callCount, 0);
});

test('actual official model identity must match the reviewed recipient before a Library request is sent', async t => {
  const f = await libraryFixture(t), calls = [], library = libraryClient(f, { recipient: { ...RECIPIENT, model: 'unreviewed-model', destination: 'https://unreviewed.example' }, calls });
  const a = await runtime(t, f, [callBusinessTool('workspace_company_profile', {}), actualToolReceipt], { client: workspaceClient(f, { libraryClient: library }) });
  await a.runtime.session.prompt('公司资料是什么？');
  const { row, value } = toolReceipt(a.runtime); assert.ok(row.isError); assert.equal(value.status, 'blocked');
  assert.equal(calls.filter(row => row.route.endsWith('/company')).length, 0); assert.ok(!JSON.stringify(a.runtime.session.agent.state.messages).includes(COMPANY.legalName));
});

test('credential-like approved fields are blocked before official model or transcript disclosure', async t => {
  const f = await libraryFixture(t), forbidden = 'sk-synthetic-never-valid-library-secret-0123456789';
  // Explicit synthetic storage corruption, never a real account secret/source.
  await f.app.store.update(state => { state.businessLibrary.products.find(row => row.id === f.product.id).description = 'api_key=' + forbidden; });
  const a = await runtime(t, f, [callBusinessTool('workspace_product', { productId: f.product.id }), actualToolReceipt]);
  await a.runtime.session.prompt(`产品详情 ${f.product.id} 是什么？`);
  const value = toolReceipt(a.runtime); assert.ok(value.row.isError); assert.equal(value.value.status, 'blocked');
  assert.ok(!JSON.stringify(a.runtime.session.agent.state.messages).includes(forbidden));
  assert.ok(!(await fs.readFile(a.runtime.session.sessionFile, 'utf8')).includes(forbidden));
});

test('a saved Library projection cannot reenter the official model after original record revision drift', async t => {
  const f = await libraryFixture(t);
  const a = await runtime(t, f, [callBusinessTool('workspace_product', { productId: f.product.id }), actualToolReceipt]);
  await a.runtime.session.prompt(`产品详情 ${f.product.id} 是什么？`);
  const file = a.runtime.session.sessionFile; await a.runtime.dispose();
  await f.app.businessLibrary.updateProduct(f.product.id, { requestId: randomUUID(), expectedRevision: f.product.revision, changes: { name: 'UNREVIEWED_UPDATED_NAME' } }, { subject: 'member-a', role: 'admin' });
  const frontend = await syntheticFrontend([]), manager = SessionManager.open(file, undefined, a.isolated);
  await assert.rejects(() => createWorkspaceAgentRuntime({ client: workspaceClient(f), isolationDirectory: a.isolated,
    ...frontend, sessionManager: manager }), /Library|library|revision|receipt|scope/i);
  assert.equal(frontend.faux.state.callCount, 0);
});

test('original projection references are verified rather than accepting a forged hash or unexpected private field', async t => {
  const f = await libraryFixture(t), original = await libraryClient(f).product(f.product.id);
  for (const modify of [value => { value.sources[0].projectionSha256 = '0'.repeat(64); }, value => { value.product.supply = PRIVATE; }]) {
    const value = structuredClone(original); modify(value);
    const forged = createWorkspaceLibraryClient({ recipient: RECIPIENT, request: async () => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } }) });
    await assert.rejects(() => forged.product(f.product.id), /source|projection/i);
  }
});

test('an unchanged reviewed Session can reopen its official transcript and answer with fresh original task reads', async t => {
  const f = await libraryFixture(t);
  const a = await runtime(t, f, [callBusinessTool('workspace_product', { productId: f.product.id }), actualToolReceipt]);
  await a.runtime.session.prompt(`产品详情 ${f.product.id} 是什么？`);
  const file = a.runtime.session.sessionFile; await a.runtime.dispose();
  const manager = SessionManager.open(file, undefined, a.isolated);
  const resumed = await runtime(t, f, [callBusinessTool('workspace_business_tasks', {}), actualToolReceipt], { isolationDirectory: a.isolated, sessionManager: manager });
  await resumed.runtime.session.prompt('任务进度如何？');
  assert.equal(toolReceipt(resumed.runtime).value.status, 'empty');
  assert.equal(resumed.faux.state.callCount, 2); assert.ok(JSON.stringify(resumed.runtime.session.agent.state.messages).includes(f.product.id));
});

test('official same-session model switching cannot forward cached Library data to an unreviewed recipient', async t => {
  const f = await libraryFixture(t);
  const a = await runtime(t, f, [callBusinessTool('workspace_product', { productId: f.product.id }), actualToolReceipt]);
  await a.runtime.session.prompt(`产品详情 ${f.product.id} 是什么？`);
  const before = a.faux.state.callCount;
  await a.runtime.session.setModel({ ...a.model, id: 'unreviewed-model' });
  await a.runtime.session.prompt('请用刚才资料回答产品详情。');
  const last = a.runtime.session.agent.state.messages.at(-1);
  assert.equal(last.role, 'assistant'); assert.equal(last.stopReason, 'error'); assert.match(last.errorMessage, /Library|library|recipient|authorization/i);
  assert.equal(a.faux.state.callCount, before, 'The official model context hook must refuse before a new model request.');
});

test('a different real enterprise Session/Store cannot use the original enterprise reviewed scope', async t => {
  const original = await libraryFixture(t);
  const foreign = await libraryFixture(t, { workspaceId: 'separate-enterprise-test', policy: original.policy });
  const client = libraryClient(foreign);
  for (const read of [() => client.companyProfile(), () => client.products({}), () => client.product(original.product.id)]) {
    const value = await read(); assert.equal(value.status, 'blocked'); assert.deepEqual(value.sources, []);
    assert.ok(!JSON.stringify(value).includes(COMPANY.legalName)); assert.ok(!JSON.stringify(value).includes(PRODUCT.name));
  }
});

test('a partially missing approved product selection fails without disclosing the earlier successful record', async t => {
  const f = await libraryFixture(t, { policy: ({ product }) => ({ products: [{ id: product.id, revision: product.revision }, { id: randomUUID(), revision: 1 }] }) });
  const value = await libraryClient(f).products({ limit: 2 });
  assert.equal(value.status, 'blocked'); assert.deepEqual(value.sources, []); assert.equal(value.products, undefined);
  assert.ok(!JSON.stringify(value).includes(PRODUCT.name));
  // A bounded selection of the one existing record remains an honest read.
  assert.equal((await libraryClient(f).products({ limit: 1 })).products[0].id, f.product.id);
});

test('actual Library HTTP rejects identity/query selectors and all writes without changing original records', async t => {
  const f = await libraryFixture(t), headers = { 'X-Workspace-Library-Recipient': libraryReadHash(RECIPIENT) };
  await f.workspace(API + '/status', { subject: 'member-a', headers });
  const originalLibrary = structuredClone(f.app.store.read().businessLibrary);
  for (const suffix of ['/products?limit=0', '/products?limit=21', '/products?limit=1&limit=2', '/products?workspaceId=other',
    '/products?subject=member-b', '/products?fields=supply', '/company?limit=1']) {
    const value = await f.workspace(API + suffix, { subject: 'member-a', headers }); assert.equal(value.status, 400, suffix);
    assert.ok(!JSON.stringify(value.json).includes(PRODUCT.name));
    assert.deepEqual(f.app.store.read().businessLibrary, originalLibrary);
  }
  const write = await f.workspace(API + '/company', { subject: 'member-a', headers, body: { changes: { legalName: 'UNAUTHORIZED_CHANGE' } } });
  assert.equal(write.status, 405);
  // Existing ingress may audit a denied write; the business authority must not
  // acquire a Library mutation or operation receipt from that request.
  assert.deepEqual(f.app.store.read().businessLibrary, originalLibrary);
  assert.equal(f.app.businessLibrary.getCompany().company.legalName, COMPANY.legalName);
});
