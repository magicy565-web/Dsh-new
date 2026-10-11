import { createHash, randomUUID } from 'node:crypto';

/**
 * Productized services, not conversational personas. The prices below are
 * minimum authorization envelopes in internal credits, NOT USD or a quotation.
 * Only the host may register executable workers. No user-supplied URL or token.
 */
export const WORKER_SERVICES = Object.freeze([
  {
    id: 'buyer-discovery', title: '海外经销商开发', category: '市场开发',
    description: '按目标国家和产品寻找可核验的潜在分销商。',
    deliverables: ['可追溯的买手名单', '匹配理由与来源证据', '优先联系建议'],
    acceptance: ['每个候选对象有官网或公开来源', '去重并注明匹配依据', '标识未经核实的联系方式'],
    minimumCredits: 5, dataMode: 'public', icon: 'globe',
  },
  {
    id: 'channel-validation', title: '海外销售渠道验证', category: '渠道增长',
    description: '比较电商与批发渠道，提供可执行的进入建议。',
    deliverables: ['渠道优先级报告', '竞争产品与价格证据', '30 天验证计划'],
    acceptance: ['标注数据抓取日期与出处', '分清推断与可核实事实', '明确试验成本及退出标准'],
    minimumCredits: 5, dataMode: 'public', icon: 'layers',
  },
  {
    id: 'sales-assets', title: '海外销售素材包', category: '内容增长',
    description: '整理产品价值、买手话术与落地页草稿。',
    deliverables: ['英文销售介绍', 'FAQ 与卖点结构', 'Landing Page 内容草稿'],
    acceptance: ['产品事实可追溯', '不捏造认证、销量与客户案例', '输出可编辑文件或结构化结果'],
    minimumCredits: 4, dataMode: 'public', icon: 'file',
  },
  {
    id: 'rfq-recovery', title: '历史询盘捞回', category: '销售转化',
    description: '从旧询盘发现高价值客户及下一步跟进机会。',
    deliverables: ['询盘去重和客户档案', '可核验的采购意向线索', '待审批的跟进任务'],
    acceptance: ['企业私有询盘不离开授权边界', '对客户判断提供证据', '任何对外发送都需要单独批准'],
    minimumCredits: 8, dataMode: 'private-review-required', icon: 'inbox',
  },
]);

const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const keysOnly = (v, keys) => isObject(v) && Object.keys(v).every(k => keys.includes(k));
const identifier = value => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$/.test(value);
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const now = () => new Date().toISOString();

