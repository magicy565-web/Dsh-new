import test from 'node:test';
import assert from 'node:assert/strict';
import { blankSupplierProfile, normalizeSupplierProfile, supplierListingPreview } from '../server/supplier-profile.mjs';
test('supplier, recommended retail and consumer prices remain distinct; MOQ never becomes consumer pack quantity', () => {
  const profile = normalizeSupplierProfile({ name: 'Supplier fixture', supplierMoq: 500, wholesaleUnitPrice: '2.50', wholesaleCurrency: 'CNY', recommendedRetailPrice: '19.00', internalUnitCost: '1.50', productionDays: 30 });
  const preview = supplierListingPreview(profile, ['name']);
  assert.equal(preview.saleUnit.consumerPrice, null); assert.equal(preview.saleUnit.unitsPerPack, null);
  assert.equal(preview.fulfillment.handlingDays, null); assert.equal(preview.fulfillment.shippingDays, null);
  for (const value of ['500', '2.50', '19.00', '1.50', '30']) assert.ok(!JSON.stringify(preview).includes(value));
  assert.equal(profile.currency, null); assert.equal(profile.targetMarket, null);
});
test('explicit retail facts yield real escaped preview content while the original image is still private', () => {
  const profile = normalizeSupplierProfile({ name: 'Known <product>', description: '<script>private markup</script>', targetMarket: 'US', currency: 'USD', retailUnit: 'piece', unitsPerPack: 2, consumerPrice: '9.50', productionDays: 20, handlingDays: 3, shippingDays: 7, images: [{ kind: 'artifact', sourceNote: 'User supplied original image', asset: { artifactId: '12345678-1234-4234-8234-123456789abc', version: 1, sha256: 'a'.repeat(64) } }] });
  const preview = supplierListingPreview(profile, ['name', 'description', 'retailUnit', 'unitsPerPack', 'consumerPrice', 'handlingDays', 'shippingDays', 'images'], ['available']);
  assert.equal(preview.phase, 'preview_ready'); assert.equal(preview.product.status, 'DRAFT'); assert.equal(preview.externalStatus, 'preview');
  assert.ok(preview.product.descriptionHtml.includes('&lt;script&gt;')); assert.ok(!preview.product.descriptionHtml.includes('<script>'));
  assert.equal(preview.images[0].transferStatus, 'private_file_requires_reviewed_transfer'); assert.equal(preview.published, false);
});
test('unknown image availability is never treated as a usable image or permission to publish', () => {
  const profile = normalizeSupplierProfile({ images: [{ kind: 'public_url', url: 'https://example.com/product.png', sourceNote: 'Supplier URL; rights unverified' }] });
  assert.ok(supplierListingPreview(profile, ['images']).missingFields.includes('usableImage'));
  assert.throws(() => supplierListingPreview(profile, ['internalUnitCost']), { code: 'SUPPLIER_PUBLIC_FIELDS_INVALID' });
  assert.equal(blankSupplierProfile().consumerPrice, null);
});
test('invalid currency, unnamed image provenance, negative durations and credential URLs are rejected', () => {
  for (const input of [{ currency: 'usd' }, { supplierMoq: 0 }, { handlingDays: -1 }, { consumerPrice: 9.50 }, { images: [{ kind: 'public_url', url: 'https://user:password@example.com/a.png', sourceNote: 'fixture' }] }, { images: [{ kind: 'public_url', url: 'https://example.com/a.png', sourceNote: '' }] }]) assert.throws(() => normalizeSupplierProfile(input));
});
