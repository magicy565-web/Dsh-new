// Ordinary local procurement business fixtures; no real buyer credential,
// account/model/Muse/notification execution or independent safety review.
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { createApp } from '../../server/index.mjs';
import { WorkspaceClient, memoryJournal } from './support.mjs';
export async function procurementFixture(t) {
  const directory = await fs.mkdtemp('/tmp/wechat-procurement-'); let modelCalls = 0;
  const token = 'synthetic-original-procurement-business-buyer';
  const options = { dataDirectory: directory, capabilityEnvironment: {}, provider: { kind: 'fixture', configured: false, complete() { modelCalls++; assert.fail('Procurement cannot invoke a model'); } }, sourcingMcpConfig: { enabled: true, principals: [{ tokenDigest: createHash('sha256').update(token).digest('hex'), subject: 'external-procurement-fixture-buyer', workspaceId: 'local' }] } };
  let app = await createApp(options), address = await app.listen(0); const port = address.port, base = `http://127.0.0.1:${port}`, requests = [], journal = memoryJournal(); let lost = false, offline = false;
  async function http(route, method = 'GET', body, headers = {}) {
    const result = await fetch(base + route, { method, headers: { ...headers, ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) }); return { status: result.status, data: await result.json() };
  }
  async function mcp(name, args = {}) { const result = await http('/mcp/sourcing', 'POST', { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }, { Authorization: 'Bearer ' + token }); assert.ok(result.data.result?.structuredContent && !result.data.result.structuredContent.error, JSON.stringify(result)); return result.data.result.structuredContent; }
  const command = () => ({ requestId: randomUUID() });
  const skuId = randomUUID(), product = (await http('/api/library/products', 'POST', { ...command(), name: '真实本地商家产品 fixture', skus: [{ id: skuId, code: 'ENTERPRISE-FIXTURE-SKU' }] })).data.product;
  let supplier = (await http('/api/supply/suppliers', 'POST', { ...command(), displayName: '指定企业 · 本地业务 fixture', country: 'China' })).data.supplier;
  supplier = (await http(`/api/supply/suppliers/${supplier.id}/merchant`, 'POST', { ...command(), expectedRevision: supplier.revision, merchantSubject: 'local-operator', confirmed: true })).data.supplier;
  await http(`/api/supply/suppliers/${supplier.id}/publish`, 'POST', { ...command(), expectedRevision: supplier.revision, confirmed: true });
  let listing = (await http('/api/supply/listings', 'POST', { ...command(), supplierId: supplier.id, title: '已发布原供货声明 fixture', sku: 'ORIGINAL-FIXTURE-SKU', unitPrice: '1.50', currency: 'USD', moq: 1, leadDays: 7, incoterm: 'FOB' })).data.listing;
  listing = (await http(`/api/supply/listings/${listing.id}/product`, 'POST', { ...command(), expectedRevision: listing.revision, productId: product.id, expectedProductRevision: product.revision, skuId, confirmed: true })).data.listing;
  await http(`/api/supply/listings/${listing.id}/publish`, 'POST', { ...command(), expectedRevision: listing.revision, confirmed: true });
  const draft = (await mcp('workspace_procurement_draft', { ...command(), listingId: listing.id, quantity: 10, destination: '美国', notes: '原采购需求：请明确可交货日期，仅为本地采购协议 fixture。' })).inquiry;
  const platform = { request(options) { requests.push({ path: new URL(options.url).pathname, method: options.method, body: structuredClone(options.data) }); if (offline) { options.fail({ errMsg: 'Offline fixture' }); return; } void http(new URL(options.url).pathname, options.method, options.data, options.header).then(result => { if (lost && options.method === 'POST') { lost = false; options.fail({ errMsg: 'Committed reply lost in transport fixture' }); } else options.success({ statusCode: result.status, data: result.data }); }).catch(options.fail); return { abort() {} }; } };
  const client = () => new WorkspaceClient(platform, { baseUrl: base, allowLoopback: true, goalMode: 'muse', journal });
  const close = async () => { await app.close(); await fs.rm(directory, { recursive: true, force: true }); }; t?.after?.(close);
  return { platform, requests, client, journal, draft, mcp, http, close, get app() { return app; }, get modelCalls() { return modelCalls; },
    async share() { const review = await mcp('workspace_procurement_review', { inquiryId: draft.id }); return (await mcp('workspace_procurement_share', { ...command(), inquiryId: draft.id, expectedRevision: draft.revision, expectedReviewHash: review.reviewHash, confirmed: true })).inquiry; },
    loseNext() { lost = true; }, offline(value = true) { offline = value; }, async reopen() { await app.close(); app = await createApp(options); await app.listen(port); },
  };
}
