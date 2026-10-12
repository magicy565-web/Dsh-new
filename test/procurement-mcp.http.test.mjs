import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createApp } from '../server/index.mjs';

const tokens = ['synthetic-procurement-buyer-a-0123456789', 'synthetic-procurement-buyer-b-0123456789'];
const hash = text => createHash('sha256').update(text).digest('hex');
const command = () => ({ requestId: randomUUID() });
test('actual sourcing MCP persists private buyer requests, explicit exact merchant sharing, replies and revocation across restart', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'workspace-procurement-mcp-'));
  let app, address, calls = 0;
  const options = { dataDirectory: directory, capabilityEnvironment: {}, provider: { kind: 'fixture', configured: false, complete() { calls++; assert.fail('No model may execute'); } },
    sourcingMcpConfig: { enabled: true, principals: tokens.map((token, i) => ({ tokenDigest: hash(token), subject: 'external-buyer-' + i, workspaceId: 'local' })) } };
  const open = async () => {
    app = await createApp(options);
    // Original Host bindResources returns asynchronous actor/epoch-guarded
    // reads. Preserve actual Store service behavior while exercising this
    // transport contract; this does not emulate the unavailable native Host.
    for (const name of ['searchPublic', 'getPublicSupplier', 'publicChanges', 'inquiry', 'reviewInquiry']) {
      const original = app.supply[name]; app.supply[name] = async (...args) => original(...args);
    }
    address = await app.listen(0);
  };
  t.after(async () => { await app.close(); await rm(directory, { recursive: true, force: true }); }); await open();
  const http = async (route, method = 'GET', body, headers = {}) => {
    const response = await fetch(`http://127.0.0.1:${address.port}${route}`, { method, headers: { ...headers, ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, body: await response.json() };
  };
  const mcp = async (name, args = {}, i = 0, headers = {}) => (await http('/mcp/sourcing', 'POST', { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }, { Authorization: 'Bearer ' + tokens[i], ...headers })).body;
  const skuId = randomUUID(), product = (await http('/api/library/products', 'POST', { ...command(), name: 'Saved enterprise fixture', skus: [{ id: skuId, code: 'P-1' }] })).body.product;
  let supplier = (await http('/api/supply/suppliers', 'POST', { ...command(), displayName: 'Specified enterprise', country: 'China' })).body.supplier;
  supplier = (await http(`/api/supply/suppliers/${supplier.id}/merchant`, 'POST', { ...command(), expectedRevision: supplier.revision, merchantSubject: 'local-operator', confirmed: true })).body.supplier;
  await http(`/api/supply/suppliers/${supplier.id}/publish`, 'POST', { ...command(), expectedRevision: supplier.revision, confirmed: true });
  let listing = (await http('/api/supply/listings', 'POST', { ...command(), supplierId: supplier.id, title: 'Public fixture', sku: 'S-1', unitPrice: '1.50', currency: 'USD', moq: 1, leadDays: 7, incoterm: 'FOB' })).body.listing;
  listing = (await http(`/api/supply/listings/${listing.id}/product`, 'POST', { ...command(), expectedRevision: listing.revision, productId: product.id, expectedProductRevision: product.revision, skuId, confirmed: true })).body.listing;
  await http(`/api/supply/listings/${listing.id}/publish`, 'POST', { ...command(), expectedRevision: listing.revision, confirmed: true });
  assert.equal((await mcp('workspace_supply_search')).result.structuredContent.returned, 1);
  const draftInput = { ...command(), listingId: listing.id, quantity: 10, destination: 'US', notes: 'Private external buyer data' };
  const draft = (await mcp('workspace_procurement_draft', draftInput)).result.structuredContent.inquiry;
  assert.equal((await http('/api/supply/inquiries')).body.inquiries.length, 0);
  assert.equal((await mcp('workspace_procurement_draft', { ...draftInput, subject: 'local-operator' })).error.code, -32602);
  assert.equal((await mcp('workspace_procurement_get', { inquiryId: draft.id }, 1)).result.structuredContent.error.code, 'SUPPLY_NOT_FOUND');
  const reviewed = (await mcp('workspace_procurement_review', { inquiryId: draft.id })).result.structuredContent;
  const consent = { inquiryId: draft.id, ...command(), expectedRevision: 1, expectedReviewHash: reviewed.reviewHash, confirmed: true };
  assert.equal((await mcp('workspace_procurement_share', { ...consent, confirmed: false })).result.structuredContent.error.code, 'SUPPLY_CONFIRMATION_REQUIRED');
  const shared = (await mcp('workspace_procurement_share', consent)).result.structuredContent.inquiry;
  assert.equal((await http('/api/supply/inquiries')).body.inquiries[0].id, draft.id);
  const mainInput = { ...command(), title: 'Actual merchant main conversation' };
  const main = (await http('/api/conversations', 'POST', mainInput)).body.conversation;
  assert.equal(main.createdBy, 'local-operator');
  assert.equal(main.workspaceId, 'local');
  const foreign = (await app.runtime.createConversation({ title: 'Another member conversation' }, { subject: 'other-fixture-member', workspaceId: 'local' })).conversation;
  const historical = (await http('/api/conversations', 'POST', { title: 'Historical ownerless conversation' })).body.conversation;
  await app.store.update(state => {
    const ownerless = state.conversations.find(item => item.id === historical.id);
    delete ownerless.createdBy; delete ownerless.workspaceId;
    // Earlier keyed creates retained the server owner and receipt, without
    // storing workspaceId on the conversation itself. Preserve that recovery.
    delete state.conversations.find(item => item.id === main.id).workspaceId;
  });
  for (const conversationId of [foreign.id, historical.id]) {
    const denied = await http(`/api/supply/inquiries/${draft.id}/conversation`, 'POST', { ...command(), expectedRevision: shared.revision, conversationId, confirmed: true });
    assert.equal(denied.status, 404); assert.equal(denied.body.error.code, 'SUPPLY_CONVERSATION_REQUIRED');
  }
  const attachInput = { ...command(), expectedRevision: shared.revision, conversationId: main.id, confirmed: true };
  const attached = await http(`/api/supply/inquiries/${draft.id}/conversation`, 'POST', attachInput);
  assert.equal(attached.status, 200, JSON.stringify(attached.body));
  assert.equal((await http(`/api/conversations/${encodeURIComponent(main.id)}/procurement`)).body.inquiries[0].id, draft.id);
  const replyInput = { ...command(), expectedRevision: attached.body.inquiry.revision, expectedShareHash: reviewed.reviewHash, content: 'Actual persisted merchant fixture reply', confirmed: true };
  const reply = (await http(`/api/supply/inquiries/${draft.id}/reply`, 'POST', replyInput)).body;
  assert.ok(reply.reply?.id, JSON.stringify(reply));
  await app.close(); await open();
  assert.equal((await mcp('workspace_procurement_draft', draftInput)).result.structuredContent.inquiry.id, draft.id);
  assert.equal((await mcp('workspace_procurement_get', { inquiryId: draft.id })).result.structuredContent.inquiry.replies[0].id, reply.reply.id);
  assert.equal((await http('/api/conversations', 'POST', mainInput)).body.conversation.id, main.id);
  assert.equal((await http(`/api/supply/inquiries/${draft.id}/conversation`, 'POST', attachInput)).body.inquiry.merchantConversation.conversationId, main.id);
  assert.equal((await http(`/api/supply/inquiries/${draft.id}/reply`, 'POST', replyInput)).body.reply.id, reply.reply.id);
  const restored = (await http(`/api/conversations/${encodeURIComponent(main.id)}/procurement`)).body.inquiries[0];
  assert.equal(restored.status, 'replied'); assert.equal(restored.replies.length, 1);
  assert.equal(app.store.read().messages.filter(message => message.source === 'procurement' && message.conversationId === main.id).length, 2);
  assert.equal(app.store.read().runs.length, 0);
  assert.equal((await http('/mcp/sourcing', 'POST', { jsonrpc: '2.0', id: 1, method: 'tools/list' }, { Authorization: 'Bearer ' + tokens[0], Cookie: 'forbidden-browser-cookie' })).status, 403);
  await mcp('workspace_procurement_revoke', { inquiryId: draft.id, ...command(), expectedRevision: reply.revision, confirmed: true });
  assert.equal((await http(`/api/supply/inquiries/${draft.id}`)).status, 404);
  await app.close(); await open(); await mcp('workspace_procurement_share', consent);
  assert.equal((await http('/api/supply/inquiries')).body.inquiries.length, 0);
  assert.equal(app.store.read().supplyNetwork.inquiries.length, 1); assert.equal(calls, 0);
});

