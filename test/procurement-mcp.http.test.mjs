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
  const reply = (await http(`/api/supply/inquiries/${draft.id}/reply`, 'POST', { ...command(), expectedRevision: shared.revision, expectedShareHash: reviewed.reviewHash, content: 'Actual persisted merchant fixture reply', confirmed: true })).body;
  assert.ok(reply.reply?.id, JSON.stringify(reply));
  await app.close(); await open();
  assert.equal((await mcp('workspace_procurement_draft', draftInput)).result.structuredContent.inquiry.id, draft.id);
  assert.equal((await mcp('workspace_procurement_get', { inquiryId: draft.id })).result.structuredContent.inquiry.replies[0].id, reply.reply.id);
  assert.equal((await http('/mcp/sourcing', 'POST', { jsonrpc: '2.0', id: 1, method: 'tools/list' }, { Authorization: 'Bearer ' + tokens[0], Cookie: 'forbidden-browser-cookie' })).status, 403);
  await mcp('workspace_procurement_revoke', { inquiryId: draft.id, ...command(), expectedRevision: reply.revision, confirmed: true });
  assert.equal((await http(`/api/supply/inquiries/${draft.id}`)).status, 404);
  await app.close(); await open(); await mcp('workspace_procurement_share', consent);
  assert.equal((await http('/api/supply/inquiries')).body.inquiries.length, 0);
  assert.equal(app.store.read().supplyNetwork.inquiries.length, 1); assert.equal(calls, 0);
});
