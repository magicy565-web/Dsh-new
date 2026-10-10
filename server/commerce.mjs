import { randomUUID, createHash } from 'node:crypto';
import { ApiError } from './runtime.mjs';
import { validateJson } from './store.mjs';

const fail = (status, code, message) => { throw new ApiError(status, code, message); };
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u;
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const rows = state => state.commerceProjects || [];
const required = (state, id) => { const item = rows(state).find(row => row.id === id); if (!item) fail(404, 'COMMERCE_PROJECT_NOT_FOUND', '产品托管任务不存在。'); return item; };
function fields(body, allowed) {
  try { validateJson(body); } catch { fail(400, 'INVALID_INPUT', '提交内容必须是有效 JSON。'); }
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => !allowed.includes(key))) fail(400, 'INVALID_INPUT', '提交内容包含不支持的字段。');
}
function text(value, key, maximum) { if (typeof value !== 'string' || !value.trim() || value.length > maximum || /[\u0000-\u001f\u007f]/u.test(value.replace(/[\n\r\t]/gu, ''))) fail(400, 'INVALID_INPUT', `${key}尚未填写或超过长度上限。`); return value.trim(); }
function integer(value, key, min, max) { if (!Number.isSafeInteger(value) || value < min || value > max) fail(400, 'INVALID_INPUT', `${key}必须在 ${min}–${max} 之间。`); return value; }
function actorRole(actor, admin = false) { if (!(admin ? ['admin'] : ['admin', 'operator']).includes(actor?.role) || !actor.subject) fail(403, 'ROLE_REQUIRED', admin ? '此操作需要管理员审核。' : '需要业务操作员或管理员权限。'); }
function request(body) { if (!UUID.test(body.requestId) || body.confirmed !== true) fail(400, 'CONFIRMATION_REQUIRED', '请确认操作范围并提供稳定的请求编号。'); }
function micros(value) {
  if (typeof value !== 'string' || !/^(?:0|[1-9]\d{0,12})(?:\.\d{1,6})?$/u.test(value)) fail(502, 'SHOPIFY_MONEY_INVALID', '订单金额格式无效。');
  const [whole, fraction = ''] = value.split('.');
  return BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, '0'));
}
const decimal = value => `${value / 1_000_000n}.${(value % 1_000_000n).toString().padStart(6, '0')}`.replace(/0+$/u, '').replace(/\.$/u, '');
export function normalizeShopifyOrder(order, observedAt) {
  const received = order?.totalReceivedSet?.shopMoney, refunded = order?.totalRefundedSet?.shopMoney;
  if (!/^gid:\/\/shopify\/Order\/\d+$/u.test(order?.id) || typeof order.name !== 'string' || order.name.length > 200 || typeof order.test !== 'boolean' || !Number.isFinite(Date.parse(order.createdAt)) || !Number.isFinite(Date.parse(order.updatedAt)) || order.cancelledAt !== null && !Number.isFinite(Date.parse(order.cancelledAt)) || !/^[A-Z_]{1,40}$/u.test(order.displayFinancialStatus) || !/^[A-Z_]{1,40}$/u.test(order.displayFulfillmentStatus) || !/^[A-Z]{3}$/u.test(received?.currencyCode) || refunded?.currencyCode !== received.currencyCode)
    fail(502, 'SHOPIFY_ORDER_INVALID', 'Shopify 订单字段不完整，未记录这批结果。');
  const net = micros(received.amount) - micros(refunded.amount);
  return {
    id: order.id, name: order.name, createdAt: order.createdAt, updatedAt: order.updatedAt,
    test: order.test, cancelledAt: order.cancelledAt, financialStatus: order.displayFinancialStatus,
    fulfillmentStatus: order.displayFulfillmentStatus, currency: received.currencyCode,
    received: decimal(micros(received.amount)), refunded: decimal(micros(refunded.amount)), netReceived: net > 0n ? decimal(net) : '0',
    salesEvidence: !order.test && !order.cancelledAt && ['PAID', 'PARTIALLY_REFUNDED'].includes(order.displayFinancialStatus) && order.displayFulfillmentStatus === 'FULFILLED' && net > 0n,
    observedAt, attribution: 'shopify_tag_unreviewed', settlement: 'not_settled',
  };
}
export function summarizeOrders(project) {
  const orders = project.orderEvidence?.orders || [], currencies = new Map();
  for (const order of orders.filter(row => row.salesEvidence)) currencies.set(order.currency, (currencies.get(order.currency) || 0n) + micros(order.netReceived));
  return { observedOrders: orders.length, testOrders: orders.filter(row => row.test).length,
    paidFulfilledOrders: orders.filter(row => row.salesEvidence).length,
    netReceipts: [...currencies].map(([currency, amount]) => ({ currency, amount: decimal(amount) })),
    complete: project.orderEvidence?.complete === true, observedAt: project.orderEvidence?.observedAt || null,
    attribution: 'requires_review', settlement: 'terms_and_attribution_required', billableAmount: null };
}

