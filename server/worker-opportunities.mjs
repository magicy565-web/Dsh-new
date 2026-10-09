import { randomUUID, createHash } from 'node:crypto';

/**
 * Business pipeline for source-backed buyer candidates. This is NOT an outreach
 * adapter and never transmits private data or contacts a prospect. Results from
 * remote Workers remain marked unverified until reviewed by a human.
 */
export class WorkerOpportunityError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
const fail = (status, code, message) => { throw new WorkerOpportunityError(status, code, message); };
const record = value => value && typeof value === 'object' && !Array.isArray(value);
const only = (value, keys) => record(value) && Object.keys(value).every(key => keys.includes(key));
const ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const hasId = value => typeof value === 'string' && ID.test(value);
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const now = () => new Date().toISOString();
const requireOrder = (state, id) => {
  const order = (state.workerOrders || []).find(item => item.id === id);
  if (!order) fail(404, 'WORK_ORDER_NOT_FOUND', 'The source Worker order was not found.');
  return order;
};
const requireOpportunity = (state, id) => {
  const item = (state.workerOpportunities || []).find(item => item.id === id);
  if (!item) fail(404, 'OPPORTUNITY_NOT_FOUND', 'Business opportunity was not found.');
  return item;
};
const normalization = prospect => {
  const url = new URL(prospect.website);
  return prospect.name.normalize('NFKC').trim().toLocaleLowerCase() + '|' + url.hostname.toLowerCase().replace(/^www\./, '');
};
const requireAcceptedBuyers = (state, orderId) => {
  const order = requireOrder(state, orderId);
  if (order.status !== 'accepted' || order.serviceId !== 'buyer-discovery' ||
      !Array.isArray(order.workerReport?.prospects) || !order.workerReport.prospects.length ||
      typeof order.deliveryArtifactId !== 'string') {
    fail(409, 'DELIVERY_NOT_ACCEPTED', 'Only buyer discovery with a saved, accepted Worker delivery can enter the opportunity pipeline.');
  }
  return order;
};

export function createWorkerOpportunityService({ store, maxOpportunities = 5000 } = {}) {
  if (typeof store?.read !== 'function' || typeof store?.update !== 'function') throw new TypeError('Worker opportunities require the existing durable Workspace store.');
  if (!Number.isSafeInteger(maxOpportunities) || maxOpportunities < 1) throw new TypeError('Invalid opportunity capacity.');
  const list = () => (store.read().workerOpportunities || []);
  const get = id => requireOpportunity(store.read(), id);
  return {
    list, get,
    /**
     * Batch import is one atomic store transaction. Every candidate retains
     * sourceOrderId, the exact Worker row index and its original source URL.
     * Same company/website across orders is deduplicated, not relabeled.
     */
    importFromOrder(orderId, input, actor) {
      if (!hasId(orderId) || !hasId(actor) ||
          !only(input, ['indices', 'requestId', 'confirmed']) || input.confirmed !== true ||
          !hasId(input.requestId) || !Array.isArray(input.indices) ||
          !input.indices.length || input.indices.length > 100 ||
          !input.indices.every(value => Number.isSafeInteger(value) && value >= 0) ||
          new Set(input.indices).size !== input.indices.length) {
        fail(400, 'INVALID_IMPORT', 'Confirm distinct source rows and a stable request ID.');
      }
      const sorted = [...input.indices].sort((a, b) => a - b);
      const fingerprint = hash({ orderId, sorted, actor });
      return store.update(state => {
        state.workerOpportunities ??= [];
        const order = requireAcceptedBuyers(state, orderId);
        if (sorted.at(-1) >= order.workerReport.prospects.length) fail(400, 'INVALID_IMPORT', 'A selected candidate row does not exist.');
        order.opportunityImports ??= [];
        const previous = order.opportunityImports.find(row => row.requestId === input.requestId);
        if (previous) {
          if (previous.fingerprint !== fingerprint) fail(409, 'IDEMPOTENCY_CONFLICT', 'The import request ID already refers to different source rows.');
          return { importedIds: previous.importedIds, duplicate: true, createdCount: previous.createdCount };
        }
        if (order.opportunityImports.length >= 200) fail(409, 'IMPORT_LIMIT', 'This accepted delivery has reached its import limit.');
        const at = now(), importedIds = [];
        let createdCount = 0;
        for (const index of sorted) {
          const prospect = order.workerReport.prospects[index];
          if (!record(prospect) || !prospect.name || !prospect.website || !prospect.sourceUrl || !prospect.fitReason)
            fail(409, 'SOURCE_INVALID', 'The selected Worker source record is incomplete.');
          const key = normalization(prospect);
          const existing = state.workerOpportunities.find(row => row.sourceOrderId === orderId && row.sourceProspectIndex === index) ||
            state.workerOpportunities.find(row => row.duplicateKey === key);
          if (existing) { importedIds.push(existing.id); continue; }
          if (state.workerOpportunities.length >= maxOpportunities)
            fail(409, 'OPPORTUNITY_LIMIT', 'The enterprise opportunity storage limit has been reached.');
          const item = {
            id: randomUUID(), status: 'candidate', verification: 'external_unverified',
            name: prospect.name, country: prospect.country, website: prospect.website,
            fitReason: prospect.fitReason, sourceUrl: prospect.sourceUrl,
            sourceOrderId: orderId, sourceProspectIndex: index,
            sourceArtifactId: order.deliveryArtifactId,
            duplicateKey: key, importedAt: at, importedBy: actor,
            reviewedAt: null, reviewedBy: null, reviewNotes: '',
            createdAt: at, updatedAt: at,
          };
          state.workerOpportunities.push(item);
          importedIds.push(item.id);
          createdCount++;
        }
        order.opportunityImports.push({
          requestId: input.requestId, fingerprint, indices: sorted, importedIds, createdCount,
          actor, at,
        });
        return { importedIds, createdCount, duplicate: false };
      });
    },
    review(id, input, actor) {
      if (!hasId(id) || !hasId(actor) ||
          !only(input, ['decision', 'notes', 'confirmed']) ||
          input.confirmed !== true || !['qualified', 'rejected'].includes(input.decision) ||
          (input.decision === 'qualified' && (!input.notes || typeof input.notes !== 'string' || !input.notes.trim())) ||
          (input.notes !== undefined && (typeof input.notes !== 'string' || input.notes.length > 1000 ||
            /[\u0000-\u001f]/u.test(input.notes)))) {
        fail(400, 'INVALID_REVIEW', 'Choose a qualification decision and confirm it.');
      }
      return store.update(state => {
        const item = requireOpportunity(state, id);
        if (item.status !== 'candidate') fail(409, 'OPPORTUNITY_ALREADY_REVIEWED', 'This opportunity already has a review decision.');
        item.status = input.decision;
        // Human review is not independent verification of the remote source.
        item.verification = 'human_reviewed_external_claim';
        item.reviewNotes = (input.notes || '').trim();
        item.reviewedBy = actor;
        item.reviewedAt = now();
        item.updatedAt = item.reviewedAt;
        return { opportunity: item };
      });
    },
  };
}