test('restored owned conversation procurement reads decode its opaque identifier exactly once', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'workspace-procurement-opaque-'));
  const app = await createApp({ dataDirectory: directory, capabilityEnvironment: {}, provider: { kind: 'fixture', configured: false, complete() { assert.fail('No model may execute'); } } });
  t.after(async () => { await app.close(); await rm(directory, { recursive: true, force: true }); });
  // Restore an original owned conversation and its already approved share. This
  // is a local disk fixture, not a new buyer grant or live procurement event.
  const conversationId = 'merchant/main:2026/10%2F原会话', inquiryId = randomUUID();
  await app.store.update(state => {
    state.conversations.push({ id: conversationId, subject: 'local-operator', title: 'Restored merchant conversation', status: 'idle', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    state.supplyNetwork = { version: 1, workspaceId: 'local', suppliers: [], listings: [], inquiries: [{ id: inquiryId, createdBy: 'external-fixture-buyer', share: { status: 'active', merchantSubject: 'local-operator' }, merchantConversation: { subject: 'local-operator', conversationId }, replies: [] }], commands: [], events: [], shopifyObservation: null };
  });
  const { port } = await app.listen(0);
  const response = await fetch(`http://127.0.0.1:${port}/api/conversations/${encodeURIComponent(conversationId)}/procurement`);
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).inquiries.map(inquiry => inquiry.id), [inquiryId]);
  const malformed = await fetch(`http://127.0.0.1:${port}/api/conversations/%ZZ/procurement`);
  assert.equal(malformed.status, 400);
  assert.equal((await malformed.json()).error.code, 'INVALID_PATH');
});
