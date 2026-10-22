import assert from 'node:assert/strict';
import test from 'node:test';
import { analyzeBusinessSources } from '../plugins/workspace-goal-intelligence/src/diagnostics.mjs';
import { extractBusinessSignals } from '../plugins/workspace-goal-intelligence/src/signals.mjs';
import { createBusinessBrainSourceAdapter, composeBusinessBrainSourceAdapters } from '../server/business-brain-source-adapter.mjs';
import { assessOutcome } from '../plugins/workspace-goal-intelligence/src/economics.mjs';
import { createSupplierCommerceBrainSourceAdapter } from '../server/goal-brain-supplier-source.mjs';

const now = Date.parse('2026-10-16T00:00:00.000Z');

function metric(id, values) {
  return {
    evidenceId: `metric:${id}`,
    observedAt: '2026-10-16T00:00:00.000Z',
    reference: { kind: 'metric', id, revision: '1', sha256: 'fixture', fields: Object.keys(values) },
    values
  };
}

test('business diagnostics turns inquiry aging and product completeness into evidence-first signals', () => {
  const results = analyzeBusinessSources([
    metric('supply-inquiry-aging', {
      metricType: 'inquiry-aging-v1',
      windowStart: '2026-09-16T00:00:00.000Z',
      windowEnd: '2026-10-15T23:59:59.999Z',
      eligible: 8,
      progressed: 3,
      pending: 5,
      stale: 2,
      staleThresholdDays: 7
    }),
    metric('library-product-completeness', {
      metricType: 'product-completeness-v1',
      asOf: '2026-10-16T00:00:00.000Z',
      total: 6,
      active: 5,
      complete: 3,
      incomplete: 2,
      archived: 1,
      missingImages: 1,
      missingSkus: 1,
      missingDocuments: 2,
      missingSupply: 1
    })
  ], now);

  assert.equal(results.status, 'measured');
  assert.equal(results.signals.find(item => item.kind === 'inquiry-aging')?.current.stale, 2);
  assert.equal(results.signals.find(item => item.kind === 'product-completeness')?.current.incomplete, 2);
  assert.equal(results.businessSignals[0].type, 'followup-aging');
  assert.equal(results.businessSignals[0].priority, 96);
});

test('source adapter exposes only bounded inquiry and product metrics', async () => {
  const state = {
    meta: { sequence: 7 },
    supplyNetwork: {
      inquiries: [
        { workspaceId: 'ws', createdAt: '2026-09-20T00:00:00.000Z', updatedAt: '2026-09-20T00:00:00.000Z', status: 'shared', replies: [] },
        { workspaceId: 'ws', createdAt: '2026-10-10T00:00:00.000Z', updatedAt: '2026-10-10T00:00:00.000Z', status: 'replied', replies: [{ id: 'r1' }] }
      ]
    },
    businessLibrary: {
      products: [{
        status: 'draft',
        description: 'Product',
        category: 'Fabric',
        skus: [{ id: 'sku', code: 'A', specs: [], unit: 'm', moq: null, pricingMode: 'unset', pricingNote: '', priceTiers: [], leadTimeDays: null }],
        images: [{ id: 'image' }],
        documents: [{ documentId: 'doc', documentVersion: 1, purpose: 'spec' }],
        supply: { country: 'CN', warehouse: 'Factory', capacity: '1000', leadTime: '20' }
      }]
    }
  };
  const adapter = createBusinessBrainSourceAdapter({ store: { read: () => state }, workspaceId: 'ws', clock: () => now });
  const refs = await adapter.list({ identity: { workspaceId: 'ws' } });
  assert.deepEqual(refs.map(ref => ref.id), [
    'supply-inquiry-pipeline',
    'supply-inquiry-aging',
    'library-product-completeness'
  ]);
  const agingRef = refs.find(ref => ref.id === 'supply-inquiry-aging');
  const read = await adapter.read({ identity: { workspaceId: 'ws' }, reference: agingRef });
  assert.equal(read.values.eligible, 2);
  assert.equal(read.values.pending, 1);
  assert.equal(read.values.stale, 1);
  assert.equal(read.values.staleThresholdDays, 7);
  assert.equal(read.values.metricType, 'inquiry-aging-v1');
});