export class WorkerDeskError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
const fail = (status, code, message) => { throw new WorkerDeskError(status, code, message); };
const safeText = (value, field, maximum) => {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum ||
      /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(value)) fail(400, 'INVALID_INPUT', field + ' is required and must be plain text.');
  return value.trim();
};
const findService = id => WORKER_SERVICES.find(item => item.id === id);
const deadlineValue = value => {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) fail(400, 'INVALID_DEADLINE', 'A valid deadline is required.');
  const date = Date.parse(value);
  if (date <= Date.now() + 60_000 || date > Date.now() + 90 * 86400_000) fail(400, 'INVALID_DEADLINE', 'Deadline must be in the next 90 days.');
  return new Date(date).toISOString();
};
const requireOrder = (state, id) => {
  const item = (state.workerOrders || []).find(order => order.id === id);
  if (!item) fail(404, 'ORDER_NOT_FOUND', 'Delegated service order was not found.');
  return item;
};
const allowedStates = new Set(['queued', 'working', 'input_required', 'completed', 'failed', 'cancelled']);
const cleanEvidence = items => {
  if (!Array.isArray(items) || items.length > 50) fail(502, 'INVALID_WORKER_RESULT', 'Worker returned an invalid evidence list.');
  return items.map(item => {
    if (!keysOnly(item, ['title', 'url', 'detail'])) fail(502, 'INVALID_WORKER_RESULT', 'Worker returned unsupported evidence fields.');
    const title = safeText(item.title, 'evidence.title', 140);
    const detail = typeof item.detail === 'string' ? item.detail.slice(0, 1200) : '';
    let url = null;
    if (item.url != null) {
      if (typeof item.url !== 'string' || item.url.length > 2048) fail(502, 'INVALID_WORKER_RESULT', 'Worker evidence URL is invalid.');
      let parsed;
      try { parsed = new URL(item.url); } catch { fail(502, 'INVALID_WORKER_RESULT', 'Worker evidence URL is invalid.'); }
      if (parsed.protocol !== 'https:' || parsed.username || parsed.password) fail(502, 'INVALID_WORKER_RESULT', 'Worker evidence must use a plain HTTPS source.');
      url = parsed.toString();
    }
    return { title, url, detail };
  });
};
const cleanDeliverables = items => {
  if (!Array.isArray(items) || items.length > 20) fail(502, 'INVALID_WORKER_RESULT', 'Worker returned an invalid deliverable list.');
  return items.map(item => {
    if (!keysOnly(item, ['name', 'type', 'summary', 'sha256', 'url'])) fail(502, 'INVALID_WORKER_RESULT', 'Worker returned unsupported deliverable fields.');
    const name = safeText(item.name, 'deliverable.name', 150);
    if (!['report', 'table', 'draft', 'file'].includes(item.type)) fail(502, 'INVALID_WORKER_RESULT', 'Unsupported deliverable type.');
    const summary = safeText(item.summary, 'deliverable.summary', 1500);
    const sha256 = item.sha256 === undefined ? null : (typeof item.sha256 === 'string' && /^[0-9a-f]{64}$/i.test(item.sha256) ? item.sha256.toLowerCase() : fail(502, 'INVALID_WORKER_RESULT', 'Invalid checksum.'));
    let url = null;
    if (item.url !== undefined) {
      let parsed;
      try { parsed = new URL(item.url); } catch { fail(502, 'INVALID_WORKER_RESULT', 'Invalid deliverable URL.'); }
      if (parsed.protocol !== 'https:' || parsed.username || parsed.password || item.url.length > 2048) fail(502, 'INVALID_WORKER_RESULT', 'Only HTTPS deliverables are accepted.');
      url = parsed.toString();
    }
    return { name, type: item.type, summary, sha256, url };
  });
};

const cleanProspects = items => {
  if (items === undefined) return [];
  if (!Array.isArray(items) || items.length > 100) fail(502, 'INVALID_WORKER_RESULT', 'Worker returned an invalid prospect collection.');
  const seen = new Set();
  return items.map(item => {
    if (!keysOnly(item, ['name', 'country', 'website', 'fitReason', 'sourceUrl']))
      fail(502, 'INVALID_WORKER_RESULT', 'Prospect contains unsupported fields.');
    const name = safeText(item.name, 'prospect.name', 180);
    const country = safeText(item.country, 'prospect.country', 100);
    const fitReason = safeText(item.fitReason, 'prospect.fitReason', 600);
    const https = (value, field) => {
      if (typeof value !== 'string' || value.length > 2048) fail(502, 'INVALID_WORKER_RESULT', field + ' must use HTTPS.');
      let url;
      try { url = new URL(value); } catch { fail(502, 'INVALID_WORKER_RESULT', field + ' must use HTTPS.'); }
      if (url.protocol !== 'https:' || url.username || url.password || !url.hostname ||
          url.hostname === 'localhost' || /^[0-9.]+$/.test(url.hostname) || url.hostname.includes(':'))
        fail(502, 'INVALID_WORKER_RESULT', field + ' must use a public HTTPS domain.');
      return url.toString();
    };
    const website = https(item.website, 'prospect.website');
    const sourceUrl = https(item.sourceUrl, 'prospect.sourceUrl');
    const key = name.toLocaleLowerCase() + '|' + new URL(website).hostname.toLowerCase();
    if (seen.has(key)) fail(502, 'INVALID_WORKER_RESULT', 'Duplicate prospects are not accepted.');
    seen.add(key);
    return { name, country, website, fitReason, sourceUrl, independentlyVerified: false };
  });
};

