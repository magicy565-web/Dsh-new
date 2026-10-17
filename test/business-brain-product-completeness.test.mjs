import assert from 'node:assert/strict';
import test from 'node:test';
import { createBusinessBrainSourceAdapter } from '../server/business-brain-source-adapter.mjs';
import { createBusinessBrainProductSourceAdapter } from '../server/goal-brain-product-source.mjs';

const now = Date.parse('2026-10-17T12:00:00.000Z');
const identity = { workspaceId: 'synthetic-workspace', subject: 'synthetic-owner' };
const supply = {
  packaging: 'roll', samplePolicy: 'sample available', paymentTerms: 'T/T',
  shippingTerms: 'FOB', capacityNote: '10000m'
};
const product = {
  id: '11111111-1111-4111-8111-111111111111', name: 'Synthetic fabric',
  description: 'Synthetic description', category: 'Textile', status: 'draft',
  updatedAt: '2026-10-16T12:00:00.000Z', skus: [{ id: 'synthetic-sku' }],
  images: [{ id: 'synthetic-image' }], documents: [{ documentId: 'synthetic-document' }],
  source: { kind: 'user_provided' }, supply
};

function fixture(products) {
  const state = { meta: { sequence: 1 }, supplyNetwork: { inquiries: [] }, businessLibrary: { products } };
  const options = { store: { read: () => state }, workspaceId: identity.workspaceId, clock: () => now };
  return { state, adapters: [createBusinessBrainSourceAdapter(options), createBusinessBrainProductSourceAdapter(options)] };
}

async function metrics(adapter) {
  const refs = await adapter.list({ identity });
  const reference = refs.find(ref => ['library-product-completeness', 'product-completeness:all'].includes(ref.id));
  return adapter.read({ identity, reference });
}

test('default and optional Brain sources count missing required enterprise supply fields', async () => {
  const empty = Object.fromEntries(Object.keys(supply).map(key => [key, '']));
  for (const value of [undefined, null, {}, empty, { packaging: 'roll' }, { ...supply, paymentTerms: ' ' }]) {
    const { adapters } = fixture([{ ...product, supply: value }]);
    for (const adapter of adapters) {
      const row = await metrics(adapter);
      assert.equal(row.values.complete, 0);
      assert.equal(row.values.incomplete, 1);
      assert.equal(row.values.missingSupply, 1);
    }
  }
});

test('public references do not require enterprise supply but retain other completeness checks', async () => {
  const reference = { ...product, source: { kind: 'public_reference' }, supply: Object.fromEntries(Object.keys(supply).map(key => [key, ''])) };
  const { state, adapters } = fixture([reference]);
  for (const adapter of adapters) {
    const row = await metrics(adapter);
    assert.equal(row.values.complete, 1);
    assert.equal(row.values.incomplete, 0);
    assert.equal(row.values.missingSupply, 0);
  }
  state.businessLibrary.products[0] = { ...reference, documents: [] };
  for (const adapter of adapters) {
    const row = await metrics(adapter);
    assert.equal(row.values.incomplete, 1);
    assert.equal(row.values.missingDocuments, 1);
    assert.equal(row.values.missingSupply, 0);
  }
});

test('complete enterprise supply retains source identity, daily window and current-source checks', async () => {
  const { state, adapters } = fixture([structuredClone(product), { ...product, id: 'archived', status: 'archived', supply: {} }]);
  const expected = await metrics(adapters[0]);
  for (const adapter of adapters) {
    const row = await metrics(adapter);
    assert.equal(row.values.complete, 1);
    assert.equal(row.values.incomplete, 0);
    assert.equal(row.values.missingSupply, 0);
    assert.equal(row.values.archived, 1);
    assert.deepEqual(adapter.current({ identity, reference: row.reference, expected: row }), row);
    await assert.rejects(() => adapter.list({ identity: { ...identity, workspaceId: 'another-workspace' } }), /BRAIN_SOURCE_SCOPE_MISMATCH/);
  }
  assert.equal(expected.reference.id, 'library-product-completeness');
  assert.equal(expected.values.asOf, '2026-10-17T00:00:00.000Z');
  const later = createBusinessBrainSourceAdapter({ store: { read: () => state }, workspaceId: identity.workspaceId, clock: () => now + 60_000 });
  assert.deepEqual(await metrics(later), expected);
  state.businessLibrary.products[0].supply.paymentTerms = '';
  assert.throws(() => adapters[0].current({ identity, reference: expected.reference, expected }), /BRAIN_SOURCE_CHANGED/);
  assert.equal((await metrics(adapters[0])).values.missingSupply, 1);
});
