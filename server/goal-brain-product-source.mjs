import { clone, digest, fail } from '../plugins/workspace-goal-intelligence/src/contracts.mjs';

const PREFIX = 'product-completeness:';
const FIELDS = ['metricType','asOf','total','active','complete','incomplete','archived','missingImages','missingSkus','missingDocuments','missingSupply'];
const SUPPLY_FIELDS = ['packaging','samplePolicy','paymentTerms','shippingTerms','capacityNote'];

function text(value) { return typeof value === 'string' && value.trim().length > 0; }
function publicReference(product) { return product?.source?.kind === 'public_reference'; }
function supplyMissing(product) {
  if (publicReference(product)) return false;
  const supply = product?.supply || {};
  return SUPPLY_FIELDS.some(key => !text(supply[key]));
}
function productIncomplete(product) {
  return !text(product?.name) || !text(product?.description) || !text(product?.category)
    || !Array.isArray(product?.skus) || product.skus.length === 0
    || !Array.isArray(product?.images) || product.images.length === 0
    || !Array.isArray(product?.documents) || product.documents.length === 0
    || supplyMissing(product);
}

function snapshot(store, workspaceId, clock) {
  const state = store.read();
  if (!state?.businessLibrary) return { state, values: null, reference: null };
  const boundWorkspace = workspaceId || 'local';
  const products = Array.isArray(state.businessLibrary.products) ? state.businessLibrary.products : [];
  const activeProducts = products.filter(product => product?.status !== 'archived');
  const incomplete = activeProducts.filter(productIncomplete);
  const values = {
    metricType: 'product-completeness-v1',
    asOf: new Date(Math.floor(Number(clock()) / 3_600_000) * 3_600_000).toISOString(),
    total: products.length,
    active: activeProducts.length,
    complete: activeProducts.length - incomplete.length,
    incomplete: incomplete.length,
    archived: products.length - activeProducts.length,
    missingImages: activeProducts.filter(product => !Array.isArray(product?.images) || product.images.length === 0).length,
    missingSkus: activeProducts.filter(product => !Array.isArray(product?.skus) || product.skus.length === 0).length,
    missingDocuments: activeProducts.filter(product => !Array.isArray(product?.documents) || product.documents.length === 0).length,
    missingSupply: activeProducts.filter(supplyMissing).length,
  };
  const revision = String(state.meta?.sequence ?? 0);
  const reference = { kind:'metric', id:PREFIX + 'all', revision, sha256:digest(values), fields:clone(FIELDS) };
  return { state, workspaceId:boundWorkspace, values, reference };
}

export function createBusinessBrainProductSourceAdapter({ store, workspaceId = 'local', clock = Date.now } = {}) {
  if (!store?.read || typeof clock !== 'function') throw new TypeError('The original Workspace store and a clock are required.');
  function checked(identity) {
    const boundWorkspace = workspaceId || 'local';
    if (!identity?.workspaceId || identity.workspaceId !== boundWorkspace) fail('BRAIN_SOURCE_SCOPE_MISMATCH');
    return snapshot(store, boundWorkspace, clock);
  }
  async function list({ identity } = {}) {
    const snap = checked(identity);
    return snap.reference ? [snap.reference] : [];
  }
  async function read({ identity, reference, signal } = {}) {
    signal?.throwIfAborted();
    const snap = checked(identity);
    if (!snap.reference || reference?.kind !== 'metric' || reference.id !== snap.reference.id || reference.revision !== snap.reference.revision || reference.sha256 !== snap.reference.sha256 || JSON.stringify(reference.fields) !== JSON.stringify(snap.reference.fields)) fail('BRAIN_SOURCE_CHANGED');
    signal?.throwIfAborted();
    return { workspaceId: snap.workspaceId, reference: snap.reference, observedAt: snap.values.asOf, validUntil:null, values:snap.values };
  }
  function current({ identity, reference, expected } = {}) {
    const snap = checked(identity);
    if (!snap.reference || !expected || expected.workspaceId !== snap.workspaceId || JSON.stringify(expected.reference) !== JSON.stringify(snap.reference)) fail('BRAIN_SOURCE_CHANGED');
    return { workspaceId:snap.workspaceId, reference:snap.reference, observedAt:snap.values.asOf, validUntil:null, values:snap.values };
  }
  return Object.freeze({ list, read, current });
}