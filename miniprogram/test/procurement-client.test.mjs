import test from 'node:test';
import assert from 'node:assert/strict';
import { loadPage, until } from './support.mjs';
import { procurementFixture } from './procurement-support.mjs';
const event = id => ({ currentTarget: { dataset: { id } } });
async function open(t, f) { const client = f.client(), { page } = loadPage(client, f.platform); t.after(() => page.onUnload()); page.onShow(); await until(() => page.data.readAt); return { client, page }; }
async function bind(pair, f) { await pair.page.openProcurement(); await pair.page.bindProcurement(event(f.draft.id)); await pair.page.confirmProcurement(); return pair.page.data.conversationId; }

test('actual mini Page -> original HTTP procurement/MCP: private draft, explicit shared association, one reviewed reply, buyer read/reload; models zero', async t => {
  const f = await procurementFixture(t), pair = await open(t, f); await pair.page.openProcurement(); assert.equal(pair.page.data.procurementInbox.length, 0); assert.equal(pair.page.data.conversationId, ''); assert.equal(pair.page.data.goalBlocked, true);
  await f.share(); await pair.page.refreshProcurement(); assert.equal(pair.page.data.procurementInbox.length, 1);
  await pair.page.bindProcurement(event(f.draft.id)); const id = pair.page.data.conversationId; assert.ok(id); assert.equal(f.app.store.read().conversations[0].createdBy, 'local-operator'); assert.equal(f.app.store.read().supplyNetwork.inquiries[0].merchantConversation, undefined);
  pair.page.closeProcurementReview(); assert.equal(f.app.store.read().supplyNetwork.inquiries[0].merchantConversation, undefined);
  await pair.page.openProcurement(); await pair.page.bindProcurement(event(f.draft.id)); await Promise.all([pair.page.confirmProcurement(), pair.page.confirmProcurement()]); assert.equal(pair.page.data.procurementAssociated[0].merchantConversation.conversationId, id);
  const replyText = '本次回复：交期仍需明确确认；不构成采购订单或付款证明。'; pair.page.beginProcurementReply(event(f.draft.id)); pair.page.draft({ detail: { value: replyText } }); await pair.page.send(); assert.equal(f.app.store.read().supplyNetwork.inquiries[0].replies.length, 0);
  assert.equal(pair.page.data.procurementReview.content, replyText); await Promise.all([pair.page.confirmProcurement(), pair.page.confirmProcurement()]); const buyer = (await f.mcp('workspace_procurement_get', { inquiryId: f.draft.id })).inquiry; assert.equal(buyer.replies.length, 1); assert.equal(buyer.replies[0].content, replyText);
  pair.page.onUnload(); await f.reopen(); const restored = await open(t, f); await restored.page.openProcurement(); assert.equal(restored.page.data.conversationId, id); assert.equal(restored.page.data.procurementAssociated[0].replies[0].id, buyer.replies[0].id); assert.ok(restored.page.data.messages.some(value => value.content.includes(replyText)));
  const writes = f.requests.filter(item => item.method === 'POST' && item.path.includes('/inquiries/')); assert.equal(writes.length, 2); assert.deepEqual(Object.keys(writes[1].body).sort(), ['confirmed', 'content', 'expectedRevision', 'expectedShareHash', 'requestId']); assert.equal(f.modelCalls, 0); assert.equal(f.app.store.read().runs.length, 0); assert.equal((f.app.store.read().workerOrders || []).length, 0);
});

test('unknown association and reply results cold-recover original UUID/body; no extra share/reply or Pi fallback', async t => {
  const f = await procurementFixture(t); await f.share(); const pair = await open(t, f); await pair.page.openProcurement(); await pair.page.bindProcurement(event(f.draft.id)); f.loseNext(); await pair.page.confirmProcurement(); const original = structuredClone(f.journal.read().pending); assert.equal(original.kind, 'procurement-bind');
  pair.page.onUnload(); await f.reopen(); const cold = await open(t, f); await Promise.all([cold.page.retry(), cold.page.retry()]); assert.deepEqual(f.requests.filter(item => item.path.endsWith('/conversation')).at(-1).body, original.body);
  await cold.page.openProcurement(); cold.page.beginProcurementReply(event(f.draft.id)); cold.page.draft({ detail: { value: '原请求回复需进一步确认交期。' } }); await cold.page.send(); f.loseNext(); await cold.page.confirmProcurement(); const reply = structuredClone(f.journal.read().pending); assert.equal(reply.kind, 'procurement-reply');
  cold.page.onUnload(); await f.reopen(); const restored = await open(t, f); assert.equal(restored.page.data.draft, reply.body.content); assert.equal(restored.page.data.replyInquiryId, f.draft.id);
  restored.page.exitProcurementReply(event(null)); assert.equal(restored.page.data.replyInquiryId, f.draft.id); await restored.page.retry(); assert.deepEqual(f.requests.filter(item => item.path.endsWith('/reply')).at(-1).body, reply.body);
  const buyer = (await f.mcp('workspace_procurement_get', { inquiryId: f.draft.id })).inquiry; assert.equal(buyer.replies.length, 1); assert.equal(buyer.shares.length, 1); assert.equal(f.modelCalls, 0); assert.equal(f.app.store.read().runs.length, 0);
});

test('reply selection preserves unsent goal/files and transmits only confirmed reply text; revocation removes new-reply controls', async t => {
  const f = await procurementFixture(t); await f.share(); const pair = await open(t, f); await bind(pair, f);
  pair.page.setData({ draft: '未提交的原业务目标', files: [{ id: 'unit-local-selection-not-transmitted', filename: 'private.pdf', mimeType: 'application/pdf' }] }); pair.page.beginProcurementReply(event(f.draft.id)); assert.equal(pair.page.data.files.length, 0); pair.page.draft({ detail: { value: '仅原方回复内容' } }); await pair.page.send(); await pair.page.confirmProcurement(); assert.equal(pair.page.data.draft, '未提交的原业务目标'); assert.equal(pair.page.data.files[0].filename, 'private.pdf');
  const sent = f.requests.filter(item => item.path.endsWith('/reply')).at(-1).body; assert.ok(!JSON.stringify(sent).includes('private.pdf')); assert.ok(!JSON.stringify(sent).includes('未提交的原业务目标'));
  const buyer = (await f.mcp('workspace_procurement_get', { inquiryId: f.draft.id })).inquiry; await f.mcp('workspace_procurement_revoke', { requestId: crypto.randomUUID(), inquiryId: f.draft.id, expectedRevision: buyer.revision, confirmed: true }); await pair.page.openProcurement(); assert.equal(pair.page.data.procurementAssociated.length, 0); pair.page.beginProcurementReply(event(f.draft.id)); assert.equal(pair.page.data.replyInquiryId, ''); assert.equal(f.modelCalls, 0);
});