test('source adapter composition is fail-closed and keeps current synchronous', async () => {
  let currentArgs = null;
  const primary = {
    list: async () => [{ kind: 'metric', id: 'primary', revision: '1', sha256: 'a', fields: [] }],
    read: async args => ({ workspaceId: args.identity.workspaceId, reference: args.reference, observedAt: '2026-10-16T00:00:00.000Z', validUntil: null, values: { metricType: 'primary' } }),
    current: args => { currentArgs = args; return { workspaceId: args.identity.workspaceId, reference: args.reference, observedAt: '2026-10-16T00:00:00.000Z', validUntil: null, values: { metricType: 'primary' } }; }
  };
  const extra = {
    list: async () => [{ kind: 'metric', id: 'cohort:m1:r1', revision: '1', sha256: 'b', fields: [] }],
    read: async args => ({ workspaceId: args.identity.workspaceId, reference: args.reference, observedAt: '2026-10-16T00:00:00.000Z', validUntil: null, values: { metricType: 'commerce-product-cohort-v1' } }),
    current: args => ({ workspaceId: args.identity.workspaceId, reference: args.reference, observedAt: '2026-10-16T00:00:00.000Z', validUntil: null, values: { metricType: 'commerce-product-cohort-v1' } })
  };
  const composite = composeBusinessBrainSourceAdapters({ primary, extras: [{ prefix: 'supplier:', adapter: extra }] });
  const refs = await composite.list({ identity: { workspaceId: 'ws' }, binding: { conversationId: 'c' }, receiver: 'r' });
  assert.equal(refs.length, 2);
  const result = composite.current({ identity: { workspaceId: 'ws' }, binding: { conversationId: 'c' }, receiver: 'r', reference: refs[0], expected: { workspaceId: 'ws', reference: refs[0] } });
  assert.equal(result.values.metricType, 'primary');
  assert.equal(currentArgs.receiver, 'r');

  const duplicate = {
    ...extra,
    list: async () => [{ kind: 'metric', id: 'primary', revision: '2', sha256: 'c', fields: [] }]
  };
  const conflicting = composeBusinessBrainSourceAdapters({ primary, extras: [{ prefix: 'commerce-cohort:', adapter: duplicate }] });
  await assert.rejects(() => conflicting.list({ identity: { workspaceId: 'ws' }, binding: { conversationId: 'c' } }), /BRAIN_SOURCE_ID_CONFLICT/);
});

test('supplier commerce cohort refuses impossible sales counts', async () => {
  const supplierService = {
    forActor: () => ({
      list: () => [{ id: 'svc' }],
      monitors: () => [{
        id: 'm1',
        scope: { productId: 'p1' },
        checks: [{
          requestId: 'r1',
          sample: {
            salesStatus: 'available',
            sampledAt: '2026-10-16T00:00:00.000Z',
            coverage: { from: '2026-09-01T00:00:00.000Z', to: '2026-10-01T00:00:00.000Z' },
            sales: { grossOrders: 2, retainedOrders: 3 }
          }
        }]
      }]
    })
  };
  const adapter = createSupplierCommerceBrainSourceAdapter({ supplierService });
  await assert.rejects(() => adapter.list({ identity: { subject: 'u', workspaceId: 'ws' }, binding: { conversationId: 'c' } }), /BRAIN_SOURCE_SCOPE_MISMATCH/);
});

test('source revisions stay stable between refreshes when business data is unchanged', async () => {
  const state = {
    supplyNetwork: { inquiries: [] },
    businessLibrary: { products: [] }
  };
  let clock = Date.parse('2026-10-16T02:00:00.000Z');
  const adapter = createBusinessBrainSourceAdapter({ store: { read: () => state }, workspaceId: 'ws', clock: () => clock });
  const refs = await adapter.list({ identity: { workspaceId: 'ws' } });
  const first = await adapter.read({ identity: { workspaceId: 'ws' }, reference: refs[0] });
  clock = Date.parse('2026-10-16T18:00:00.000Z');
  const second = adapter.current({ identity: { workspaceId: 'ws' }, reference: refs[0], expected: first });
  assert.deepEqual(second, first);
});

test('composed adapters namespace extra metric sources without changing the inner adapter', async () => {
  const primary = createBusinessBrainSourceAdapter({ store: { read: () => ({ supplyNetwork: { inquiries: [] }, businessLibrary: { products: [] } }) }, workspaceId: 'ws', clock: () => now });
  const extraRef = { kind: 'metric', id: 'sales', revision: '1', sha256: 'fixture', fields: ['metricType'] };
  const extra = {
    async list() { return [extraRef]; },
    async read({ reference }) { return { workspaceId: 'ws', reference, observedAt: '2026-10-16T00:00:00.000Z', validUntil: null, values: { metricType: 'fixture-v1' } }; },
    current({ reference, expected }) { return { workspaceId: 'ws', reference, observedAt: expected.observedAt, validUntil: null, values: { metricType: 'fixture-v1' } }; }
  };
  const { composeBusinessBrainSourceAdapters } = await import('../server/business-brain-source-adapter.mjs');
  const composed = composeBusinessBrainSourceAdapters({ primary, extras: [{ prefix: 'fixture:', adapter: extra }] });
  const refs = await composed.list({ identity: { workspaceId: 'ws' } });
  assert.equal(refs.some(ref => ref.id === 'fixture:sales'), true);
  const read = await composed.read({ identity: { workspaceId: 'ws' }, reference: refs.find(ref => ref.id === 'fixture:sales') });
  assert.equal(read.reference.id, 'fixture:sales');
});

