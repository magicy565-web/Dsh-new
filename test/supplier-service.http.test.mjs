import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { createModels } from '@earendil-works/pi-ai';
import { fauxProvider, fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai/providers/faux';
import { createApp } from '../server/index.mjs';
import { createPiProvider } from '../server/pi-provider.mjs';
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function fixture(t, options = {}) {
  const directory = await fs.mkdtemp('/tmp/workspace-supplier-http-'), faux = fauxProvider();
  const provider = () => { const models = createModels(); models.setProvider(faux.provider); return createPiProvider({ models, providerId: 'faux', model: 'faux-1' }); };
  let app, address;
  const open = async () => { app = await createApp({ dataDirectory: directory, capabilityEnvironment: {}, ...options, provider: provider() }); address = await app.listen(0); };
  await open(); t.after(async () => { await app.close(); await fs.rm(directory, { recursive: true, force: true }); });
  const http = async (route, method = 'GET', body) => { const response = await fetch(`http://127.0.0.1:${address.port}${route}`, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, ...(body ? { body: JSON.stringify(body) } : {}) }); return { status: response.status, body: await response.json() }; };
  const main = (await http('/api/conversations', 'POST', { title: 'Actual supplier main', requestId: 'supplier-original-create' })).body.conversation;
  return { http, main, faux, get app() { return app; }, async restart() { await app.close(); await open(); } };
}
test('real Pi SDK tool and HTTP save private supplier facts, clarify without inventing and dedupe across disk reopen', async t => {
  const f = await fixture(t), route = `/api/conversations/${encodeURIComponent(f.main.id)}/supplier-services`;
  const body = { requestId: 'supplier-real-pi-1', content: '名称: Original supplier product; MOQ: 500; 批发价: 2.50; 批发货币: CNY; 生产交期: 30 天。' };
  f.faux.setResponses([fauxAssistantMessage(fauxToolCall('workspace_propose_supplier_profile', { facts: { name: 'Original supplier product', supplierMoq: 500, wholesaleUnitPrice: '2.50', wholesaleCurrency: 'CNY', productionDays: 30, consumerPrice: '2.50', unitsPerPack: 500 }, sources: ['name', 'supplierMoq', 'wholesaleUnitPrice', 'wholesaleCurrency', 'productionDays', 'consumerPrice', 'unitsPerPack'].map(field => ({ field, kind: 'message', requestId: body.requestId, quote: body.content })) }), { stopReason: 'toolUse' })]);
  const first = await f.http(route, 'POST', body); assert.equal(first.status, 202, JSON.stringify(first.body));
  for (let n = 0; n < 300 && f.app.runtime.getRun(first.body.run.id).run.status === 'running'; n++) await pause(10);
  assert.equal(f.app.runtime.getRun(first.body.run.id).run.status, 'succeeded', JSON.stringify(f.app.runtime.getRun(first.body.run.id).run.error));
  const detail = (await f.http(route + '/' + first.body.serviceId)).body.service;
  assert.equal(detail.profile.supplierMoq, 500); assert.equal(detail.profile.consumerPrice, null); assert.equal(detail.profile.unitsPerPack, null);
  assert.equal(detail.profile.productionDays, 30); assert.equal(detail.profile.handlingDays, null); assert.equal(detail.suggestions.length, 2);
  assert.equal(f.app.runtime.bootstrap().workspaceSupplierServices, undefined);
  await f.restart(); const repeated = await f.http(route, 'POST', body);
  assert.equal(repeated.body.serviceId, first.body.serviceId); assert.equal(repeated.body.run.id, first.body.run.id); assert.equal(f.faux.state.callCount, 1);
  assert.equal((await f.http(route, 'POST', { ...body, content: 'Different exact body' })).status, 409);
});
test('actual private image/retail preview and original product library persist; no Shopify config returns blocked', async t => {
  const f = await fixture(t), route = `/api/conversations/${encodeURIComponent(f.main.id)}/supplier-services`;
  const image = (await f.http('/api/artifacts', 'POST', { requestId: 'supplier-image-original', filename: 'supplier.png', base64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jKAAAAABJRU5ErkJggg==', metadata: { businessLibrary: { visibility: 'internal' } } })).body.artifact;
  assert.ok(image?.id);
  const created = await f.http(route, 'POST', { requestId: 'supplier-explicit-facts', facts: { name: 'Original supplier fixture', description: 'Known retail product', targetMarket: 'US', currency: 'USD', skuCode: 'SUPPLIER-FIXTURE', supplierUnit: 'piece', supplierMoq: 500, wholesaleUnitPrice: '2.50', wholesaleCurrency: 'CNY', productionDays: 30, retailUnit: 'piece', unitsPerPack: 2, consumerPrice: '9.50', handlingDays: 3, shippingDays: 7, images: [{ kind: 'artifact', asset: { artifactId: image.id, version: image.currentVersion, sha256: image.sha256 }, sourceNote: 'Owner supplied fixture image' }] } });
  assert.equal(created.status, 202, JSON.stringify(created.body)); const id = created.body.serviceId;
  const input = { requestId: 'supplier-review-preview', expectedRevision: 1, confirmed: true, publicFields: ['name', 'description', 'skuCode', 'retailUnit', 'unitsPerPack', 'consumerPrice', 'handlingDays', 'shippingDays', 'images'] };
  const preview = await f.http(route + '/' + id + '/preview', 'POST', input); assert.equal(preview.status, 200, JSON.stringify(preview.body)); assert.equal(preview.body.preview.phase, 'preview_ready');
  assert.equal(preview.body.preview.images[0].availability, 'available'); assert.equal(preview.body.preview.saleUnit.unitsPerPack, 2); assert.equal(preview.body.preview.externalStatus, 'preview');
  assert.ok(!JSON.stringify(preview.body.preview).includes('2.50')); assert.ok(!JSON.stringify(preview.body.preview).includes('500'));
  const save = await f.http(route + '/' + id + '/save-product', 'POST', { requestId: 'supplier-save-original-product', expectedRevision: 2, confirmed: true }); assert.equal(save.status, 200, JSON.stringify(save.body));
  assert.equal(save.body.product.skus[0].moq, 500); assert.equal(save.body.product.skus[0].leadTimeDays, 30); assert.equal(save.body.product.images[0].asset.sha256, image.sha256);
  const draft = await f.http(route + '/' + id + '/shopify-draft', 'POST', { requestId: 'supplier-external-draft', expectedRevision: 2, expectedPreviewHash: preview.body.preview.previewHash, confirmed: true }); assert.equal(draft.body.status, 'blocked'); assert.equal(draft.body.error.code, 'SHOPIFY_SETUP_REQUIRED');
  await f.restart(); assert.equal((await f.http(route + '/' + id + '/preview', 'POST', input)).body.preview.id, preview.body.preview.id);
  const changed = await f.http(route + '/' + id + '/profile', 'POST', { requestId: 'supplier-change-retail-unit', expectedRevision: 2, facts: { unitsPerPack: 3 } }); assert.equal(changed.body.service.preview, null);
  const updated = await f.http(route + '/' + id + '/save-product', 'POST', { requestId: 'supplier-update-original-product', expectedRevision: 3, confirmed: true }); assert.equal(updated.body.product.id, save.body.product.id); assert.equal(updated.body.product.revision, 2);
  const originalSave = await f.http(route + '/' + id + '/save-product', 'POST', { requestId: 'supplier-save-original-product', expectedRevision: 2, confirmed: true }); assert.equal(originalSave.body.duplicate, true); assert.equal((await f.http(route + '/' + id)).body.service.productReference.productRevision, 2);
  assert.equal(f.app.store.read().goals.length, 0); assert.equal(f.faux.state.callCount, 0);
});

test('uncertain original library acknowledgement recovers the same receipt and never creates another product', async t => {
  const f = await fixture(t), route = `/api/conversations/${encodeURIComponent(f.main.id)}/supplier-services`;
  const service = (await f.http(route, 'POST', { requestId: 'supplier-save-recovery-intake', facts: { name: 'Saved once despite response loss' } })).body.service;
  const original = f.app.businessLibrary.createProduct; f.app.businessLibrary.createProduct = async (...args) => { await original(...args); throw Error('Synthetic acknowledgement loss after original Store commit'); };
  const input = { requestId: 'supplier-original-save-recovery', expectedRevision: 1, confirmed: true };
  assert.equal((await f.http(route + '/' + service.id + '/save-product', 'POST', input)).status, 500); assert.equal(f.app.store.read().businessLibrary.products.length, 1);
  await f.restart(); const recovered = await f.http(route + '/' + service.id + '/save-product', 'POST', input); assert.equal(recovered.status, 200, JSON.stringify(recovered.body)); assert.equal(f.app.store.read().businessLibrary.products.length, 1);
  assert.equal((await f.http(route + '/' + service.id + '/save-product', 'POST', input)).body.duplicate, true);
});

test('explicit intake cancellation and rejection preserve facts, clear preview and block later edits', async t => {
  const f = await fixture(t), route = `/api/conversations/${encodeURIComponent(f.main.id)}/supplier-services`;
  for (const action of ['cancel', 'reject']) {
    const service = (await f.http(route, 'POST', { requestId: 'supplier-stop-intake-' + action, facts: { name: 'Original stopped facts' } })).body.service;
    const body = { requestId: 'supplier-' + action, expectedRevision: service.revision, expectedProfileHash: service.profileHash, confirmed: true };
    const stopped = await f.http(route + '/' + service.id + '/' + action, 'POST', body); assert.equal(stopped.status, 200); assert.equal(stopped.body.service.phase, action === 'cancel' ? 'cancelled' : 'rejected'); assert.equal(stopped.body.service.profile.name, 'Original stopped facts');
    assert.equal((await f.http(route + '/' + service.id + '/' + action, 'POST', body)).body.duplicate, true);
    assert.equal((await f.http(route + '/' + service.id + '/profile', 'POST', { requestId: 'supplier-edit-stopped-' + action, expectedRevision: 2, facts: { name: 'Changed' } })).status, 409);
  }
});
test('unconfigured seven-day monitor is a disabled original task; missing data stays null and late summary is idempotent', async t => {
  let time = Date.parse('2026-10-12T10:00:00Z');
  const f = await fixture(t, { accessClock: () => time }), route = `/api/conversations/${encodeURIComponent(f.main.id)}/supplier-services`;
  const service = (await f.http(route, 'POST', { requestId: 'supplier-monitor-intake', facts: { name: 'Monitor fixture' } })).body.service;
  const input = { requestId: 'supplier-configure-monitor', expectedRevision: service.revision, shopifyProductId: 'gid://shopify/Product/123', startAt: '2026-10-12T09:00:00Z', confirmed: true };
  const creation = await f.http(route + '/' + service.id + '/monitors', 'POST', input); assert.equal(creation.status, 200, JSON.stringify(creation.body)); assert.equal(creation.body.status, 'blocked');
  const monitor = creation.body.monitor; assert.equal(monitor.scheduleEnabled, false); assert.equal(f.app.store.read().capabilities.schedules.length, 1);
  assert.equal((await f.http(route + '/' + service.id + '/monitors', 'POST', input)).body.monitor.id, monitor.id); assert.equal(f.app.store.read().goals.length, 1);
  const check = { requestId: 'supplier-check-unconfigured', monitorId: monitor.id, expectedMonitorHash: monitor.scopeHash, confirmed: true };
  const sampled = await f.http(route + '/' + service.id + '/monitor-check', 'POST', check); assert.equal(sampled.body.sample.sales, null); assert.equal(sampled.body.sample.trafficStatus, 'unsupported'); assert.equal(sampled.body.sample.errors[0].code, 'SHOPIFY_SETUP_REQUIRED');
  await f.restart(); assert.equal((await f.http(route + '/' + service.id + '/monitor-check', 'POST', check)).body.duplicate, true);
  time += 8 * 86400000;
  const final = await f.http(route + '/' + service.id + '/monitor-check', 'POST', { ...check, requestId: 'supplier-end-unconfigured' }); assert.equal(final.body.summary.sales, null); assert.equal(final.body.summary.notificationCount, 1);
  await f.restart(); await f.http(route + '/' + service.id + '/monitor-check', 'POST', { ...check, requestId: 'supplier-late-unconfigured' });
  assert.equal(f.app.store.read().messages.filter(message => message.id === final.body.summary.messageId).length, 1); assert.equal(f.faux.state.callCount, 0);
});
