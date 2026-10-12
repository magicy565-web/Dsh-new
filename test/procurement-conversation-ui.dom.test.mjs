import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID, createHash } from 'node:crypto';
import { originalHttp, bundleRenderer, wait, button, click, field, input } from './fixtures/conversation-ui.mjs';

// Original HTTP/MCP/Store in a temporary directory. The buyer token is a
// fixture; merchant conversations are created by the actual HTTP API, not
// client-supplied authority. Reading/binding/replying must not execute a model.
async function fixture(t) {
  const token = 'synthetic-conversation-ui-buyer-0123456789', request = () => ({ requestId: randomUUID() });
  const http = await originalHttp(t, { sourcingMcpConfig: { enabled: true, principals: [{ tokenDigest: createHash('sha256').update(token).digest('hex'), subject: 'external-ui-buyer', workspaceId: 'local' }] } });
  const mcp = async (name, args = {}) => {
    const result = await http.request('/mcp/sourcing', 'POST', { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }, { Authorization: 'Bearer ' + token });
    assert.ok(result.result?.structuredContent && !result.result.structuredContent.error, JSON.stringify(result)); return result.result.structuredContent;
  };
  const own = (await http.request('/api/conversations', 'POST', { title: 'Original merchant fixture' })).conversation;
  const other = (await http.request('/api/conversations', 'POST', { title: 'Unrelated merchant fixture' })).conversation;
  const skuId = randomUUID(), product = (await http.request('/api/library/products', 'POST', { ...request(), name: 'Saved UI fixture product', skus: [{ id: skuId, code: 'P-UI' }] })).product;
  let supplier = (await http.request('/api/supply/suppliers', 'POST', { ...request(), displayName: 'Exact fixture merchant', country: 'China' })).supplier;
  supplier = (await http.request(`/api/supply/suppliers/${supplier.id}/merchant`, 'POST', { ...request(), expectedRevision: supplier.revision, merchantSubject: 'local-operator', confirmed: true })).supplier;
  await http.request(`/api/supply/suppliers/${supplier.id}/publish`, 'POST', { ...request(), expectedRevision: supplier.revision, confirmed: true });
  let listing = (await http.request('/api/supply/listings', 'POST', { ...request(), supplierId: supplier.id, title: 'Explicit UI fixture listing', sku: 'S-UI', unitPrice: '1.50', currency: 'USD', moq: 1, leadDays: 7, incoterm: 'FOB' })).listing;
  listing = (await http.request(`/api/supply/listings/${listing.id}/product`, 'POST', { ...request(), expectedRevision: listing.revision, productId: product.id, expectedProductRevision: product.revision, skuId, confirmed: true })).listing;
  await http.request(`/api/supply/listings/${listing.id}/publish`, 'POST', { ...request(), expectedRevision: listing.revision, confirmed: true });
  const inquiry = (await mcp('workspace_procurement_draft', { ...request(), listingId: listing.id, quantity: 10, destination: 'US', notes: 'PRIVATE_BUYER_FIXTURE_SCOPE' })).inquiry;
  let loseReply = false;
  const renderer = await bundleRenderer(t, async (path, options) => {
    const response = await http.transport(path, options);
    if (loseReply && options.method === 'POST' && path.endsWith('/reply') && response.ok) { loseReply = false; await response.arrayBuffer(); throw Error('Synthetic response loss after actual HTTP commit'); }
    return response;
  });
  async function share() {
    const reviewed = await mcp('workspace_procurement_review', { inquiryId: inquiry.id });
    return (await mcp('workspace_procurement_share', { ...request(), inquiryId: inquiry.id, expectedRevision: inquiry.revision, expectedReviewHash: reviewed.reviewHash, confirmed: true })).inquiry;
  }
  return { http, mcp, own, other, inquiry, share, ...renderer, loseNextReply() { loseReply = true; } };
}
async function associate(f, ui) {
  await wait(() => button(ui, '关联到本会话') && !button(ui, '关联到本会话').disabled, 'actual shared inquiry visible');
  await click(ui, button(ui, '关联到本会话')); const modal = ui.document.querySelector('[role="dialog"]');
  await wait(() => modal.querySelector('input[type="checkbox"]') && !modal.querySelector('input[type="checkbox"]').disabled, 'original association scope is settled');
  await click(ui, modal.querySelector('input[type="checkbox"]'));
  await wait(() => button(ui, '确认关联本会话', modal) && !button(ui, '确认关联本会话', modal).disabled, 'actual checked association confirmation is enabled');
  await click(ui, button(ui, '确认关联本会话', modal));
  await wait(() => !ui.document.querySelector('[role="dialog"]'), 'exact inquiry associated');
  await wait(() => button(ui, '回复原采购方') && !button(ui, '回复原采购方').disabled, 'original associated row refreshed');
}
async function reply(ui, content) {
  await click(ui, button(ui, '回复原采购方')); const modal = ui.document.querySelector('[role="dialog"]');
  const textarea = field(ui, '给原采购方的回复'); assert.equal(textarea.maxLength, 2400);
  await input(ui, textarea, content); await click(ui, modal.querySelector('input[type="checkbox"]')); await click(ui, button(ui, '确认提交原回复', modal));
}
test('conversation UI keeps buyer draft private, explicitly binds exact shared inquiry and persists one original merchant reply', async t => {
  const f = await fixture(t), privateUi = await f.render(`/chat/${f.own.id}`);
  await wait(() => !privateUi.document.querySelector('.conversation-procurement'), 'unshared private inquiry not exposed');
  assert.ok(!privateUi.document.body.textContent.includes('PRIVATE_BUYER_FIXTURE_SCOPE')); assert.equal(f.requests.filter(item => item.method !== 'GET').length, 0);
  privateUi.window.close(); const shared = await f.share(), ui = await f.render(`/chat/${f.own.id}`); await associate(f, ui);
  const bind = f.requests.find(item => item.method === 'POST');
  assert.deepEqual(Object.keys(bind.body).sort(), ['confirmed', 'conversationId', 'expectedRevision', 'requestId']); assert.equal(bind.body.expectedRevision, shared.revision); assert.equal(bind.body.conversationId, f.own.id);
  await wait(() => ui.document.querySelector('.message-row').textContent.includes('采购需求已关联到本会话'), 'inert original conversation reference');
  const other = await f.render(`/chat/${f.other.id}`); await wait(() => !other.document.querySelector('.conversation-procurement'), 'bound inquiry absent from other conversation');
  assert.ok(!other.document.body.textContent.includes('PRIVATE_BUYER_FIXTURE_SCOPE'));
  await reply(ui, 'Persisted original merchant UI fixture reply'); await wait(() => !ui.document.querySelector('[role="dialog"]'), 'reply committed');
  await wait(() => ui.document.querySelectorAll('.message-row').length === 2, 'reply saved as inert original conversation message');
  const result = (await f.mcp('workspace_procurement_get', { inquiryId: f.inquiry.id })).inquiry;
  assert.equal(result.replies.length, 1); assert.equal(result.replies[0].content, 'Persisted original merchant UI fixture reply');
  const replyRequest = f.requests.find(item => item.method === 'POST' && item.path.endsWith('/reply'));
  assert.equal(replyRequest.body.expectedShareHash, shared.share.reviewHash); assert.deepEqual(Object.keys(replyRequest.body).sort(), ['confirmed', 'content', 'expectedRevision', 'expectedShareHash', 'requestId']);
  ui.window.close(); await f.http.restart(); const reopened = await f.render(`/chat/${f.own.id}`);
  await wait(() => reopened.document.querySelector('.conversation-procurement')?.textContent.includes('Persisted original merchant UI fixture reply'), 'disk restart preserves reply');
  assert.equal(f.http.app.store.read().messages.filter(item => item.source === 'procurement').length, 2); assert.equal(f.http.app.store.read().runs.length, 0); assert.equal(f.http.app.store.read().workerOrders?.length || 0, 0); assert.equal(f.http.modelCalls, 0);
  assert.deepEqual(ui.errors, []); assert.deepEqual(other.errors, []); assert.deepEqual(reopened.errors, []);
});
test('lost reply response reopens as same explicit request; revoked sharing blocks future reads and replies', async t => {
  const f = await fixture(t); await f.share(); const ui = await f.render(`/chat/${f.own.id}`); await associate(f, ui); f.loseNextReply();
  await reply(ui, 'One reply despite lost response'); const modal = ui.document.querySelector('[role="dialog"]');
  await wait(() => button(ui, '核对原采购操作', modal), 'retry reachable inside frozen modal');
  const storage = ui.storage(); assert.equal(field(ui, '给原采购方的回复').disabled, true); ui.window.close(); await f.http.restart();
  const reopened = await f.render(`/chat/${f.own.id}`, { storage }); await wait(() => button(reopened, '核对原采购操作'), 'pending reply restored');
  assert.equal(f.requests.filter(item => item.method === 'POST' && item.path.endsWith('/reply')).length, 1);
  await click(reopened, button(reopened, '核对原采购操作')); await wait(() => !button(reopened, '核对原采购操作'), 'same reply reconciled');
  const requests = f.requests.filter(item => item.method === 'POST' && item.path.endsWith('/reply')); assert.equal(requests.length, 2); assert.deepEqual(requests[0], requests[1]);
  const row = (await f.mcp('workspace_procurement_get', { inquiryId: f.inquiry.id })).inquiry; assert.equal(row.replies.length, 1);
  await f.mcp('workspace_procurement_revoke', { requestId: randomUUID(), inquiryId: row.id, expectedRevision: row.revision, confirmed: true });
  reopened.window.close(); const revoked = await f.render(`/chat/${f.own.id}`);
  await wait(() => !revoked.document.querySelector('.conversation-procurement'), 'revoked row not exposed for new replies');
  assert.equal(button(revoked, '回复原采购方'), undefined); assert.equal(f.http.modelCalls, 0); assert.equal(f.http.app.store.read().runs.length, 0);
  assert.deepEqual(reopened.errors, []); assert.deepEqual(revoked.errors, []);
});