// The observation window must be a property of the business data, not of the
// wall clock: otherwise every saved context and decision goes stale at the next
// UTC midnight even when nothing in the business changed.
test('observation window and revision survive a UTC day boundary when data is unchanged', async () => {
  const state = {
    meta: { sequence: 1, createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z' },
    supplyNetwork: {
      inquiries: [{ workspaceId: 'ws', createdAt: '2026-10-08T00:00:00.000Z', updatedAt: '2026-10-08T00:00:00.000Z', status: 'replied', replies: [{ id: 'r1' }] }]
    },
    businessLibrary: { products: [] }
  };
  let clock = Date.parse('2026-10-16T02:00:00.000Z');
  const adapter = createBusinessBrainSourceAdapter({ store: { read: () => state }, workspaceId: 'ws', clock: () => clock });
  const refs = await adapter.list({ identity: { workspaceId: 'ws' } });
  const first = await adapter.read({ identity: { workspaceId: 'ws' }, reference: refs[0] });
  clock = Date.parse('2026-10-17T23:00:00.000Z');
  const next = await adapter.read({ identity: { workspaceId: 'ws' }, reference: refs[0] });
  assert.deepEqual(next, first);
  const current = adapter.current({ identity: { workspaceId: 'ws' }, reference: refs[0], expected: first });
  assert.deepEqual(current, first);
});

// A reference pins the window it was taken over. Later business activity moves
// the *current* catalog, but must not silently re-describe an earlier decision's
// evidence: that is what used to make every saved decision stale.
test('a pinned reference keeps its own window after new business activity', async () => {
  const state = {
    meta: { sequence: 1, createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z' },
    supplyNetwork: { inquiries: [] },
    businessLibrary: { products: [] }
  };
  let clock = Date.parse('2026-10-16T02:00:00.000Z');
  const adapter = createBusinessBrainSourceAdapter({ store: { read: () => state }, workspaceId: 'ws', clock: () => clock });
  const refs = await adapter.list({ identity: { workspaceId: 'ws' } });
  const first = await adapter.read({ identity: { workspaceId: 'ws' }, reference: refs[0] });
  state.supplyNetwork.inquiries.push({ workspaceId: 'ws', createdAt: '2026-10-15T09:00:00.000Z', updatedAt: '2026-10-15T09:00:00.000Z', status: 'shared', replies: [] });
  clock = Date.parse('2026-10-17T02:00:00.000Z');
  const replay = await adapter.read({ identity: { workspaceId: 'ws' }, reference: refs[0] });
  assert.deepEqual(replay, first);
  assert.deepEqual(adapter.current({ identity: { workspaceId: 'ws' }, reference: refs[0], expected: first }), first);
  const moved = (await adapter.list({ identity: { workspaceId: 'ws' } }))[0];
  assert.ok(Date.parse(moved.windowEnd) > Date.parse(refs[0].windowEnd));
  assert.notEqual(moved.revision, refs[0].revision);
});

test('a pinned window is refused once its own underlying data changes', async () => {
  const state = {
    meta: { sequence: 1, createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z' },
    supplyNetwork: { inquiries: [] },
    businessLibrary: { products: [] }
  };
  let clock = Date.parse('2026-10-16T02:00:00.000Z');
  const adapter = createBusinessBrainSourceAdapter({ store: { read: () => state }, workspaceId: 'ws', clock: () => clock });
  const refs = await adapter.list({ identity: { workspaceId: 'ws' } });
  const first = await adapter.read({ identity: { workspaceId: 'ws' }, reference: refs[0] });
  // Backfill a row *inside* the pinned window: replaying it can no longer
  // reproduce the bytes that were recorded over.
  const inside = new Date((Date.parse(first.values.windowStart) + Date.parse(first.values.windowEnd)) / 2).toISOString();
  state.supplyNetwork.inquiries.push({ workspaceId: 'ws', createdAt: inside, updatedAt: inside, status: 'replied', replies: [{ id: 'late' }] });
  clock = Date.parse('2026-10-17T02:00:00.000Z');
  await assert.rejects(() => adapter.read({ identity: { workspaceId: 'ws' }, reference: refs[0] }), /BRAIN_SOURCE_CHANGED/);
});

test('a reference without a pinned window, or with a window this adapter cannot emit, is refused', async () => {
  const state = {
    meta: { sequence: 1, createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z' },
    supplyNetwork: { inquiries: [] },
    businessLibrary: { products: [] }
  };
  const clock = Date.parse('2026-10-16T02:00:00.000Z');
  const adapter = createBusinessBrainSourceAdapter({ store: { read: () => state }, workspaceId: 'ws', clock: () => clock });
  const identity = { workspaceId: 'ws' };
  const [ref] = await adapter.list({ identity });
  const { windowStart, windowEnd, ...unpinned } = ref;
  await assert.rejects(() => adapter.read({ identity, reference: unpinned }), /BRAIN_SOURCE_CHANGED/);
  const shifted = { ...ref, windowStart: new Date(Date.parse(windowStart) + 86400000).toISOString(), windowEnd: new Date(Date.parse(windowEnd) + 86400000).toISOString() };
  await assert.rejects(() => adapter.read({ identity, reference: shifted }), /BRAIN_SOURCE_CHANGED/);
  const shortened = { ...ref, windowStart: new Date(Date.parse(windowStart) + 86400000).toISOString() };
  await assert.rejects(() => adapter.read({ identity, reference: shortened }), /BRAIN_SOURCE_CHANGED/);
});

// The decision layer rejects anything that is not a complete observation. These
// assertions keep the adapter payload on that contract instead of drifting into
// a shape that only test fixtures can satisfy.
test('primary metrics carry the observation contract the decision layer verifies', async () => {
  const now = Date.parse('2026-10-16T02:00:00.000Z');
  const state = {
    meta: { sequence: 1, createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z' },
    supplyNetwork: {
      inquiries: [
        { workspaceId: 'ws', createdAt: '2026-09-20T00:00:00.000Z', updatedAt: '2026-09-20T00:00:00.000Z', status: 'replied', replies: [{ id: 'r1' }] },
        { workspaceId: 'ws', createdAt: '2026-09-21T00:00:00.000Z', updatedAt: '2026-09-21T00:00:00.000Z', status: 'replied', replies: [{ id: 'r2' }] }
      ]
    },
    businessLibrary: { products: [] }
  };
  const adapter = createBusinessBrainSourceAdapter({ store: { read: () => state }, workspaceId: 'ws', clock: () => now });
  const refs = await adapter.list({ identity: { workspaceId: 'ws' } });
  const pipeline = await adapter.read({ identity: { workspaceId: 'ws' }, reference: refs.find(ref => ref.id === 'supply-inquiry-pipeline') });
  assert.deepEqual(Object.keys(pipeline.values).sort(), [...refs.find(ref => ref.id === 'supply-inquiry-pipeline').fields].sort());
  assert.equal(pipeline.values.id, 'supply-inquiry-pipeline');
  assert.equal(pipeline.values.value, 2);
  assert.equal(pipeline.values.unit, 'inquiries');
  assert.equal(pipeline.values.coverageComplete, true);

  const decisionAt = Date.parse(pipeline.values.windowStart) - 86400000;
  const complete = assessOutcome(pipeline.values, { metricId: 'supply-inquiry-pipeline', observationDays: 7 }, decisionAt, now);
  assert.equal(complete.status, 'observed-not-adjudicated');
  assert.equal(complete.sufficientEvidence, true);
  assert.equal(complete.businessGoalVerified, false);
  assert.equal(complete.causalEffect, null);

  // A pending cohort member is incomplete coverage, never a silent success.
  state.supplyNetwork.inquiries.push({ workspaceId: 'ws', createdAt: '2026-09-22T00:00:00.000Z', updatedAt: '2026-09-22T00:00:00.000Z', status: 'shared', replies: [] });
  const pendingRefs = await adapter.list({ identity: { workspaceId: 'ws' } });
  const pending = await adapter.read({ identity: { workspaceId: 'ws' }, reference: pendingRefs.find(ref => ref.id === 'supply-inquiry-pipeline') });
  const incomplete = assessOutcome(pending.values, { metricId: 'supply-inquiry-pipeline', observationDays: 7 }, decisionAt, now);
  assert.equal(incomplete.status, 'insufficient-evidence');
  assert.equal(incomplete.sufficientEvidence, false);
});

test('a point-in-time product snapshot never authorizes a supported outcome review', async () => {
  const now = Date.parse('2026-10-16T02:00:00.000Z');
  const state = {
    meta: { sequence: 1, createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z' },
    supplyNetwork: { inquiries: [] },
    businessLibrary: { products: [{ status: 'draft', updatedAt: '2026-10-10T00:00:00.000Z' }] }
  };
  const adapter = createBusinessBrainSourceAdapter({ store: { read: () => state }, workspaceId: 'ws', clock: () => now });
  const refs = await adapter.list({ identity: { workspaceId: 'ws' } });
  const product = await adapter.read({ identity: { workspaceId: 'ws' }, reference: refs.find(ref => ref.id === 'library-product-completeness') });
  const assessment = assessOutcome(product.values, { metricId: 'library-product-completeness', observationDays: 7 }, Date.parse(product.values.windowStart) - 86400000, now);
  assert.equal(assessment.status, 'insufficient-evidence');
  assert.equal(assessment.sufficientEvidence, false);
});
