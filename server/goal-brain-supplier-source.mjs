import { clone, digest, fail } from '../plugins/workspace-goal-intelligence/src/contracts.mjs';

const ID = /^commerce-cohort:([A-Za-z0-9-]{1,80}):([A-Za-z0-9_-]{1,96})$/u;
const fields = ['metricType','windowStart','windowEnd','eligible','converted','pending','unknown','segment','baseline'];

function valuesFor(monitor, check, baseline) {
  const sample = check?.sample;
  if (!sample || sample.salesStatus !== 'available' || !sample.sales) return null;
  const from = sample.coverage?.from, to = sample.coverage?.to;
  if (typeof from !== 'string' || typeof to !== 'string' || !Number.isFinite(Date.parse(from)) || !Number.isFinite(Date.parse(to)) || Date.parse(from) >= Date.parse(to))
    fail('BRAIN_SOURCE_CHANGED');
  const sales = sample.sales;
  for (const key of ['grossOrders','retainedOrders']) if (!Number.isSafeInteger(sales[key]) || sales[key] < 0) fail('BRAIN_SOURCE_SCOPE_MISMATCH');
  if (sales.retainedOrders > sales.grossOrders) fail('BRAIN_SOURCE_SCOPE_MISMATCH');
  return {
    metricType: 'commerce-product-cohort-v1',
    windowStart: from, windowEnd: to,
    eligible: sales.grossOrders, converted: sales.retainedOrders, pending: 0, unknown: 0,
    segment: { productId: monitor.scope.productId, market: 'shopify', channel: 'owned-store' },
    baseline: baseline ? valuesFor(monitor, baseline, null) : null,
  };
}

function findActorMonitor(supplierService, identity, binding, monitorId, requestId = null) {
  const actor = { subject: identity.subject, workspaceId: identity.workspaceId, role: identity.role, sessionId: identity.sessionId };
  const bound = supplierService.forActor(actor);
  const services = bound.list(binding.conversationId);
  for (const service of services) {
    for (const monitor of bound.monitors(binding.conversationId, service.id) || []) {
      if (monitor.id !== monitorId) continue;
      const check = (monitor.checks || []).find(item => requestId === null ? item.sample?.salesStatus === 'available' : item.requestId === requestId);
      if (!check) return null;
      return { monitor, check, service };
    }
  }
  return null;
}

function previousCheck(monitor, current) {
  const start = Date.parse(current.sample.coverage.from);
  return (monitor.checks || [])
    .filter(item => item.requestId !== current.requestId && item.sample?.salesStatus === 'available' && Number.isFinite(Date.parse(item.sample.coverage?.to)) && Date.parse(item.sample.coverage.to) <= start)
    .sort((a,b) => Date.parse(b.sample.coverage.to) - Date.parse(a.sample.coverage.to))[0] || null;
}

function refFor(monitor, check) {
  const values = valuesFor(monitor, check, previousCheck(monitor, check));
  if (!values) return null;
  return { kind:'metric', id:`commerce-cohort:${monitor.id}:${check.requestId}`, revision:check.sample.sampledAt,
    sha256:digest(values), fields:clone(fields) };
}

export function createSupplierCommerceBrainSourceAdapter({ supplierService } = {}) {
  if (!supplierService?.forActor) throw new TypeError('The existing Supplier Service is required.');
  async function list({ identity, binding }) {
    const actor = { subject: identity.subject, workspaceId: identity.workspaceId, role: identity.role, sessionId: identity.sessionId };
    const bound = supplierService.forActor(actor), refs = [];
    for (const service of bound.list(binding.conversationId) || []) {
      for (const monitor of bound.monitors(binding.conversationId, service.id) || []) {
        const check = [...(monitor.checks || [])]
          .filter(item => item?.sample?.salesStatus === 'available')
          .sort((a, b) => Date.parse(b.sample.sampledAt) - Date.parse(a.sample.sampledAt))[0];
        if (check) {
          const ref = refFor(monitor, check); if (ref) refs.push(ref);
        }
      }
    }
    return refs;
  }
  async function read({ identity, binding, reference, signal }) {
    signal?.throwIfAborted();
    const match = ID.exec(reference?.id || ''); if (reference?.kind !== 'metric' || !match) fail('BRAIN_SOURCE_NOT_SELECTED');
    const found = findActorMonitor(supplierService, identity, binding, match[1], match[2]);
    if (!found) fail('BRAIN_SOURCE_CHANGED');
    const baseline = previousCheck(found.monitor, found.check);
    const values = valuesFor(found.monitor, found.check, baseline);
    const ref = refFor(found.monitor, found.check);
    if (!values || !ref || !reference || reference.revision !== ref.revision || reference.sha256 !== ref.sha256 || JSON.stringify(reference.fields) !== JSON.stringify(ref.fields))
      fail('BRAIN_SOURCE_CHANGED');
    return { workspaceId:identity.workspaceId, reference:ref, observedAt:found.check.sample.sampledAt, validUntil:null, values };
  }
  function current({ identity, binding, reference, expected }) {
    const match = ID.exec(reference?.id || ''); if (reference?.kind !== 'metric' || !match) fail('BRAIN_SOURCE_NOT_SELECTED');
    const found = findActorMonitor(supplierService, identity, binding, match[1], match[2]);
    if (!found) fail('BRAIN_SOURCE_CHANGED');
    const ref = refFor(found.monitor, found.check);
    const values = valuesFor(found.monitor, found.check, previousCheck(found.monitor, found.check));
    if (!values || !ref || !expected || JSON.stringify(expected.reference) !== JSON.stringify(ref)) fail('BRAIN_SOURCE_CHANGED');
    return { workspaceId:identity.workspaceId, reference:ref, observedAt:found.check.sample.sampledAt, validUntil:null, values };
  }
  return Object.freeze({ list, read, current });
}