export function createWorkerServiceDesk({ store, adapters = {}, artifacts = null, validateActor = identifier }) {
  if (typeof store?.read !== 'function' || typeof store?.update !== 'function') throw new TypeError('Worker desk needs the existing durable workspace store.');
  if (typeof validateActor !== 'function') throw new TypeError('Worker actors require the trusted Host validator.');
  const adapterMap = new Map();
  for (const [id, adapter] of Object.entries(adapters)) {
    if (!identifier(id) || !keysOnly(adapter, ['services', 'ready', 'budgetEnforced', 'submit', 'get', 'cancel', 'reconcile', 'displayName', 'capabilities'])
      || !Array.isArray(adapter.services) || !adapter.services.every(x => !!findService(x))
      || typeof adapter.submit !== 'function' || typeof adapter.get !== 'function' || typeof adapter.cancel !== 'function'
      || typeof adapter.ready !== 'boolean' || typeof adapter.budgetEnforced !== 'boolean') throw new TypeError('Worker adapters must be explicit reviewed host registrations.');
    adapterMap.set(id, adapter);
  }
  const list = () => (store.read().workerOrders || []);
  const eligible = serviceId => [...adapterMap.entries()].filter(([, adapter]) => adapter.services.includes(serviceId) && adapter.ready && adapter.budgetEnforced).map(([id, adapter]) => ({ id, name: adapter.displayName || id, budgetEnforced: true }));
  const catalog = () => WORKER_SERVICES.map(service => ({
    ...service, workers: service.dataMode === 'public' ? eligible(service.id) : [], executable: service.dataMode === 'public' && eligible(service.id).length > 0,
    limitation: service.dataMode !== 'public' ? 'Requires separately reviewed private-data gateway' : eligible(service.id).length ? null : 'No verified third-party Worker is connected',
  }));
  const get = id => requireOrder(store.read(), id);
  const update = fn => store.update(state => { state.workerOrders ??= []; return fn(state); });
  return {
    catalog, list, get,
    // A crash may occur after the partner received the request but before
    // its acknowledgement was durably recorded. Never replay this submission.
    // Mark it as uncertain and allow only verified reconciliation.
    async recoverInterrupted() {
      if (!list().some(order => order.status === 'dispatching')) return { recovered: 0 };
      return update(state => {
        let recovered = 0;
        for (const order of state.workerOrders) {
          if (order.status !== 'dispatching') continue;
          order.status = 'dispatch_uncertain';
          order.updatedAt = now();
          order.error = {
            code: 'DISPATCH_UNCERTAIN',
            message: 'Server restarted during Worker submission. The partner may have accepted this task; reconcile the original order ID. Do not submit again.',
          };
          recovered++;
        }
        return { recovered };
      });
    },
    async create(input, actor, { attach } = {}) {
      if (attach !== undefined && typeof attach !== "function") throw new TypeError("Only a trusted synchronous order mapping hook is allowed.");
      const map = (state, order, duplicate) => { if (attach?.(state, order, duplicate)?.then) throw new TypeError("Order mapping must stay inside the synchronous durable transaction."); };
      if (!keysOnly(input, ['serviceId', 'product', 'market', 'objective', 'budgetCredits', 'deadlineAt', 'requestId', 'publicDataConfirmed', 'workerId']))
        fail(400, 'INVALID_INPUT', 'Unrecognized delegation fields.');
      const service = findService(input.serviceId);
      if (!service) fail(404, 'SERVICE_NOT_FOUND', 'Choose a published service.');
      if (service.dataMode !== 'public') fail(409, 'PRIVATE_GATEWAY_REQUIRED', 'Private enterprise data cannot be delegated until an isolated, reviewed gateway is ready.');
      if (!validateActor(actor) || !identifier(input.requestId)) fail(400, 'INVALID_INPUT', 'Stable actor and request identities are required.');
      const product = safeText(input.product, 'product', 240);
      const market = safeText(input.market, 'market', 100);
      const objective = safeText(input.objective, 'objective', 2500);
      if (input.publicDataConfirmed !== true) fail(403, 'DATA_SCOPE_REQUIRED', 'Explicitly confirm these inputs may be shared with an external Worker.');
      if (!Number.isSafeInteger(input.budgetCredits) || input.budgetCredits < service.minimumCredits || input.budgetCredits > 10000)
        fail(400, 'BUDGET_INVALID', 'Budget must cover the service minimum without exceeding 10000 credits.');
      const deadlineAt = deadlineValue(input.deadlineAt);
      if (input.workerId !== undefined && (!identifier(input.workerId) || !eligible(service.id).some(worker => worker.id === input.workerId)))
        fail(409, 'WORKER_UNAVAILABLE', 'Choose a verified Worker capable of this service.');
      const assignedWorker = input.workerId || null;
      const fingerprint = hash({ serviceId: service.id, product, market, objective, budgetCredits: input.budgetCredits, deadlineAt, workerId: assignedWorker, actor });
      return update(state => {
        const existing = state.workerOrders.find(item => item.requestId === input.requestId && item.createdBy === actor);
        if (existing) {
          if (existing.requestFingerprint !== fingerprint) fail(409, 'IDEMPOTENCY_CONFLICT', 'The same request ID cannot be reused for different order contents.');
          map(state, existing, true);
          return { order: existing, duplicate: true };
        }
        if (state.workerOrders.length >= 1000) fail(409, 'ORDER_LIMIT', 'Service order limit reached; archive with a reviewed retention policy.');
        const order = {
          id: randomUUID(), requestId: input.requestId, requestFingerprint: fingerprint,
          serviceId: service.id, serviceTitle: service.title, workerId: assignedWorker,
          product, market, objective, budgetCredits: input.budgetCredits, deadlineAt,
          acceptance: service.acceptance, deliverableTypes: service.deliverables, dataMode: 'public',
          status: 'draft', createdBy: actor, createdAt: now(), updatedAt: now(),
          approvedBy: null, approvedAt: null, remoteJobId: null, workerReport: null,
          reportedCostCredits: null, acceptedBy: null, acceptedAt: null, error: null,
        };
        state.workerOrders.push(order); map(state, order, false); return { order, duplicate: false };
      });
    },
    approve(id, actor, input) {
      if (!keysOnly(input, ['confirmed', 'workerId']) || input.confirmed !== true) fail(400, 'CONFIRMATION_REQUIRED', 'Confirm the exact worker, budget, scope and deadline.');
      return update(state => {
        const order = requireOrder(state, id);
        if (order.status !== 'draft') fail(409, 'INVALID_STATE', 'Only a draft can be approved.');
        if (Date.parse(order.deadlineAt) <= Date.now()) fail(409, 'DEADLINE_EXPIRED', 'An expired work order cannot be authorized. Create a new scope.');
        const workerId = input.workerId || order.workerId;
        if (!eligible(order.serviceId).some(worker => worker.id === workerId)) fail(409, 'WORKER_UNAVAILABLE', 'Worker capability or hard budget enforcement is not available.');
        order.workerId = workerId;
        order.status = 'approved'; order.approvedBy = actor; order.approvedAt = now(); order.updatedAt = now();
        return { order };
      });
    },
    async dispatch(id) {
      const order = get(id), adapter = adapterMap.get(order.workerId);
      if (order.status !== 'approved') fail(409, 'INVALID_STATE', 'Only a previously approved order can be dispatched.');
      if (Date.parse(order.deadlineAt) <= Date.now()) fail(409, 'DEADLINE_EXPIRED', 'The approved deadline passed before dispatch; reauthorize new work.');
      if (!adapter?.ready || !adapter.budgetEnforced || !adapter.services.includes(order.serviceId)) fail(409, 'WORKER_UNAVAILABLE', 'No reviewed Worker with enforced budget is ready.');
      await update(state => {
        const current = requireOrder(state, id);
        if (current.status !== 'approved') fail(409, 'INVALID_STATE', 'Order has already been dispatched or changed.');
        current.status = 'dispatching'; current.updatedAt = now();
      });
      try {
        const response = await adapter.submit({
          orderId: order.id, idempotencyKey: order.id, serviceId: order.serviceId,
          inputs: { product: order.product, market: order.market, objective: order.objective },
          acceptance: order.acceptance, deadlineAt: order.deadlineAt, maxCredits: order.budgetCredits,
          dataScope: 'public',
        });
        if (!isObject(response) || !identifier(response.jobId)) throw new Error('Worker has not acknowledged a valid durable job ID.');
        return update(state => {
          const current = requireOrder(state, id);
          current.remoteJobId = response.jobId;
          current.status = response.queued === true ? 'queued' : 'running'; current.updatedAt = now(); current.error = null;
          return { order: current };
        });
      } catch {
        await update(state => {
          const current = requireOrder(state, id);
          if (current.status === 'dispatching') {
            current.status = 'dispatch_uncertain'; current.updatedAt = now();
            current.error = { code: 'DISPATCH_UNCERTAIN', message: 'The Worker may have received this order. Never submit it again automatically; reconcile using the stable order ID.' };
          }
        });
        fail(503, 'DISPATCH_UNCERTAIN', 'Worker acceptance is uncertain. Check the task before taking further action.');
      }
    },
    async refresh(id) {
      const order = get(id), adapter = adapterMap.get(order.workerId);
      if (!['queued', 'running', 'cancel_requested', 'dispatch_uncertain', 'input_required'].includes(order.status)) fail(409, 'INVALID_STATE', 'Only an active or uncertain Worker order can be checked.');
      if (!adapter?.get) fail(503, 'WORKER_UNAVAILABLE', 'Worker status adapter is unavailable.');
      let snapshot;
      if (!order.remoteJobId) {
        if (typeof adapter.reconcile !== 'function') fail(409, 'MANUAL_RECONCILIATION', 'Submission acknowledgement is missing; a reviewed reconciliation adapter is required.');
        snapshot = await adapter.reconcile(order.id);
        if (!snapshot?.jobId || !identifier(snapshot.jobId)) fail(409, 'MANUAL_RECONCILIATION', 'The Worker has not verified the original idempotency key.');
      } else snapshot = await adapter.get(order.remoteJobId, order.id);
      if (!isObject(snapshot) || !allowedStates.has(snapshot.status)) fail(502, 'INVALID_WORKER_RESULT', 'Worker returned an unsupported task state.');
      if (!identifier(snapshot.jobId) || (order.remoteJobId && snapshot.jobId !== order.remoteJobId) || (snapshot.orderId !== undefined && snapshot.orderId !== order.id)) fail(502, 'WORKER_JOB_MISMATCH', 'Worker status does not match the approved service order and remote job.');
      const report = snapshot.status === 'completed' ? {
        deliverables: cleanDeliverables(snapshot.deliverables), evidence: cleanEvidence(snapshot.evidence),
        prospects: order.serviceId === 'buyer-discovery' ? cleanProspects(snapshot.prospects) : [],
        independentlyVerified: false, reportedAt: now(),
        evidenceNote: typeof snapshot.evidenceNote === 'string' ? snapshot.evidenceNote.slice(0, 2000) : null,
      } : null;
      const cost = snapshot.costCredits === undefined ? null : snapshot.costCredits;
      if (cost !== null && (!Number.isSafeInteger(cost) || cost < 0)) fail(502, 'INVALID_WORKER_RESULT', 'Worker reported an invalid credit count.');
      return update(state => {
        const current = requireOrder(state, id);
        if (!['queued', 'running', 'cancel_requested', 'dispatch_uncertain', 'input_required'].includes(current.status)) fail(409, 'INVALID_STATE', 'Order changed during status retrieval.');
        current.remoteJobId ??= snapshot.jobId;
        if (cost !== null) current.reportedCostCredits = cost;
        // A late result or queue response cannot undo an operator's stop request.
        // Preserve the cancellation until this exact remote job acknowledges it.
        if (current.status === 'cancel_requested' && snapshot.status !== 'cancelled') {
          if (cost !== null && cost > current.budgetCredits)
            current.error = { code: 'BUDGET_EXCEEDED', message: 'The Worker reported costs above the approved limit. Suspend settlement and investigate.' };
          current.updatedAt = now();
          return { order: current };
        }
        if (cost !== null && cost > current.budgetCredits) {
          current.status = 'budget_dispute'; current.error = { code: 'BUDGET_EXCEEDED', message: 'The Worker reported costs above the approved limit. Suspend settlement and investigate.' };
        } else if (snapshot.status === 'completed') {
          current.status = report.deliverables.length && report.evidence.length && (current.serviceId !== 'buyer-discovery' || report.prospects.length > 0) ? 'review_required' : 'result_incomplete';
          current.workerReport = report;
        } else if (snapshot.status === 'cancelled') current.status = 'cancelled';
        else if (snapshot.status === 'failed') current.status = 'failed';
        else if (snapshot.status === 'input_required') current.status = 'input_required';
        else if (snapshot.status === 'queued') current.status = 'queued';
        else current.status = current.status === 'cancel_requested' ? 'cancel_requested' : 'running';
        current.updatedAt = now();
        return { order: current };
      });
    },
    async accept(id, actor, input) {
      if (!keysOnly(input, ['confirmed']) || input.confirmed !== true) fail(400, 'CONFIRMATION_REQUIRED', 'Review the delivery and confirm acceptance.');
      const checked = get(id);
      if (checked.status !== 'review_required' || !checked.workerReport?.deliverables?.length || !checked.workerReport?.evidence?.length)
        fail(409, 'INVALID_STATE', 'A reviewable delivery with evidence is required before acceptance.');
      let deliveryArtifactId = null;
      if (artifacts) {
        // Store a bounded, inert JSON *receipt*. Never download/execute remote
        // files or treat worker-originated claims as independently verified.
        const content = JSON.stringify({
          schema: 'workspace.worker.accepted-receipt.v1',
          orderId: checked.id, serviceId: checked.serviceId, serviceTitle: checked.serviceTitle,
          product: checked.product, market: checked.market, objective: checked.objective,
          workerId: checked.workerId, remoteJobId: checked.remoteJobId,
          approvedBudgetCredits: checked.budgetCredits,
          workerReportedCredits: checked.reportedCostCredits,
          externalClaimsIndependentlyVerified: false,
          workerReport: checked.workerReport,
        }, null, 2);
        const result = await artifacts.create({
          filename: 'AI-Worker-' + checked.id + '.json',
          title: 'AI Worker Delivery · ' + checked.serviceTitle,
          description: 'User-reviewed external Worker claims, not independently verified business results.',
          content, requestId: 'worker-delivery-' + checked.id,
          metadata: { workerOrderId: checked.id, externalClaimsIndependentlyVerified: false },
        }, {
          check: state => {
            const current = requireOrder(state, id);
            if (current.status !== 'review_required') fail(409, 'INVALID_STATE', 'The work order changed before artifact publication.');
          },
        });
        deliveryArtifactId = result.artifact.id;
      }
      return update(state => {
        const order = requireOrder(state, id);
        if (order.status !== 'review_required' || !order.workerReport?.deliverables?.length || !order.workerReport?.evidence?.length)
          fail(409, 'INVALID_STATE', 'The work order changed before final acceptance.');
        order.status = 'accepted'; order.acceptedBy = actor; order.acceptedAt = now(); order.updatedAt = now();
        order.deliveryArtifactId = deliveryArtifactId;
        return { order };
      });
    },
    async cancel(id) {
      const order = get(id);
      if (['draft', 'approved'].includes(order.status)) return update(state => {
        const current = requireOrder(state, id); if (!['draft', 'approved'].includes(current.status)) fail(409, 'INVALID_STATE', 'Order status changed.');
        current.status = 'cancelled'; current.updatedAt = now(); return { order: current };
      });
      if (!['queued', 'running', 'input_required', 'cancel_requested'].includes(order.status)) fail(409, 'INVALID_STATE', 'This order cannot be cancelled through the standard route.');
      await update(state => { const current = requireOrder(state, id); current.status = 'cancel_requested'; current.updatedAt = now(); });
      const adapter = adapterMap.get(order.workerId);
      if (!adapter?.cancel || !order.remoteJobId) fail(503, 'CANCEL_UNCONFIRMED', 'Cancellation remains requested until the verified Worker acknowledges it.');
      let receipt;
      try { receipt = await adapter.cancel(order.remoteJobId); }
      catch { fail(503, 'CANCEL_UNCONFIRMED', 'Cancellation remains requested; do not assume the Worker stopped.'); }
      if (receipt?.status !== 'cancelled') return { order: get(id) };
      return update(state => {
        const current = requireOrder(state, id);
        if (current.status === 'cancel_requested') { current.status = 'cancelled'; current.updatedAt = now(); }
        return { order: current };
      });
    },
  };
}