export function createCommerceService({ store, runtime, shopify, workerCatalog = () => [], clock = Date.now } = {}) {
  const at = () => new Date(clock()).toISOString();
  const locks = new Set();
  const view = project => ({ ...project, results: summarizeOrders(project) });
  const locked = async (id, operation) => { if (locks.has(id)) fail(409, 'COMMERCE_BUSY', '任务正在保存，请稍后重试。'); locks.add(id); try { return await operation(); } finally { locks.delete(id); } };
  return {
    status() {
      const status = runtime.status(), catalog = workerCatalog();
      return { harness: { kind: status.kind, configured: status.configured, native: status.kind === 'deepseek-harness', onlineVerified: false },
        shopify: shopify.status(), workers: { registeredServices: catalog.filter(row => row.workers?.length).length },
        cloudComputer: { status: 'not_connected', executionAvailable: false },
        settlement: { status: 'not_configured', basis: 'reviewed_attributable_net_receipts', automaticCharge: false } };
    },
    list() { return { projects: rows(store.read()).map(view) }; },
    get(id) { return { project: view(required(store.read(), id)) }; },
    async create(body, actor) {
      actorRole(actor); fields(body, ['requestId', 'confirmed', 'productId', 'productRevision', 'publicDescription', 'market', 'objective', 'budget', 'durationDays', 'validationOrderTarget']); request(body);
      if (!UUID.test(body.productId)) fail(400, 'INVALID_INPUT', '请选择已经保存的企业产品。');
      integer(body.productRevision, '产品修订', 1, 1_000_000);
      const market = text(body.market, '目标市场', 100), objective = text(body.objective, '验证目标', 2000), publicDescription = text(body.publicDescription, '已确认可共享的产品描述', 8000);
      fields(body.budget, ['amount', 'currency']);
      if (!/^[A-Z]{3}$/u.test(body.budget.currency) || typeof body.budget.amount !== 'string' || !/^(?:0|[1-9]\d{0,7})(?:\.\d{1,2})?$/u.test(body.budget.amount) || micros(body.budget.amount) <= 0n) fail(400, 'INVALID_INPUT', '请填写有效的预算金额与币种。');
      const durationDays = integer(body.durationDays, '验证天数', 1, 60), validationOrderTarget = integer(body.validationOrderTarget, '目标订单数', 1, 1000);
      const fingerprint = hash({ actor: actor.subject, body });
      return store.update(state => {
        state.commerceProjects ??= [];
        const previous = state.commerceProjects.find(row => row.requestId === body.requestId);
        if (previous) { if (previous.fingerprint !== fingerprint) fail(409, 'IDEMPOTENCY_CONFLICT', '这个请求编号已用于其他托管范围。'); return { project: view(previous), duplicate: true }; }
        const product = state.businessLibrary.products.find(row => row.id === body.productId);
        if (!product || product.status !== 'draft' || product.source?.kind === 'public_reference') fail(409, 'PRODUCT_NOT_AVAILABLE', '只有已保存的企业自有产品可以托管，公开参考样本不可用。');
        if (product.revision !== body.productRevision) fail(409, 'REVISION_CONFLICT', '产品已有新修订，请重新读取后确认托管范围。');
        if (state.commerceProjects.length >= 500) fail(409, 'COMMERCE_LIMIT', '托管任务数量达到上限。');
        const time = at(), project = { id: randomUUID(), revision: 1, requestId: body.requestId, fingerprint,
          productId: product.id, productRevision: product.revision, productName: product.name, publicDescription,
          market, objective, budget: body.budget, durationDays, validationOrderTarget,
          status: 'draft', researchGoalId: null, researchRequestId: null, shopifyConfigFingerprint: null,
          feeTerms: null, orderEvidence: null, orderSyncRequests: [], createdBy: actor.subject, createdAt: time, updatedAt: time };
        state.commerceProjects.push(project);
        state.activity.push({ id: randomUUID(), type: 'commerce_project_created', title: '产品托管任务已保存', detail: product.name, createdAt: time });
        return { project: view(project), duplicate: false };
      });
    },
    async stageResearch(id, body, actor) {
      actorRole(actor); fields(body, ['requestId', 'confirmed']); request(body);
      return locked(id, async () => {
        const project = required(store.read(), id);
        if (project.researchGoalId) return { project: view(project), duplicate: true };
        // Persist the intent before creating a goal. A crash between the two
        // commits is recoverable by the runtime's stable createGoal requestId.
        await store.update(state => {
          const item = required(state, id);
          item.researchRequestId ||= `commerce_${id}_research`;
          item.status = 'research_preparing'; item.updatedAt = at();
        });
        const goal = await runtime.createGoal({ requestId: `commerce_${id}_research`, title: `${project.productName.slice(0, 90)} · ${project.market.slice(0, 40)}验证`,
          description: `已确认可共享的产品信息：${project.publicDescription}\n目标市场：${project.market}\n业务目标：${project.objective}\n验证期：${project.durationDays}天；目标：${project.validationOrderTarget}笔非测试、已收款并履约的订单。\n经营预算计划：${project.budget.amount} ${project.budget.currency}。该记录不授权支出。\n先研究有原始来源的海外分销商、渠道和验证方案。交付候选客户证据、Shopify上架草稿和履约准备清单。对外联系、发布、投放、退款及结算均需独立授权。禁止编造订单或销售结果。`,
          maxSteps: 3, maxOutputTokens: 4800 });
        return store.update(state => {
          const item = required(state, id); item.researchGoalId = goal.goal.id;
          item.status = 'research_staged'; item.revision++; item.updatedAt = at();
          return { project: view(item), duplicate: !!goal.duplicate };
        });
      });
    },
    async syncOrders(id, body, actor) {
      actorRole(actor, true); fields(body, ['confirmed', 'requestId']); request(body);
      return locked(id, async () => {
        const project = required(store.read(), id);
        const replay = project.orderSyncRequests?.find(row => row.id === body.requestId);
        if (replay) {
          if (replay.actor !== actor.subject) fail(409, 'IDEMPOTENCY_CONFLICT', '读取请求已属于其他审核人。');
          return { project: view(project), duplicate: true };
        }
        if ((project.orderSyncRequests?.length || 0) >= 300) fail(409, 'ORDER_SYNC_LIMIT', '订单读取请求达到本次托管任务的上限。');
        if (project.shopifyConfigFingerprint && project.shopifyConfigFingerprint !== shopify.fingerprint)
          fail(409, 'SHOPIFY_STORE_CHANGED', '店铺配置已更换，不能将其他店铺订单合并到这个任务。');
        const previous = project.orderEvidence;
        if (previous?.orders.length >= 1000 && !previous.complete) fail(409, 'ORDER_EVIDENCE_LIMIT', '订单读取达到本轮上限，需要扩展对账接口后继续。');
        const continuing = previous?.complete === false;
        const page = await shopify.readProjectOrders({ projectId: id, after: continuing ? previous.nextCursor : null, createdAt: project.createdAt });
        if (previous?.shopId && previous.shopId !== page.shopId) fail(409, 'SHOPIFY_STORE_CHANGED', '店铺身份已变化，不能合并其他店铺的订单。');
        const normalized = page.orders.map(order => normalizeShopifyOrder(order, page.observedAt));
        return store.update(state => {
          const item = required(state, id), existing = continuing ? item.orderEvidence?.orders || [] : [];
          const orders = new Map(existing.map(order => [order.id, order]));
          for (const order of normalized) orders.set(order.id, order);
          if (orders.size > 1000) fail(409, 'ORDER_EVIDENCE_LIMIT', '订单读取达到本轮上限，未保存不完整金额汇总。');
          item.shopifyConfigFingerprint = shopify.fingerprint;
          item.orderEvidence = { shopId: page.shopId, shopDomain: page.shopDomain, orders: [...orders.values()],
            nextCursor: page.nextCursor, complete: page.nextCursor === null, observedAt: page.observedAt,
            scope: 'tagged_orders_since_project_creation', attribution: 'requires_review', apiSource: 'shopify_admin_graphql' };
          item.revision++; item.updatedAt = at();
          item.orderSyncRequests ??= [];
          item.orderSyncRequests.push({ id: body.requestId, actor: actor.subject, observedAt: page.observedAt });
          return { project: view(item) };
        });
      });
    },
  };
}
