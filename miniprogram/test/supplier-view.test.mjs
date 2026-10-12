import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { blankSupplierProfile, normalizeSupplierProfile, supplierListingPreview } from '../../server/supplier-profile.mjs';
const require = createRequire(import.meta.url);
const { presentSupplierPreview, listingFieldText } = require('../../release/miniprogram/shared/supplier-view.js');
const facts = () => normalizeSupplierProfile({ name: '真实合同商品', description: '用户明确提供的商品描述', targetMarket: 'US', currency: 'USD', skuCode: 'EXPLICIT-SKU', supplierUnit: '件', supplierMoq: 500, wholesaleUnitPrice: '4.20', wholesaleCurrency: 'USD', internalUnitCost: '2.10', internalCostCurrency: 'USD', recommendedRetailPrice: '19.90', productionDays: 30 });
const selected = ['name','description','skuCode','retailUnit','unitsPerPack','consumerPrice','handlingDays','shippingDays','images'];
test('original service preview display does not turn MOQ, wholesale, recommended price or production into consumer fields', () => {
  const view = presentSupplierPreview(supplierListingPreview(facts(), selected));
  assert.equal(view.price, '尚未提供 USD'); assert.equal(view.pack, '尚未提供 尚未提供 / 包');
  assert.match(view.fulfillment, /尚未提供/); assert.ok(view.missing.includes('消费者实际售价')); assert.ok(view.missing.includes('每包装件数'));
  const displayed = JSON.stringify(view); for (const secret of ['4.20','2.10','19.90','500']) assert.ok(!displayed.includes(secret));
  assert.match(view.status, /尚未创建或发布/);
});
test('explicit retail facts and original provenance appear verbatim; unobserved image remains unknown', () => {
  const profile=normalizeSupplierProfile({ retailUnit:'件',unitsPerPack:2,consumerPrice:'12.30',handlingDays:3,shippingDays:7,images:[{kind:'public_url',url:'https://example.com/product.jpg',sourceNote:'供应商明确提供，尚未授权探测'}]},facts());
  const view=presentSupplierPreview(supplierListingPreview(profile,selected));
  assert.equal(view.price,'12.30 USD'); assert.equal(view.pack,'2 件 / 包'); assert.equal(view.fulfillment,'处理及发货 3 天 · 运输 7 天');
  assert.deepEqual(view.missing,['可用图片']); assert.match(view.images[0].status,/尚未核验/); assert.equal(view.images[0].sourceNote,profile.images[0].sourceNote);
  assert.ok(listingFieldText(profile,'images').includes(profile.images[0].url));
});
test('artifact image review retains original id/version/SHA; preview renderer refuses to portray a publish receipt', () => {
  const asset={artifactId:'a50bc901-afe4-4591-807b-44c0be27b414',version:2,sha256:'a'.repeat(64)};
  const profile=normalizeSupplierProfile({images:[{kind:'artifact',asset,sourceNote:'本测试明确标注的原文件引用'}]},blankSupplierProfile());
  assert.ok(listingFieldText(profile,'images').includes(asset.artifactId)); assert.ok(listingFieldText(profile,'images').includes(asset.sha256));
  const preview=supplierListingPreview(profile,selected,['available']); const view=presentSupplierPreview(preview);
  assert.deepEqual(view.images[0].asset,asset); assert.match(view.images[0].status,/对外传输仍需/);
  assert.throws(()=>presentSupplierPreview({...preview,published:true}),/状态无法核对/);
});
